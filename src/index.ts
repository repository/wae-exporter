import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { formatMetrics, mapQueryResult, type SerializedMetric } from "./prometheus";
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

  const results = await Promise.allSettled(
    queries.map((q) =>
      queryWae(c.env.WAE_ACCOUNT_ID, c.env.WAE_API_TOKEN, q.sql).then((result) =>
        mapQueryResult(result.data, q.metrics),
      ),
    ),
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

  allMetrics.push({
    name: "wae_exporter_scrape_errors",
    type: "gauge",
    help: "Number of WAE queries that failed during this scrape",
    samples: [{ labels: {}, value: errors }],
  });
  allMetrics.push({
    name: "wae_exporter_scrape_duration_seconds",
    type: "gauge",
    help: "Time taken to complete the scrape",
    samples: [{ labels: {}, value: duration }],
  });

  return c.text(formatMetrics(allMetrics), 200, {
    "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
  });
});

export default app;
