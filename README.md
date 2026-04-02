# wae-exporter

A Cloudflare Worker that exposes [Workers Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/) data as a Prometheus-compatible `/metrics` endpoint.

Configure SQL queries in `src/queries.ts`, deploy the worker, and point your Prometheus scraper at it.

## How it works

On each scrape request to `/metrics`:

1. All configured queries run in parallel against the WAE SQL API
2. Results are mapped to Prometheus metrics (counters, gauges, histograms)
3. The response is returned in Prometheus text exposition format

Failed queries don't break the scrape. The following meta-metrics are always included:

| Metric | Labels | Description |
|--------|--------|-------------|
| `wae_exporter_scrape_errors` | `colo` | Number of queries that failed during this scrape |
| `wae_exporter_scrape_duration_seconds` | `colo` | Total time taken to complete the scrape |
| `wae_exporter_query_duration_seconds` | `colo`, `metric` | Time taken for each WAE query, labeled by metric name |
| `wae_exporter_query_rows` | `colo`, `metric` | Number of rows returned by each WAE query |

The `colo` label comes from the Cloudflare request context and indicates which data center served the scrape (useful with smart placement enabled).

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

Edit `src/queries.ts`. Each query has a SQL string and one or more metric definitions. See `src/config.ts` for the full type definitions.

#### Counter / Gauge

One value column per metric, one sample per row.

```typescript
const queries: QueryDefinition[] = [
  {
    sql: `
      SELECT
        blob1 AS ep,
        SUM(_sample_interval * double1) AS request_count,
        SUM(_sample_interval * double2) AS error_count
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
        labels: { endpoint: "ep" },
      },
      {
        name: "myapp_http_errors_total",
        type: "counter",
        help: "Total HTTP errors by endpoint",
        value: "error_count",
        labels: { endpoint: "ep" },
      },
    ],
  },
];
```

#### Histogram

Column-per-bucket layout. Compute cumulative bucket counts in SQL with `sumIf()`. A `+Inf` bucket is auto-appended if you don't include one.

```typescript
const queries: QueryDefinition[] = [
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
  },
];
```

#### Labels

Label keys are Prometheus label names. Values define where the label value comes from:

```typescript
labels: {
  // String: read from a SQL result column
  endpoint: "endpoint",

  // Static: fixed value on every sample
  region: { value: "us-west-1" },

  // Computed: derive from the full row
  size_class: {
    fn: (row) => Number(row.bytes) > 1_000_000 ? "large" : "small",
  },
}
```

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
  config.ts       - TypeScript interfaces (QueryDefinition, MetricDefinition, LabelSource)
  queries.ts      - your query definitions (edit this)
  index.ts        - Hono app, routing, auth, orchestration
  wae.ts          - WAE SQL API client
  prometheus.ts   - Prometheus text format serializer and meta-metrics
test/
  prometheus.test.ts - unit tests for formatting and query mapping
  index.spec.ts      - integration tests with mocked WAE client
```
