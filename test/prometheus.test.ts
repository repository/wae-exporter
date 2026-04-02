import { describe, expect, it } from "vitest";
import { formatMetrics, mapQueryResult } from "../src/prometheus";

describe("formatMetrics", () => {
  it("formats a gauge with no labels", () => {
    const output = formatMetrics([
      {
        name: "my_gauge",
        type: "gauge",
        help: "A simple gauge",
        samples: [{ labels: {}, value: 42 }],
      },
    ]);
    expect(output).toBe("# HELP my_gauge A simple gauge\n# TYPE my_gauge gauge\nmy_gauge 42\n");
  });

  it("formats a counter with labels", () => {
    const output = formatMetrics([
      {
        name: "http_requests_total",
        type: "counter",
        help: "Total requests",
        samples: [
          { labels: { method: "GET", status: "200" }, value: 100 },
          { labels: { method: "POST", status: "201" }, value: 5 },
        ],
      },
    ]);
    expect(output).toBe(
      [
        "# HELP http_requests_total Total requests",
        "# TYPE http_requests_total counter",
        'http_requests_total{method="GET",status="200"} 100',
        'http_requests_total{method="POST",status="201"} 5',
        "",
      ].join("\n"),
    );
  });

  it("escapes special characters in label values", () => {
    const output = formatMetrics([
      {
        name: "m",
        type: "gauge",
        help: "h",
        samples: [{ labels: { path: "C:\\DIR\\FILE.TXT", msg: 'say "hi"\nbye' }, value: 1 }],
      },
    ]);
    expect(output).toContain('path="C:\\\\DIR\\\\FILE.TXT"');
    expect(output).toContain('msg="say \\"hi\\"\\nbye"');
  });

  it("handles NaN, +Inf, -Inf", () => {
    const output = formatMetrics([
      {
        name: "m",
        type: "gauge",
        help: "h",
        samples: [
          { labels: { t: "nan" }, value: NaN },
          { labels: { t: "inf" }, value: Infinity },
          { labels: { t: "ninf" }, value: -Infinity },
        ],
      },
    ]);
    expect(output).toContain('m{t="nan"} NaN');
    expect(output).toContain('m{t="inf"} +Inf');
    expect(output).toContain('m{t="ninf"} -Inf');
  });

  it("returns empty string for no metrics", () => {
    expect(formatMetrics([])).toBe("");
  });

  it("formats a histogram with buckets, sum, and count", () => {
    const output = formatMetrics([
      {
        name: "http_duration_seconds",
        type: "histogram",
        help: "Request duration",
        samples: [
          { labels: { endpoint: "/api", le: "0.01" }, value: 50 },
          { labels: { endpoint: "/api", le: "0.1" }, value: 120 },
          { labels: { endpoint: "/api", le: "+Inf" }, value: 150 },
          { labels: { endpoint: "/api", __sum: "1" }, value: 53.2 },
          { labels: { endpoint: "/api", __count: "1" }, value: 150 },
        ],
      },
    ]);
    expect(output).toBe(
      [
        "# HELP http_duration_seconds Request duration",
        "# TYPE http_duration_seconds histogram",
        'http_duration_seconds_bucket{endpoint="/api",le="0.01"} 50',
        'http_duration_seconds_bucket{endpoint="/api",le="0.1"} 120',
        'http_duration_seconds_bucket{endpoint="/api",le="+Inf"} 150',
        'http_duration_seconds_sum{endpoint="/api"} 53.2',
        'http_duration_seconds_count{endpoint="/api"} 150',
        "",
      ].join("\n"),
    );
  });

  it("formats multiple metrics", () => {
    const output = formatMetrics([
      {
        name: "a",
        type: "gauge",
        help: "first",
        samples: [{ labels: {}, value: 1 }],
      },
      {
        name: "b",
        type: "counter",
        help: "second",
        samples: [{ labels: {}, value: 2 }],
      },
    ]);
    expect(output).toBe(
      [
        "# HELP a first",
        "# TYPE a gauge",
        "a 1",
        "# HELP b second",
        "# TYPE b counter",
        "b 2",
        "",
      ].join("\n"),
    );
  });
});

