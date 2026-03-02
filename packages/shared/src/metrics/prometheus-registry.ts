/**
 * Lightweight Prometheus text exposition format renderer.
 *
 * Supports gauge, counter, and histogram metric types with optional labels.
 * No external dependencies — just string formatting.
 */

type MetricType = 'gauge' | 'counter' | 'histogram';

type LabelSet = Record<string, string>;

type MetricSample = {
  labels: LabelSet;
  value: number;
};

type HistogramSample = {
  labels: LabelSet;
  sum: number;
  count: number;
  buckets: { le: number; count: number }[];
};

type MetricEntry = {
  name: string;
  help: string;
  type: MetricType;
  samples: MetricSample[];
  histogramSamples: HistogramSample[];
};

const DEFAULT_HISTOGRAM_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

/**
 * Escape a label value for Prometheus text format.
 * Backslash, double-quote, and newline must be escaped.
 */
function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/**
 * Format a label set as `{key="value",key2="value2"}`.
 * Returns an empty string when there are no labels.
 */
function formatLabels(labels: LabelSet): string {
  const keys = Object.keys(labels);
  if (keys.length === 0) {
    return '';
  }
  const pairs = keys.map((k) => `${k}="${escapeLabelValue(labels[k])}"`);
  return `{${pairs.join(',')}}`;
}

/**
 * Format a numeric value for Prometheus output.
 * Integers are rendered without a decimal point; floats use standard notation.
 * Special values: +Inf, -Inf, NaN.
 */
function formatValue(value: number): string {
  if (value === Number.POSITIVE_INFINITY) {
    return '+Inf';
  }
  if (value === Number.NEGATIVE_INFINITY) {
    return '-Inf';
  }
  if (Number.isNaN(value)) {
    return 'NaN';
  }
  return String(value);
}

export class PrometheusRegistry {
  private readonly metrics: Map<string, MetricEntry> = new Map();

  /**
   * Register a new metric. If the metric already exists, this is a no-op
   * (existing samples are preserved).
   */
  register(name: string, help: string, type: MetricType): void {
    if (this.metrics.has(name)) {
      return;
    }
    this.metrics.set(name, {
      name,
      help,
      type,
      samples: [],
      histogramSamples: [],
    });
  }

  /**
   * Set the value of a gauge or counter metric.
   *
   * For a metric without labels, pass an empty object `{}` or omit labels.
   * For a metric with labels, provide the label key-value pairs.
   *
   * If a sample with the exact same label set already exists, its value is
   * replaced. Otherwise a new sample is appended.
   */
  set(name: string, value: number, labels: LabelSet = {}): void {
    const entry = this.metrics.get(name);
    if (!entry) {
      return;
    }

    const existing = entry.samples.find((s) => labelsEqual(s.labels, labels));
    if (existing) {
      existing.value = value;
    } else {
      entry.samples.push({ labels, value });
    }
  }

  /**
   * Increment the value of a counter or gauge metric.
   * Creates the sample with the given increment if it doesn't exist yet.
   */
  inc(name: string, labels: LabelSet = {}, delta: number = 1): void {
    const entry = this.metrics.get(name);
    if (!entry) {
      return;
    }

    const existing = entry.samples.find((s) => labelsEqual(s.labels, labels));
    if (existing) {
      existing.value += delta;
    } else {
      entry.samples.push({ labels, value: delta });
    }
  }

  /**
   * Observe a value for a histogram metric.
   *
   * The histogram is identified by name + labels. If no histogram sample
   * exists for that combination yet, one is created with the default
   * or previously-configured buckets.
   */
  observe(
    name: string,
    value: number,
    labels: LabelSet = {},
    buckets: number[] = DEFAULT_HISTOGRAM_BUCKETS,
  ): void {
    const entry = this.metrics.get(name);
    if (!entry || entry.type !== 'histogram') {
      return;
    }

    let sample = entry.histogramSamples.find((s) => labelsEqual(s.labels, labels));
    if (!sample) {
      sample = {
        labels,
        sum: 0,
        count: 0,
        buckets: buckets.map((le) => ({ le, count: 0 })),
      };
      entry.histogramSamples.push(sample);
    }

    sample.sum += value;
    sample.count += 1;

    for (const bucket of sample.buckets) {
      if (value <= bucket.le) {
        bucket.count += 1;
      }
    }
  }

  /**
   * Render all registered metrics in Prometheus text exposition format.
   */
  render(): string {
    const lines: string[] = [];

    for (const entry of this.metrics.values()) {
      lines.push(`# HELP ${entry.name} ${entry.help}`);
      lines.push(`# TYPE ${entry.name} ${entry.type}`);

      if (entry.type === 'histogram') {
        for (const hs of entry.histogramSamples) {
          const baseLabels = formatLabels(hs.labels);

          for (const bucket of hs.buckets) {
            const leLabel =
              bucket.le === Number.POSITIVE_INFINITY ? '+Inf' : formatValue(bucket.le);
            const bucketLabels = mergeLabels(hs.labels, { le: leLabel });
            lines.push(`${entry.name}_bucket${formatLabels(bucketLabels)} ${bucket.count}`);
          }

          // +Inf bucket
          const infLabels = mergeLabels(hs.labels, { le: '+Inf' });
          lines.push(`${entry.name}_bucket${formatLabels(infLabels)} ${hs.count}`);

          lines.push(`${entry.name}_sum${baseLabels} ${formatValue(hs.sum)}`);
          lines.push(`${entry.name}_count${baseLabels} ${hs.count}`);
        }
      } else {
        for (const sample of entry.samples) {
          lines.push(`${entry.name}${formatLabels(sample.labels)} ${formatValue(sample.value)}`);
        }
      }
    }

    // Prometheus expects a trailing newline
    if (lines.length > 0) {
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Remove all samples for a given metric, but keep the metric registered.
   */
  reset(name: string): void {
    const entry = this.metrics.get(name);
    if (entry) {
      entry.samples = [];
      entry.histogramSamples = [];
    }
  }

  /**
   * Remove a metric entirely from the registry.
   */
  unregister(name: string): void {
    this.metrics.delete(name);
  }

  /**
   * Remove all metrics from the registry.
   */
  clear(): void {
    this.metrics.clear();
  }
}

/**
 * Compare two label sets for deep equality.
 */
function labelsEqual(a: LabelSet, b: LabelSet): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) {
    return false;
  }
  for (const key of keysA) {
    if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
}

/**
 * Merge two label sets, with `extra` overriding keys in `base`.
 */
function mergeLabels(base: LabelSet, extra: LabelSet): LabelSet {
  return { ...base, ...extra };
}
