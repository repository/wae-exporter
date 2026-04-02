import type { QueryDefinition } from "./config";

const queries: QueryDefinition[] = [
  {
    sql: `
			SELECT
				blob1 AS endpoint,
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
        labels: { endpoint: "endpoint" },
      },
      {
        name: "myapp_http_errors_total",
        type: "counter",
        help: "Total HTTP errors by endpoint",
        value: "error_count",
        labels: { endpoint: "endpoint" },
      },
    ],
  },
];

export default queries;
