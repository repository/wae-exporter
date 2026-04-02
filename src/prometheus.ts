import type { HistogramMetric, LabelSource, MetricDefinition, ScalarMetric } from "./config";

export const META_PREFIX = "wae_exporter";

export interface Sample {
  labels: Record<string, string>;
  value: number;
}

export interface SerializedMetric {
  name: string;
  type: "counter" | "gauge" | "histogram";
  help?: string;
  samples: Sample[];
}

type Row = Record<string, unknown>;

function escapeLabelValue(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function escapeHelpText(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
}

function formatValue(v: number): string {
  if (Number.isNaN(v)) return "NaN";
  if (v === Infinity) return "+Inf";
  if (v === -Infinity) return "-Inf";
  return v.toString();
}

function formatSampleLine(name: string, labels: Record<string, string>, value: number): string {
  const labelEntries = Object.entries(labels);
  let line = name;
  if (labelEntries.length > 0) {
    const pairs = labelEntries.map(([k, v]) => `${k}="${escapeLabelValue(v)}"`);
    line += `{${pairs.join(",")}}`;
  }
  line += ` ${formatValue(value)}`;
  return line;
}

export function formatMetrics(metrics: SerializedMetric[]): string {
  const lines: string[] = [];

  for (const metric of metrics) {
    if (metric.help) {
      lines.push(`# HELP ${metric.name} ${escapeHelpText(metric.help)}`);
    }
    lines.push(`# TYPE ${metric.name} ${metric.type}`);

    if (metric.type === "histogram") {
      for (const sample of metric.samples) {
        const { le, __sum, __count, ...rest } = sample.labels;
        if (le !== undefined) {
          lines.push(formatSampleLine(`${metric.name}_bucket`, { ...rest, le }, sample.value));
        } else if (__sum !== undefined) {
          lines.push(formatSampleLine(`${metric.name}_sum`, rest, sample.value));
        } else if (__count !== undefined) {
          lines.push(formatSampleLine(`${metric.name}_count`, rest, sample.value));
        }
      }
    } else {
      for (const sample of metric.samples) {
        lines.push(formatSampleLine(metric.name, sample.labels, sample.value));
      }
    }
  }

  return lines.length > 0 ? lines.join("\n") + "\n" : "";
}

function resolveLabel(row: Row, source: LabelSource): string {
  if (typeof source === "string") {
    const raw = row[source];
    return typeof raw === "string" ? raw : typeof raw === "number" ? raw.toString() : "";
  }
  if ("value" in source) return source.value;
  return source.fn(row);
}

function resolveLabels(row: Row, labelEntries: [string, LabelSource][]): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const [promLabel, source] of labelEntries) {
    labels[promLabel] = resolveLabel(row, source);
  }
  return labels;
}

function mapScalar(metric: ScalarMetric, data: Row[]): SerializedMetric {
  const labelEntries = Object.entries(metric.labels ?? {});
  const samples: Sample[] = [];

  for (const row of data) {
    const value = Number(row[metric.value]);
    if (Number.isNaN(value)) continue;
    samples.push({ labels: resolveLabels(row, labelEntries), value });
  }

  return { name: metric.name, type: metric.type, help: metric.help, samples };
}

function mapHistogram(metric: HistogramMetric, data: Row[]): SerializedMetric {
  const bucketEntries = Object.entries(metric.buckets)
    .map(([col, le]) => ({ col, le }))
    .sort((a, b) => a.le - b.le);

  const labelEntries = Object.entries(metric.labels ?? {});
  const hasInf = bucketEntries.some((b) => b.le === Infinity);

  const samples: Sample[] = [];

  for (const row of data) {
    const labels = resolveLabels(row, labelEntries);

    for (const bucket of bucketEntries) {
      const value = Number(row[bucket.col]);
      if (Number.isNaN(value)) continue;
      samples.push({ labels: { ...labels, le: formatValue(bucket.le) }, value });
    }

    if (!hasInf && bucketEntries.length > 0) {
      const lastBucket = bucketEntries[bucketEntries.length - 1];
      const infValue = Number(row[lastBucket.col]);
      if (!Number.isNaN(infValue)) {
        samples.push({ labels: { ...labels, le: "+Inf" }, value: infValue });
      }
    }

    if (metric.sum) {
      const sumValue = Number(row[metric.sum]);
      if (!Number.isNaN(sumValue)) {
        samples.push({ labels: { ...labels, __sum: "1" }, value: sumValue });
      }
    }

    if (metric.total) {
      const totalValue = Number(row[metric.total]);
      if (!Number.isNaN(totalValue)) {
        samples.push({ labels: { ...labels, __count: "1" }, value: totalValue });
      }
    }
  }

  return { name: metric.name, type: "histogram", help: metric.help, samples };
}

export function mapQueryResult(data: Row[], metrics: MetricDefinition[]): SerializedMetric[] {
  return metrics.map((metric) => {
    if (metric.type === "histogram") {
      return mapHistogram(metric, data);
    }
    return mapScalar(metric, data);
  });
}

export function scrapeMetrics(
  cf: CfProperties<unknown> | undefined,
  errors: number,
  durationSeconds: number,
  queryDuration: Sample[],
  queryRows: Sample[],
): SerializedMetric[] {
  const labels: Record<string, string> = {};

  if (cf?.colo && typeof cf.colo === "string") labels.colo = cf.colo;

  return [
    {
      name: `${META_PREFIX}_scrape_errors`,
      type: "gauge",
      help: "Number of WAE queries that failed during this scrape",
      samples: [{ labels, value: errors }],
    },
    {
      name: `${META_PREFIX}_scrape_duration_seconds`,
      type: "gauge",
      help: "Time taken to complete the scrape",
      samples: [{ labels, value: durationSeconds }],
    },
    {
      name: `${META_PREFIX}_query_duration_seconds`,
      type: "gauge",
      help: "Time taken for each WAE query",
      samples: queryDuration.map((s) => ({ ...s, labels: { ...labels, ...s.labels } })),
    },
    {
      name: `${META_PREFIX}_query_rows`,
      type: "gauge",
      help: "Number of rows returned by each WAE query",
      samples: queryRows.map((s) => ({ ...s, labels: { ...labels, ...s.labels } })),
    },
  ];
}
