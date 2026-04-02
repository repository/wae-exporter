/**
 * Defines where a label's value comes from.
 *
 * - `string` - column name shorthand: read the value from a SQL result column
 * - `{ value: string }` - static: always use this fixed value
 * - `{ fn: (row) => string }` - computed: derive the value from the full row
 *
 * @example "endpoint"
 * @example { value: "us-west-1" }
 * @example { fn: (row) => Number(row.bytes) > 1_000_000 ? "large" : "small" }
 */
export type LabelSource =
  | string
  | { value: string }
  | { fn: (row: Record<string, unknown>) => string };

interface BaseMetric {
  /** Prometheus metric name. Use snake_case with a prefix.
   * @example "myapp_http_requests_total"
   * @example "myapp_request_duration_seconds"
   */
  name: string;
  /** Human-readable description shown in `# HELP` line. Omit to skip the HELP line.
   * @example "Total HTTP requests by endpoint"
   */
  help?: string;
  /** Maps Prometheus label names to their source.
   *
   * Keys are the label names that appear in the Prometheus output.
   * Values define where the label value comes from: a SQL column name (string),
   * a fixed value (`{ value }`), or a function (`{ fn }`).
   *
   * @example { endpoint: "endpoint", region: { value: "us-west-1" } }
   */
  labels?: Record<string, LabelSource>;
}

/**
 * A counter or gauge metric. Each row in the SQL result produces one sample.
 *
 * @example
 * {
 *   name: "myapp_http_requests_total",
 *   type: "counter",
 *   help: "Total HTTP requests by endpoint",
 *   value: "request_count",
 *   labels: {
 *     endpoint: "endpoint",
 *     env: { value: "production" },
 *   },
 * }
 */
export interface ScalarMetric extends BaseMetric {
  type: "counter" | "gauge";
  /** SQL result column name that holds the numeric value for this metric. */
  value: string;
}

/**
 * A histogram metric using column-per-bucket layout.
 *
 * Each SQL result row represents one label set. Bucket counts are read from
 * separate columns (one column per le boundary), computed in your SQL with
 * `sumIf()` or `if()` expressions.
 *
 * @example
 * // SQL:
 * //   SELECT
 * //     blob1 AS endpoint,
 * //     sumIf(_sample_interval, double1 <= 0.01) AS b_001,
 * //     sumIf(_sample_interval, double1 <= 0.1) AS b_01,
 * //     sumIf(_sample_interval, double1 <= 1) AS b_1,
 * //     SUM(_sample_interval) AS obs_count,
 * //     SUM(_sample_interval * double1) AS obs_sum
 * //   FROM latency_dataset
 * //   WHERE timestamp > NOW() - INTERVAL '5' MINUTE
 * //   GROUP BY blob1
 * //
 * // Config:
 * {
 *   name: "http_request_duration_seconds",
 *   type: "histogram",
 *   help: "HTTP request latency",
 *   buckets: { b_001: 0.01, b_01: 0.1, b_1: 1 },
 *   sum: "obs_sum",
 *   total: "obs_count",
 *   labels: { endpoint: "endpoint" },
 * }
 */
export interface HistogramMetric extends BaseMetric {
  type: "histogram";
  /** Maps SQL result column names to their `le` (less-than-or-equal) upper bound.
   * A `+Inf` bucket is auto-appended if no entry maps to `Infinity`.
   * @example { b_001: 0.01, b_01: 0.1, b_1: 1, b_inf: Infinity }
   */
  buckets: Record<string, number>;
  /** SQL result column name for the observation sum (emitted as `_sum`). Optional. */
  sum?: string;
  /** SQL result column name for the total observation count (emitted as `_count`). Optional. */
  total?: string;
}

/** A metric definition. Discriminated on {@link ScalarMetric.type | type}. */
export type MetricDefinition = ScalarMetric | HistogramMetric;

/**
 * A SQL query to run against Workers Analytics Engine, along with the
 * Prometheus metrics to extract from its results.
 *
 * One query can produce multiple metrics when the SQL returns several
 * value columns from the same GROUP BY.
 *
 * @example
 * {
 *   sql: `
 *     SELECT
 *       blob1 AS endpoint,
 *       SUM(_sample_interval * double1) AS request_count,
 *       SUM(_sample_interval * double2) AS error_count
 *     FROM my_dataset
 *     WHERE timestamp > NOW() - INTERVAL '5' MINUTE
 *     GROUP BY blob1
 *   `,
 *   metrics: [
 *     {
 *       name: "myapp_http_requests_total",
 *       type: "counter",
 *       help: "Total HTTP requests by endpoint",
 *       value: "request_count",
 *       labels: { endpoint: "endpoint" },
 *     },
 *     {
 *       name: "myapp_http_errors_total",
 *       type: "counter",
 *       help: "Total HTTP errors by endpoint",
 *       value: "error_count",
 *       labels: { endpoint: "endpoint" },
 *     },
 *   ],
 * }
 */
export interface QueryDefinition {
  /**
   * SQL query to execute against the WAE SQL API.
   * Use `_sample_interval` for accurate aggregations on sampled data.
   * @see https://developers.cloudflare.com/analytics/analytics-engine/sql-reference/
   */
  sql: string;
  /** Metrics to extract from this query's results. */
  metrics: MetricDefinition[];
}
