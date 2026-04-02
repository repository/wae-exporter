# wae-exporter

A Cloudflare Worker that exposes [Workers Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/) data as a Prometheus-compatible `/metrics` endpoint.

Configure SQL queries in `src/queries.ts`, deploy the worker, and point your Prometheus scraper at it.

## How it works

On each scrape request to `/metrics`:

1. All configured queries run in parallel against the WAE SQL API
2. Results are mapped to Prometheus metrics (counters, gauges, histograms)
3. The response is returned in Prometheus text exposition format

Failed queries don't break the scrape. Two meta-metrics are always included:

- `wae_exporter_scrape_errors` - number of queries that failed
- `wae_exporter_scrape_duration_seconds` - time taken for the scrape

## Setup

### 1. Set your account ID

Edit `wrangler.jsonc` and replace the `WAE_ACCOUNT_ID` placeholder:

```jsonc
"vars": {
  "WAE_ACCOUNT_ID": "your-account-id-here"
}
```

### 2. Set secrets

```sh
pnpm wrangler secret put WAE_API_TOKEN   # Cloudflare API token with Account Analytics Read
pnpm wrangler secret put SCRAPE_TOKEN    # Bearer token your Prometheus sends
```

### 3. Configure queries

Edit `src/queries.ts`. Each query has a SQL string and one or more metric definitions:

```typescript
const queries: QueryDefinition[] = [
  {
    sql: `
      SELECT
        blob1 AS endpoint,
        SUM(_sample_interval * double1) AS request_count
      FROM my_dataset
      WHERE timestamp > NOW() - INTERVAL '5' MINUTE
      GROUP BY blob1
    `,
    metrics: [
      {
        name: "myapp_http_requests_total",
        type: "counter",
        help: "Total HTTP requests by endpoint",
        value: "request_count",
        labels: { endpoint: "endpoint" },
      },
    ],
  },
];
```

See `src/config.ts` for the full type definitions.

### Metric types

**Counter/Gauge**: one value column per metric, one sample per row.

**Histogram**: column-per-bucket layout. Compute bucket counts in SQL with `sumIf()`:

```typescript
{
  sql: `
    SELECT
      blob1 AS endpoint,
      sumIf(_sample_interval, double1 <= 0.1) AS b_01,
      sumIf(_sample_interval, double1 <= 1) AS b_1,
      SUM(_sample_interval) AS obs_count,
      SUM(_sample_interval * double1) AS obs_sum
    FROM latency_dataset
    WHERE timestamp > NOW() - INTERVAL '5' MINUTE
    GROUP BY blob1
  `,
  metrics: [
    {
      name: "http_request_duration_seconds",
      type: "histogram",
      help: "Request latency",
      buckets: { b_01: 0.1, b_1: 1 },
      sum: "obs_sum",
      total: "obs_count",
      labels: { endpoint: "endpoint" },
    },
  ],
}
```

A `+Inf` bucket is auto-appended if you don't include one.

### 4. Deploy

```sh
pnpm deploy
```

### 5. Configure Prometheus

```yaml
scrape_configs:
  - job_name: wae-exporter
    scheme: https
    authorization:
      credentials: "<your-scrape-token>"
    static_configs:
      - targets: ["wae-exporter.<your-subdomain>.workers.dev"]
```

## Development

```sh
pnpm install        # install dependencies
pnpm dev            # local dev server on :8787
pnpm test           # run tests
pnpm lint:check     # lint
pnpm fmt:check      # check formatting
pnpm fix            # auto-fix lint + formatting
pnpm typegen        # regenerate Env types after changing wrangler.jsonc
```

## Project structure

```
src/
  config.ts       - TypeScript interfaces (QueryDefinition, MetricDefinition)
  queries.ts      - your query definitions (edit this)
  index.ts        - Hono app, routing, auth, orchestration
  wae.ts          - WAE SQL API client
  prometheus.ts   - Prometheus text format serializer
test/
  prometheus.test.ts - unit tests for formatting/mapping
  index.spec.ts      - integration tests with mocked WAE client
```
