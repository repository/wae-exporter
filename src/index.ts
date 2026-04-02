import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { formatMetrics, mapQueryResult, scrapeMetrics, type SerializedMetric } from "./prometheus";
import queries from "./queries";
import { queryWae } from "./wae";

const app = new Hono<{ Bindings: Env }>();

app.use(
  "/metrics",
  bearerAuth({
    verifyToken: (token, c) => {
      const expected = c.env.SCRAPE_TOKEN;
      if (token.length !== expected.length) return false;
      const a = new TextEncoder().encode(token);
      const b = new TextEncoder().encode(expected);
      return crypto.subtle.timingSafeEqual(a, b);
    },
  }),
);

app.get("/metrics", async (c) => {
  const start = Date.now();
  let errors = 0;
  const allMetrics: SerializedMetric[] = [];
  const queryDuration: { labels: Record<string, string>; value: number }[] = [];
  const queryRows: { labels: Record<string, string>; value: number }[] = [];

  const results = await Promise.allSettled(
    queries.map(async (q) => {
      const qStart = Date.now();
      const result = await queryWae(c.env.WAE_ACCOUNT_ID, c.env.WAE_API_TOKEN, q.sql);
      const qDuration = (Date.now() - qStart) / 1000;
      for (const m of q.metrics) {
        queryDuration.push({ labels: { metric: m.name }, value: qDuration });
        queryRows.push({ labels: { metric: m.name }, value: result.rows });
      }
      return mapQueryResult(result.data, q.metrics);
    }),
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      allMetrics.push(...result.value);
    } else {
      errors++;
      console.error("query failed:", result.reason);
    }
  }

  const duration = (Date.now() - start) / 1000;
  allMetrics.push(...scrapeMetrics(c.req.raw.cf, errors, duration, queryDuration, queryRows));

  return c.text(formatMetrics(allMetrics), 200, {
    "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
  });
});

export default app;
