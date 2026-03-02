import { beforeEach, describe, expect, it } from 'vitest';

import { PrometheusRegistry } from './prometheus-registry.js';

describe('PrometheusRegistry', () => {
  let registry: PrometheusRegistry;

  beforeEach(() => {
    registry = new PrometheusRegistry();
  });

  // ── Empty registry ─────────────────────────────────────────────────────

  it('renders empty string when no metrics are registered', () => {
    expect(registry.render()).toBe('');
  });

  // ── Gauge metrics ──────────────────────────────────────────────────────

  it('renders a gauge metric without labels', () => {
    registry.register('my_gauge', 'A simple gauge', 'gauge');
    registry.set('my_gauge', 42);

    const output = registry.render();
    expect(output).toContain('# HELP my_gauge A simple gauge');
    expect(output).toContain('# TYPE my_gauge gauge');
    expect(output).toContain('my_gauge 42');
  });

  it('renders a gauge metric with labels', () => {
    registry.register('http_active', 'Active HTTP connections', 'gauge');
    registry.set('http_active', 5, { handler: '/api', method: 'GET' });

    const output = registry.render();
    expect(output).toContain('http_active{handler="/api",method="GET"} 5');
  });

  it('updates an existing gauge value for the same label set', () => {
    registry.register('temp', 'Temperature', 'gauge');
    registry.set('temp', 20, { location: 'office' });
    registry.set('temp', 25, { location: 'office' });

    const output = registry.render();
    const matches = output.match(/temp\{location="office"\} \d+/g);
    expect(matches).toHaveLength(1);
    expect(output).toContain('temp{location="office"} 25');
  });

  it('keeps separate samples for different label sets', () => {
    registry.register('requests', 'Request count', 'gauge');
    registry.set('requests', 10, { path: '/a' });
    registry.set('requests', 20, { path: '/b' });

    const output = registry.render();
    expect(output).toContain('requests{path="/a"} 10');
    expect(output).toContain('requests{path="/b"} 20');
  });

  // ── Counter metrics ────────────────────────────────────────────────────

  it('renders a counter metric without labels', () => {
    registry.register('events_total', 'Total events', 'counter');
    registry.set('events_total', 100);

    const output = registry.render();
    expect(output).toContain('# TYPE events_total counter');
    expect(output).toContain('events_total 100');
  });

  it('increments a counter with inc()', () => {
    registry.register('errors_total', 'Total errors', 'counter');
    registry.inc('errors_total');
    registry.inc('errors_total');
    registry.inc('errors_total', {}, 3);

    const output = registry.render();
    expect(output).toContain('errors_total 5');
  });

  it('increments a counter with labels', () => {
    registry.register('http_requests_total', 'HTTP requests', 'counter');
    registry.inc('http_requests_total', { method: 'GET', status: '200' });
    registry.inc('http_requests_total', { method: 'GET', status: '200' });
    registry.inc('http_requests_total', { method: 'POST', status: '201' });

    const output = registry.render();
    expect(output).toContain('http_requests_total{method="GET",status="200"} 2');
    expect(output).toContain('http_requests_total{method="POST",status="201"} 1');
  });

  // ── Histogram metrics ──────────────────────────────────────────────────

  it('renders a histogram with default buckets', () => {
    registry.register('request_duration', 'Request duration', 'histogram');
    registry.observe('request_duration', 0.05);
    registry.observe('request_duration', 0.15);
    registry.observe('request_duration', 1.5);

    const output = registry.render();
    expect(output).toContain('# TYPE request_duration histogram');
    expect(output).toContain('request_duration_sum 1.7');
    expect(output).toContain('request_duration_count 3');
    // 0.05 fits in 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10 buckets
    expect(output).toContain('request_duration_bucket{le="0.05"} 1');
    // 0.15 fits in 0.25, 0.5, 1, 2.5, 5, 10 buckets
    expect(output).toContain('request_duration_bucket{le="0.1"} 1');
    expect(output).toContain('request_duration_bucket{le="0.25"} 2');
    // +Inf always contains all observations
    expect(output).toContain('request_duration_bucket{le="+Inf"} 3');
  });

  it('renders a histogram with custom buckets', () => {
    registry.register('custom_hist', 'Custom histogram', 'histogram');
    registry.observe('custom_hist', 5, {}, [1, 10, 100]);
    registry.observe('custom_hist', 50, {}, [1, 10, 100]);

    const output = registry.render();
    expect(output).toContain('custom_hist_bucket{le="1"} 0');
    expect(output).toContain('custom_hist_bucket{le="10"} 1');
    expect(output).toContain('custom_hist_bucket{le="100"} 2');
    expect(output).toContain('custom_hist_bucket{le="+Inf"} 2');
    expect(output).toContain('custom_hist_sum 55');
    expect(output).toContain('custom_hist_count 2');
  });

  it('renders a histogram with labels', () => {
    registry.register('api_latency', 'API latency', 'histogram');
    registry.observe('api_latency', 0.1, { method: 'GET' }, [0.1, 0.5, 1]);
    registry.observe('api_latency', 0.3, { method: 'GET' }, [0.1, 0.5, 1]);

    const output = registry.render();
    expect(output).toContain('api_latency_bucket{method="GET",le="0.1"} 1');
    expect(output).toContain('api_latency_bucket{method="GET",le="0.5"} 2');
    expect(output).toContain('api_latency_bucket{method="GET",le="1"} 2');
    expect(output).toContain('api_latency_bucket{method="GET",le="+Inf"} 2');
    expect(output).toContain('api_latency_sum{method="GET"} 0.4');
    expect(output).toContain('api_latency_count{method="GET"} 2');
  });

  // ── Label escaping ─────────────────────────────────────────────────────

  it('escapes special characters in label values', () => {
    registry.register('escaped', 'Escaped labels', 'gauge');
    registry.set('escaped', 1, { path: '/api?q="test"' });

    const output = registry.render();
    expect(output).toContain('escaped{path="/api?q=\\"test\\""} 1');
  });

  it('escapes backslashes and newlines in label values', () => {
    registry.register('special', 'Special chars', 'gauge');
    registry.set('special', 1, { msg: 'line1\nline2\\end' });

    const output = registry.render();
    expect(output).toContain('special{msg="line1\\nline2\\\\end"} 1');
  });

  // ── Multiple metrics ordering ──────────────────────────────────────────

  it('renders multiple metrics with HELP and TYPE headers for each', () => {
    registry.register('metric_a', 'First metric', 'gauge');
    registry.register('metric_b', 'Second metric', 'counter');
    registry.set('metric_a', 1);
    registry.set('metric_b', 2);

    const output = registry.render();
    expect(output).toContain('# HELP metric_a First metric');
    expect(output).toContain('# TYPE metric_a gauge');
    expect(output).toContain('metric_a 1');
    expect(output).toContain('# HELP metric_b Second metric');
    expect(output).toContain('# TYPE metric_b counter');
    expect(output).toContain('metric_b 2');
  });

  // ── Trailing newline ───────────────────────────────────────────────────

  it('ends output with a trailing newline when metrics are present', () => {
    registry.register('up', 'Up gauge', 'gauge');
    registry.set('up', 1);

    const output = registry.render();
    expect(output.endsWith('\n')).toBe(true);
  });

  // ── Reset & unregister ─────────────────────────────────────────────────

  it('resets samples for a metric without removing the registration', () => {
    registry.register('temp', 'Temperature', 'gauge');
    registry.set('temp', 30);
    registry.reset('temp');

    const output = registry.render();
    expect(output).toContain('# HELP temp');
    expect(output).toContain('# TYPE temp gauge');
    expect(output).not.toContain('temp 30');
  });

  it('unregisters a metric entirely', () => {
    registry.register('temp', 'Temperature', 'gauge');
    registry.set('temp', 30);
    registry.unregister('temp');

    const output = registry.render();
    expect(output).not.toContain('temp');
  });

  it('clears all metrics from the registry', () => {
    registry.register('a', 'A', 'gauge');
    registry.register('b', 'B', 'counter');
    registry.set('a', 1);
    registry.set('b', 2);
    registry.clear();

    expect(registry.render()).toBe('');
  });

  // ── No-op on unknown metric ────────────────────────────────────────────

  it('ignores set/inc/observe calls for unregistered metrics', () => {
    registry.set('nonexistent', 42);
    registry.inc('nonexistent');
    registry.observe('nonexistent', 1.0);

    // Should not throw, just silently ignore
    expect(registry.render()).toBe('');
  });

  // ── Observe on non-histogram is a no-op ────────────────────────────────

  it('ignores observe calls on non-histogram metrics', () => {
    registry.register('gauge_metric', 'A gauge', 'gauge');
    registry.observe('gauge_metric', 1.0);

    const output = registry.render();
    // No histogram lines should appear; gauge should have no samples
    expect(output).not.toContain('_bucket');
    expect(output).not.toContain('_sum');
    expect(output).not.toContain('_count');
  });

  // ── Duplicate registration is a no-op ──────────────────────────────────

  it('preserves existing samples when registering a metric name twice', () => {
    registry.register('dup', 'First', 'gauge');
    registry.set('dup', 99);
    registry.register('dup', 'Second', 'counter');

    const output = registry.render();
    // Original registration preserved
    expect(output).toContain('# HELP dup First');
    expect(output).toContain('# TYPE dup gauge');
    expect(output).toContain('dup 99');
  });

  // ── Registered metric with no samples ──────────────────────────────────

  it('renders HELP and TYPE lines even when a metric has no samples', () => {
    registry.register('empty_metric', 'No samples yet', 'gauge');

    const output = registry.render();
    expect(output).toContain('# HELP empty_metric No samples yet');
    expect(output).toContain('# TYPE empty_metric gauge');
  });

  // ── Floating point values ──────────────────────────────────────────────

  it('renders floating-point values correctly', () => {
    registry.register('float_gauge', 'Float value', 'gauge');
    registry.set('float_gauge', Math.PI);

    const output = registry.render();
    expect(output).toContain('float_gauge 3.14159');
  });
});
