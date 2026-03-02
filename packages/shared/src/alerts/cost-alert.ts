/**
 * Cost alert monitor for agent loop safety.
 *
 * Tracks cost, duration, and iteration thresholds and emits alerts
 * when configurable warning/critical levels are exceeded. Each alert
 * is sent at most once per (agentId, alertType, severity) to avoid
 * flooding downstream consumers.
 */

export type AlertSeverity = 'info' | 'warning' | 'critical';

export type CostAlert = {
  agentId: string;
  alertType: 'cost_threshold' | 'duration_threshold' | 'iteration_threshold';
  severity: AlertSeverity;
  message: string;
  currentValue: number;
  limitValue: number;
  percentage: number;
  timestamp: string;
};

export type CostAlertConfig = {
  /** Percentage threshold to trigger warning alert. Default: 80. */
  warningThresholdPct?: number;
  /** Percentage threshold to trigger critical alert. Default: 95. */
  criticalThresholdPct?: number;
};

const DEFAULT_WARNING_PCT = 80;
const DEFAULT_CRITICAL_PCT = 95;

/**
 * Build a deduplication key for a specific alert instance.
 */
function alertKey(agentId: string, alertType: string, severity: AlertSeverity): string {
  return `${agentId}:${alertType}:${severity}`;
}

export class CostAlertMonitor {
  private readonly warningPct: number;
  private readonly criticalPct: number;
  private readonly sentAlerts: Set<string> = new Set();

  constructor(config?: CostAlertConfig) {
    this.warningPct = config?.warningThresholdPct ?? DEFAULT_WARNING_PCT;
    this.criticalPct = config?.criticalThresholdPct ?? DEFAULT_CRITICAL_PCT;
  }

  /**
   * Check cost against limit and return alerts if thresholds exceeded.
   */
  checkCost(agentId: string, currentCostUsd: number, limitUsd: number): CostAlert[] {
    return this.checkThreshold(agentId, 'cost_threshold', currentCostUsd, limitUsd, 'cost', 'USD');
  }

  /**
   * Check duration against limit and return alerts if thresholds exceeded.
   */
  checkDuration(agentId: string, elapsedMs: number, limitMs: number): CostAlert[] {
    return this.checkThreshold(agentId, 'duration_threshold', elapsedMs, limitMs, 'duration', 'ms');
  }

  /**
   * Check iteration count against limit and return alerts if thresholds exceeded.
   */
  checkIterations(agentId: string, currentIteration: number, maxIterations: number): CostAlert[] {
    return this.checkThreshold(
      agentId,
      'iteration_threshold',
      currentIteration,
      maxIterations,
      'iterations',
      'iterations',
    );
  }

  /**
   * Track which alerts have been sent to avoid duplicates.
   */
  hasAlerted(agentId: string, alertType: string, severity: AlertSeverity): boolean {
    return this.sentAlerts.has(alertKey(agentId, alertType, severity));
  }

  /**
   * Reset alert tracking for an agent, allowing alerts to fire again.
   */
  reset(agentId: string): void {
    const prefix = `${agentId}:`;
    for (const key of this.sentAlerts) {
      if (key.startsWith(prefix)) {
        this.sentAlerts.delete(key);
      }
    }
  }

  /**
   * Internal helper that compares a current value against a limit,
   * producing warning and/or critical alerts as appropriate.
   */
  private checkThreshold(
    agentId: string,
    alertType: CostAlert['alertType'],
    current: number,
    limit: number,
    label: string,
    unit: string,
  ): CostAlert[] {
    if (limit <= 0) {
      return [];
    }

    const percentage = (current / limit) * 100;
    const alerts: CostAlert[] = [];

    if (percentage >= this.warningPct) {
      const warnKey = alertKey(agentId, alertType, 'warning');
      if (!this.sentAlerts.has(warnKey)) {
        this.sentAlerts.add(warnKey);
        alerts.push({
          agentId,
          alertType,
          severity: 'warning',
          message: `Agent ${agentId} ${label} at ${percentage.toFixed(1)}% of limit (${current} / ${limit} ${unit})`,
          currentValue: current,
          limitValue: limit,
          percentage,
          timestamp: new Date().toISOString(),
        });
      }
    }

    if (percentage >= this.criticalPct) {
      const critKey = alertKey(agentId, alertType, 'critical');
      if (!this.sentAlerts.has(critKey)) {
        this.sentAlerts.add(critKey);
        alerts.push({
          agentId,
          alertType,
          severity: 'critical',
          message: `Agent ${agentId} ${label} at ${percentage.toFixed(1)}% of limit (${current} / ${limit} ${unit})`,
          currentValue: current,
          limitValue: limit,
          percentage,
          timestamp: new Date().toISOString(),
        });
      }
    }

    return alerts;
  }
}