describe("mapQueryResult", () => {
  it("maps a simple query result to metrics", () => {
    const data = [
      { endpoint: "/api", count: "150" },
      { endpoint: "/health", count: "30" },
    ];
    const result = mapQueryResult(data, [
      {
        name: "requests_total",
        type: "counter" as const,
        help: "Total requests",
        value: "count",
        labels: { endpoint: "endpoint" },
      },
    ]);
    expect(result).toEqual([
      {
        name: "requests_total",
        type: "counter",
        help: "Total requests",
        samples: [
          { labels: { endpoint: "/api" }, value: 150 },
          { labels: { endpoint: "/health" }, value: 30 },
        ],
      },
    ]);
  });

  it("handles multiple metrics from one query", () => {
    const data = [{ ep: "/foo", req: "10", err: "2" }];
    const result = mapQueryResult(data, [
      {
        name: "reqs",
        type: "counter" as const,
        help: "requests",
        value: "req",
        labels: { ep: "endpoint" },
      },
      {
        name: "errs",
        type: "counter" as const,
        help: "errors",
        value: "err",
        labels: { ep: "endpoint" },
      },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].samples[0].value).toBe(10);
    expect(result[1].samples[0].value).toBe(2);
  });

  it("returns empty samples when value column is missing", () => {
    const data = [{ x: "val" }];
    const result = mapQueryResult(data, [
      {
        name: "m",
        type: "gauge" as const,
        help: "h",
        value: "nonexistent",
      },
    ]);

    expect(result[0].samples).toEqual([]);
  });

  it("handles empty data", () => {
    const data: Record<string, unknown>[] = [];
    const result = mapQueryResult(data, [
      { name: "m", type: "gauge" as const, help: "h", value: "v" },
    ]);
    expect(result[0].samples).toEqual([]);
  });

  it("maps histogram with column-per-bucket", () => {
    const data = [{ endpoint: "/api", b_01: "50", b_1: "120", obs_sum: "53.2", obs_count: "120" }];
    const result = mapQueryResult(data, [
      {
        name: "http_duration_seconds",
        type: "histogram" as const,
        help: "Duration",
        buckets: { b_01: 0.1, b_1: 1 },
        sum: "obs_sum",
        total: "obs_count",
        labels: { endpoint: "endpoint" },
      },
    ]);

    expect(result[0].type).toBe("histogram");
    const labels = result[0].samples.map((s) => s.labels);
    const values = result[0].samples.map((s) => s.value);

    expect(labels[0]).toEqual({ endpoint: "/api", le: "0.1" });
    expect(values[0]).toBe(50);
    expect(labels[1]).toEqual({ endpoint: "/api", le: "1" });
    expect(values[1]).toBe(120);
    // auto +Inf
    expect(labels[2]).toEqual({ endpoint: "/api", le: "+Inf" });
    expect(values[2]).toBe(120);
    // _sum
    expect(labels[3]).toEqual({ endpoint: "/api", __sum: "1" });
    expect(values[3]).toBe(53.2);
    // _count
    expect(labels[4]).toEqual({ endpoint: "/api", __count: "1" });
    expect(values[4]).toBe(120);
  });

  it("does not duplicate +Inf when Infinity bucket exists", () => {
    const data = [{ b_1: "80", b_inf: "100" }];
    const result = mapQueryResult(data, [
      {
        name: "m",
        type: "histogram" as const,
        help: "h",
        buckets: { b_1: 1, b_inf: Infinity },
      },
    ]);

    const leValues = result[0].samples.filter((s) => s.labels.le).map((s) => s.labels.le);
    expect(leValues).toEqual(["1", "+Inf"]);
  });

  it("handles histogram without sum/total", () => {
    const data = [{ b: "10" }];
    const result = mapQueryResult(data, [
      {
        name: "m",
        type: "histogram" as const,
        help: "h",
        buckets: { b: 0.5 },
      },
    ]);

    expect(result[0].samples).toHaveLength(2); // bucket + auto +Inf
    expect(result[0].samples.every((s) => s.labels.le !== undefined)).toBe(true);
  });

  it("handles histogram with multiple label groups", () => {
    const data = [
      { ep: "/a", b_1: "10" },
      { ep: "/b", b_1: "20" },
    ];
    const result = mapQueryResult(data, [
      {
        name: "m",
        type: "histogram" as const,
        help: "h",
        buckets: { b_1: 1 },
        labels: { ep: "endpoint" },
      },
    ]);

    // 2 rows * (1 bucket + auto +Inf) = 4 samples
    expect(result[0].samples).toHaveLength(4);
    expect(result[0].samples[0].labels.endpoint).toBe("/a");
    expect(result[0].samples[2].labels.endpoint).toBe("/b");
  });
});
