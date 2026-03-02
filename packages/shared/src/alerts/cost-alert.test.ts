import { beforeEach, describe, expect, it } from 'vitest';

import type { CostAlert } from './cost-alert.js';
import { CostAlertMonitor } from './cost-alert.js';

describe('CostAlertMonitor', () => {
  let monitor: CostAlertMonitor;

  beforeEach(() => {
    monitor = new CostAlertMonitor();
  });

  // ── Cost threshold: warning at 80% ──────────────────────────────────────

  it('returns a warning alert when cost reaches 80% of limit', () => {
    const alerts = monitor.checkCost('agent-1', 8.0, 10.0);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('warning');
    expect(alerts[0].alertType).toBe('cost_threshold');
    expect(alerts[0].agentId).toBe('agent-1');
    expect(alerts[0].percentage).toBe(80);
  });

  it('returns no alert when cost is below 80% of limit', () => {
    const alerts = monitor.checkCost('agent-1', 7.9, 10.0);

    expect(alerts).toHaveLength(0);
  });

  it('returns a warning alert when cost is just above 80%', () => {
    const alerts = monitor.checkCost('agent-1', 8.01, 10.0);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('warning');
    expect(alerts[0].percentage).toBeCloseTo(80.1, 1);
  });

  // ── Cost threshold: critical at 95% ─────────────────────────────────────

  it('returns both warning and critical alerts when cost reaches 95%', () => {
    const alerts = monitor.checkCost('agent-1', 9.5, 10.0);

    expect(alerts).toHaveLength(2);
    expect(alerts[0].severity).toBe('warning');
    expect(alerts[1].severity).toBe('critical');
    expect(alerts[1].percentage).toBe(95);
  });

  it('returns both warning and critical when cost exceeds 100%', () => {
    const alerts = monitor.checkCost('agent-1', 10.5, 10.0);

    expect(alerts).toHaveLength(2);
    expect(alerts[0].severity).toBe('warning');
    expect(alerts[1].severity).toBe('critical');
    expect(alerts[1].percentage).toBe(105);
  });

  // ── Duration threshold alerts ───────────────────────────────────────────

  it('returns a warning alert when duration reaches 80% of limit', () => {
    const alerts = monitor.checkDuration('agent-2', 80_000, 100_000);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('warning');
    expect(alerts[0].alertType).toBe('duration_threshold');
    expect(alerts[0].currentValue).toBe(80_000);
    expect(alerts[0].limitValue).toBe(100_000);
  });

  it('returns warning and critical alerts when duration reaches 95%', () => {
    const alerts = monitor.checkDuration('agent-2', 95_000, 100_000);

    expect(alerts).toHaveLength(2);
    expect(alerts[0].severity).toBe('warning');
    expect(alerts[1].severity).toBe('critical');
    expect(alerts[1].alertType).toBe('duration_threshold');
  });

  it('returns no duration alert when below threshold', () => {
    const alerts = monitor.checkDuration('agent-2', 50_000, 100_000);

    expect(alerts).toHaveLength(0);
  });

  // ── Iteration threshold alerts ──────────────────────────────────────────

  it('returns a warning alert when iterations reach 80% of max', () => {
    const alerts = monitor.checkIterations('agent-3', 80, 100);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('warning');
    expect(alerts[0].alertType).toBe('iteration_threshold');
    expect(alerts[0].currentValue).toBe(80);
    expect(alerts[0].limitValue).toBe(100);
  });

  it('returns warning and critical alerts when iterations reach 95% of max', () => {
    const alerts = monitor.checkIterations('agent-3', 95, 100);

    expect(alerts).toHaveLength(2);
    expect(alerts[0].severity).toBe('warning');
    expect(alerts[1].severity).toBe('critical');
  });

  it('returns no iteration alert when below threshold', () => {
    const alerts = monitor.checkIterations('agent-3', 50, 100);

    expect(alerts).toHaveLength(0);
  });

  // ── Duplicate alert suppression ─────────────────────────────────────────

  it('does not return duplicate warning alerts for the same agent and type', () => {
    const first = monitor.checkCost('agent-1', 8.5, 10.0);
    const second = monitor.checkCost('agent-1', 8.7, 10.0);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it('does not return duplicate critical alerts for the same agent and type', () => {
    const first = monitor.checkCost('agent-1', 9.5, 10.0);
    const second = monitor.checkCost('agent-1', 9.8, 10.0);

    expect(first).toHaveLength(2); // warning + critical
    expect(second).toHaveLength(0); // both already sent
  });

  it('returns critical alert after warning was already sent', () => {
    // First call: only warning
    const first = monitor.checkCost('agent-1', 8.5, 10.0);
    expect(first).toHaveLength(1);
    expect(first[0].severity).toBe('warning');

    // Second call: cost increased to critical, warning already sent
    const second = monitor.checkCost('agent-1', 9.6, 10.0);
    expect(second).toHaveLength(1);
    expect(second[0].severity).toBe('critical');
  });

  // ── hasAlerted tracking ─────────────────────────────────────────────────

  it('tracks alerted state correctly', () => {
    expect(monitor.hasAlerted('agent-1', 'cost_threshold', 'warning')).toBe(false);

    monitor.checkCost('agent-1', 8.5, 10.0);

    expect(monitor.hasAlerted('agent-1', 'cost_threshold', 'warning')).toBe(true);
    expect(monitor.hasAlerted('agent-1', 'cost_threshold', 'critical')).toBe(false);
  });

  // ── Reset clears alert history ──────────────────────────────────────────

  it('allows alerts to fire again after reset', () => {
    monitor.checkCost('agent-1', 8.5, 10.0);
    expect(monitor.hasAlerted('agent-1', 'cost_threshold', 'warning')).toBe(true);

    monitor.reset('agent-1');

    expect(monitor.hasAlerted('agent-1', 'cost_threshold', 'warning')).toBe(false);

    const alerts = monitor.checkCost('agent-1', 8.5, 10.0);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('warning');
  });

  it('only resets alerts for the specified agent', () => {
    monitor.checkCost('agent-1', 8.5, 10.0);
    monitor.checkCost('agent-2', 8.5, 10.0);

    monitor.reset('agent-1');

    expect(monitor.hasAlerted('agent-1', 'cost_threshold', 'warning')).toBe(false);
    expect(monitor.hasAlerted('agent-2', 'cost_threshold', 'warning')).toBe(true);
  });

  // ── Custom threshold percentages ────────────────────────────────────────

  it('respects custom warning threshold percentage', () => {
    const custom = new CostAlertMonitor({ warningThresholdPct: 50 });

    const alerts = custom.checkCost('agent-1', 5.0, 10.0);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('warning');
    expect(alerts[0].percentage).toBe(50);
  });

  it('respects custom critical threshold percentage', () => {
    const custom = new CostAlertMonitor({ criticalThresholdPct: 90 });

    const alerts = custom.checkCost('agent-1', 9.0, 10.0);

    expect(alerts).toHaveLength(2); // warning at default 80, critical at custom 90
    expect(alerts[1].severity).toBe('critical');
  });

  it('respects both custom thresholds together', () => {
    const custom = new CostAlertMonitor({
      warningThresholdPct: 60,
      criticalThresholdPct: 85,
    });

    // At 70%: warning only (above 60%, below 85%)
    const alerts70 = custom.checkCost('agent-1', 7.0, 10.0);
    expect(alerts70).toHaveLength(1);
    expect(alerts70[0].severity).toBe('warning');

    // At 90%: critical only (warning already sent)
    const alerts90 = custom.checkCost('agent-1', 9.0, 10.0);
    expect(alerts90).toHaveLength(1);
    expect(alerts90[0].severity).toBe('critical');
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  it('returns no alerts when limit is zero', () => {
    const alerts = monitor.checkCost('agent-1', 5.0, 0);

    expect(alerts).toHaveLength(0);
  });

  it('returns no alerts when limit is negative', () => {
    const alerts = monitor.checkCost('agent-1', 5.0, -10.0);

    expect(alerts).toHaveLength(0);
  });

  it('handles exact boundary value at 80% (inclusive)', () => {
    const alerts = monitor.checkCost('agent-1', 80, 100);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('warning');
    expect(alerts[0].percentage).toBe(80);
  });

  it('handles exact boundary value at 95% (inclusive)', () => {
    const alerts = monitor.checkCost('agent-1', 95, 100);

    expect(alerts).toHaveLength(2);
    expect(alerts[1].severity).toBe('critical');
    expect(alerts[1].percentage).toBe(95);
  });

  it('handles zero current value', () => {
    const alerts = monitor.checkCost('agent-1', 0, 10.0);

    expect(alerts).toHaveLength(0);
  });

  // ── Multiple agents tracked independently ───────────────────────────────

  it('tracks alerts independently for different agents', () => {
    const alertsA = monitor.checkCost('agent-a', 8.5, 10.0);
    const alertsB = monitor.checkCost('agent-b', 8.5, 10.0);

    expect(alertsA).toHaveLength(1);
    expect(alertsB).toHaveLength(1);
    expect(alertsA[0].agentId).toBe('agent-a');
    expect(alertsB[0].agentId).toBe('agent-b');
  });

  it('tracks different alert types independently for the same agent', () => {
    const costAlerts = monitor.checkCost('agent-1', 8.5, 10.0);
    const durationAlerts = monitor.checkDuration('agent-1', 85_000, 100_000);
    const iterationAlerts = monitor.checkIterations('agent-1', 82, 100);

    expect(costAlerts).toHaveLength(1);
    expect(durationAlerts).toHaveLength(1);
    expect(iterationAlerts).toHaveLength(1);

    expect(monitor.hasAlerted('agent-1', 'cost_threshold', 'warning')).toBe(true);
    expect(monitor.hasAlerted('agent-1', 'duration_threshold', 'warning')).toBe(true);
    expect(monitor.hasAlerted('agent-1', 'iteration_threshold', 'warning')).toBe(true);
  });

  // ── Alert message and fields ────────────────────────────────────────────

  it('includes correct fields in the alert object', () => {
    const alerts = monitor.checkCost('agent-x', 9.5, 10.0);
    const critical = alerts.find((a) => a.severity === 'critical') as CostAlert;

    expect(critical).toBeDefined();
    expect(critical.agentId).toBe('agent-x');
    expect(critical.alertType).toBe('cost_threshold');
    expect(critical.currentValue).toBe(9.5);
    expect(critical.limitValue).toBe(10.0);
    expect(critical.percentage).toBe(95);
    expect(critical.message).toContain('agent-x');
    expect(critical.message).toContain('95.0%');
    expect(critical.timestamp).toBeTruthy();
  });

  it('produces a valid ISO 8601 timestamp', () => {
    const alerts = monitor.checkCost('agent-1', 8.5, 10.0);

    expect(alerts).toHaveLength(1);
    const parsed = new Date(alerts[0].timestamp);
    expect(parsed.getTime()).not.toBeNaN();
  });

  // ── Combined scenario ───────────────────────────────────────────────────

  it('handles a full lifecycle: warn, critical, reset, warn again', () => {
    // Phase 1: warning
    const phase1 = monitor.checkCost('agent-1', 8.5, 10.0);
    expect(phase1).toHaveLength(1);
    expect(phase1[0].severity).toBe('warning');

    // Phase 2: critical (warning already sent)
    const phase2 = monitor.checkCost('agent-1', 9.6, 10.0);
    expect(phase2).toHaveLength(1);
    expect(phase2[0].severity).toBe('critical');

    // Phase 3: no new alerts
    const phase3 = monitor.checkCost('agent-1', 9.9, 10.0);
    expect(phase3).toHaveLength(0);

    // Phase 4: reset and re-trigger
    monitor.reset('agent-1');
    const phase4 = monitor.checkCost('agent-1', 8.2, 10.0);
    expect(phase4).toHaveLength(1);
    expect(phase4[0].severity).toBe('warning');
  });
});
