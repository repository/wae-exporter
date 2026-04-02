import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import type { WaeResult } from "../src/wae";
import type { QueryDefinition } from "../src/config";

import { META_PREFIX as META } from "../src/prometheus";

const mockQueryWae =
  vi.fn<(accountId: string, apiToken: string, sql: string) => Promise<WaeResult>>();

vi.mock("../src/wae", () => ({
  queryWae: (accountId: string, apiToken: string, sql: string) =>
    mockQueryWae(accountId, apiToken, sql),
}));

const testQueries: QueryDefinition[] = [
  {
    sql: "SELECT blob1 AS endpoint, SUM(double1) AS hits FROM test_dataset GROUP BY blob1",
    metrics: [
      {
        name: "test_requests_total",
        type: "counter",
        help: "Test requests",
        value: "hits",
        labels: { endpoint: "endpoint" },
      },
    ],
  },
];

vi.mock("../src/queries", () => ({ default: testQueries }));

const { default: app } = await import("../src/index");

afterEach(() => {
  mockQueryWae.mockReset();
});

async function scrape() {
  return app.request("/metrics", { headers: { Authorization: `Bearer ${env.SCRAPE_TOKEN}` } }, env);
}

describe("wae-exporter", () => {
  it("returns 404 for unknown paths", async () => {
    const res = await app.request("/", {}, env);
    expect(res.status).toBe(404);
  });

  it("returns 401 without auth token", async () => {
    const res = await app.request("/metrics", {}, env);
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong token", async () => {
    const res = await app.request("/metrics", { headers: { Authorization: "Bearer wrong" } }, env);
    expect(res.status).toBe(401);
  });

  it("returns formatted metrics from WAE query results", async () => {
    mockQueryWae.mockResolvedValue({
      meta: [
        { name: "endpoint", type: "String" },
        { name: "hits", type: "Float64" },
      ],
      data: [
        { endpoint: "/api", hits: "100" },
        { endpoint: "/health", hits: "50" },
      ],
      rows: 2,
    });

    const res = await scrape();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/plain; version=0.0.4; charset=utf-8");

    const body = await res.text();
    expect(body).toContain("# TYPE test_requests_total counter");
    expect(body).toContain('test_requests_total{endpoint="/api"} 100');
    expect(body).toContain('test_requests_total{endpoint="/health"} 50');
  });

  it("reports scrape errors when WAE query fails", async () => {
    mockQueryWae.mockRejectedValue(new Error("WAE query failed (500): Internal Server Error"));

    const body = await scrape().then((r) => r.text());
    expect(body).toMatch(new RegExp(`${META}_scrape_errors\\b.* [1-9]`));
  });

  it("includes scrape duration", async () => {
    mockQueryWae.mockResolvedValue({ meta: [], data: [], rows: 0 });

    const body = await scrape().then((r) => r.text());
    expect(body).toContain(`# TYPE ${META}_scrape_duration_seconds gauge`);
    expect(body).toMatch(new RegExp(`${META}_scrape_duration_seconds\\b`));
  });

  it("includes per-metric query duration and row count", async () => {
    mockQueryWae.mockResolvedValue({
      meta: [
        { name: "endpoint", type: "String" },
        { name: "hits", type: "Float64" },
      ],
      data: [
        { endpoint: "/api", hits: "100" },
        { endpoint: "/health", hits: "50" },
      ],
      rows: 2,
    });

    const body = await scrape().then((r) => r.text());
    expect(body).toContain(`# TYPE ${META}_query_duration_seconds gauge`);
    expect(body).toContain(`${META}_query_duration_seconds{metric="test_requests_total"}`);
    expect(body).toContain(`${META}_query_rows{metric="test_requests_total"} 2`);
  });

  it("passes account ID and API token to WAE client", async () => {
    mockQueryWae.mockResolvedValue({ meta: [], data: [], rows: 0 });
    await scrape();
    expect(mockQueryWae).toHaveBeenCalledWith("test-account", "test-api-token", expect.any(String));
  });
});
