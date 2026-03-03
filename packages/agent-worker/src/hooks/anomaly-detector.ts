/**
 * Anomaly severity levels.
 */
export type AnomalySeverity = 'low' | 'medium' | 'high';

/**
 * Anomaly detection types.
 */
export type AnomalyType = 'new_tool' | 'frequency_spike' | 'suspicious_combination';

/**
 * An anomaly report produced when unusual tool usage is detected.
 */
export type AnomalyReport = {
  /** The type of anomaly detected. */
  type: AnomalyType;
  /** Severity level: low (log), medium (warn), high (may block). */
  severity: AnomalySeverity;
  /** Human-readable description of the anomaly. */
  message: string;
  /** The agent that triggered the anomaly. */
  agentId: string;
  /** The tool involved in the anomaly. */
  tool: string;
  /** ISO timestamp when the anomaly was detected. */
  detectedAt: string;
};

/**
 * Baseline statistics for a single tool used by an agent.
 */
export type ToolBaseline = {
  /** Total number of calls recorded during the baseline period. */
  callCount: number;
  /** Average calls per minute during the baseline period. */
  avgCallsPerMinute: number;
  /** First call timestamp. */
  firstSeen: number;
  /** Most recent call timestamp. */
  lastSeen: number;
};

/**
 * Complete baseline for an agent's tool usage patterns.
 */
export type AgentBaseline = {
  /** Whether the baseline learning period is complete. */
  baselineComplete: boolean;
  /** Total calls recorded during baseline period. */
  totalCalls: number;
  /** Per-tool baseline statistics. */
  tools: Record<string, ToolBaseline>;
};

/**
 * Configuration for the anomaly detector.
 */
export type AnomalyDetectorConfig = {
  /** Number of calls before the baseline period ends. Default: 50. */
  baselineCallThreshold?: number;
  /** Multiplier above baseline average to trigger a frequency spike. Default: 3. */
  frequencySpikeMultiplier?: number;
  /** Time window (ms) within which Bash+Write is suspicious. Default: 5000 (5s). */
  suspiciousCombinationWindowMs?: number;
  /** Rolling window size (ms) for frequency spike detection. Default: 60000 (1 min). */
  frequencyWindowMs?: number;
};

const MIN_PRUNE_WINDOW_MS = 30_000;
const MIN_PRUNE_RETENTION_MS = 120_000;
const DEFAULT_BASELINE_CALL_THRESHOLD = 50;
const DEFAULT_FREQUENCY_SPIKE_MULTIPLIER = 3;
const DEFAULT_SUSPICIOUS_COMBINATION_WINDOW_MS = 5_000;
const DEFAULT_FREQUENCY_WINDOW_MS = 60_000;

/**
 * Internal per-agent tracking state.
 */
type AgentState = {
  /** Total calls recorded. */
  totalCalls: number;
  /** Per-tool call timestamps within the tracking window. */
  toolCalls: Map<string, number[]>;
  /** Frozen baseline computed after the threshold is reached. */
  baseline: Map<string, ToolBaseline> | null;
  /** Timestamp when tracking started. */
  startedAt: number;
  /** Whether the baseline period is complete. */
  baselineComplete: boolean;
  /** Recent calls for combination detection: [toolName, timestamp]. */
  recentCalls: Array<[string, number]>;
};

/**
 * Detects anomalous tool-call patterns by learning a per-agent baseline
 * and flagging deviations.
 *
 * Three anomaly types are detected:
 * 1. **New tool usage** — agent uses a tool not seen during baseline
 * 2. **Frequency spike** — call rate exceeds 3x the baseline average
 * 3. **Suspicious combination** — Bash + Write in quick succession
 */
export class AnomalyDetector {
  private readonly baselineThreshold: number;
  private readonly spikeMultiplier: number;
  private readonly combinationWindowMs: number;
  private readonly frequencyWindowMs: number;

  private readonly agents: Map<string, AgentState> = new Map();

  constructor(config: AnomalyDetectorConfig = {}) {
    this.baselineThreshold = config.baselineCallThreshold ?? DEFAULT_BASELINE_CALL_THRESHOLD;
    this.spikeMultiplier = config.frequencySpikeMultiplier ?? DEFAULT_FREQUENCY_SPIKE_MULTIPLIER;
    this.combinationWindowMs =
      config.suspiciousCombinationWindowMs ?? DEFAULT_SUSPICIOUS_COMBINATION_WINDOW_MS;
    this.frequencyWindowMs = config.frequencyWindowMs ?? DEFAULT_FREQUENCY_WINDOW_MS;
  }

  /**
   * Record a tool call and return any anomalies detected.
   */
  recordCall(agentId: string, toolName: string, timestamp?: Date): AnomalyReport[] {
    const ts = (timestamp ?? new Date()).getTime();
    const state = this.getOrCreateState(agentId, ts);
    const anomalies: AnomalyReport[] = [];

    // Record the call
    let toolTimestamps = state.toolCalls.get(toolName);

    if (!toolTimestamps) {
      toolTimestamps = [];
      state.toolCalls.set(toolName, toolTimestamps);
    }

    toolTimestamps.push(ts);
    state.totalCalls++;
    state.recentCalls.push([toolName, ts]);

    // Prune old entries from recentCalls (keep last 30 seconds)
    const recentCutoff = ts - Math.max(this.combinationWindowMs * 6, MIN_PRUNE_WINDOW_MS);
    state.recentCalls = state.recentCalls.filter(([, t]) => t > recentCutoff);

    // Check if we should freeze the baseline
    if (!state.baselineComplete && state.totalCalls >= this.baselineThreshold) {
      state.baselineComplete = true;
      state.baseline = this.computeBaseline(state);
    }

    // Only detect anomalies after baseline is established
    if (state.baselineComplete && state.baseline) {
      // 1. New tool usage
      const newToolAnomaly = this.checkNewTool(agentId, toolName, state, ts);

      if (newToolAnomaly) {
        anomalies.push(newToolAnomaly);
      }

      // 2. Frequency spike
      const spikeAnomaly = this.checkFrequencySpike(agentId, toolName, state, ts);

      if (spikeAnomaly) {
        anomalies.push(spikeAnomaly);
      }

      // 3. Suspicious combination (Bash + Write)
      const comboAnomaly = this.checkSuspiciousCombination(agentId, toolName, state, ts);

      if (comboAnomaly) {
        anomalies.push(comboAnomaly);
      }
    }

    // Prune old timestamps from tool calls to prevent memory growth
    this.pruneToolCalls(state, ts);

    return anomalies;
  }

  /**
   * Return the baseline statistics for a given agent.
   */
  getBaseline(agentId: string): AgentBaseline {
    const state = this.agents.get(agentId);

    if (!state) {
      return { baselineComplete: false, totalCalls: 0, tools: {} };
    }

    if (!state.baselineComplete || !state.baseline) {
      // Return current progress toward baseline
      const tools: Record<string, ToolBaseline> = {};

      for (const [tool, timestamps] of state.toolCalls) {
        const elapsedMinutes = Math.max(
          (timestamps[timestamps.length - 1] - state.startedAt) / 60_000,
          1 / 60,
        );

        tools[tool] = {
          callCount: timestamps.length,
          avgCallsPerMinute: timestamps.length / elapsedMinutes,
          firstSeen: timestamps[0],
          lastSeen: timestamps[timestamps.length - 1],
        };
      }

      return {
        baselineComplete: false,
        totalCalls: state.totalCalls,
        tools,
      };
    }

    const tools: Record<string, ToolBaseline> = {};

    for (const [tool, baseline] of state.baseline) {
      tools[tool] = { ...baseline };
    }

    return {
      baselineComplete: true,
      totalCalls: state.totalCalls,
      tools,
    };
  }

  /**
   * Reset all tracking state for a specific agent.
   */
  reset(agentId: string): void {
    this.agents.delete(agentId);
  }

  // ── Private helpers ──────────────────────────────────────────────

  private getOrCreateState(agentId: string, now: number): AgentState {
    let state = this.agents.get(agentId);

    if (!state) {
      state = {
        totalCalls: 0,
        toolCalls: new Map(),
        baseline: null,
        startedAt: now,
        baselineComplete: false,
        recentCalls: [],
      };
      this.agents.set(agentId, state);
    }

    return state;
  }

  private computeBaseline(state: AgentState): Map<string, ToolBaseline> {
    const baseline = new Map<string, ToolBaseline>();
    const elapsedMinutes = Math.max(
      (Date.now() - state.startedAt) / 60_000,
      1 / 60, // minimum 1 second to avoid division issues
    );

    for (const [tool, timestamps] of state.toolCalls) {
      baseline.set(tool, {
        callCount: timestamps.length,
        avgCallsPerMinute: timestamps.length / elapsedMinutes,
        firstSeen: timestamps[0],
        lastSeen: timestamps[timestamps.length - 1],
      });
    }

    return baseline;
  }

  /**
   * Detect if an agent is using a tool not seen during the baseline period.
   */
  private checkNewTool(
    agentId: string,
    toolName: string,
    state: AgentState,
    now: number,
  ): AnomalyReport | null {
    if (!state.baseline || state.baseline.has(toolName)) {
      return null;
    }

    // Only flag on the first occurrence after baseline
    const toolTimestamps = state.toolCalls.get(toolName);

    if (toolTimestamps && toolTimestamps.length > 1) {
      return null; // Already flagged
    }

    return {
      type: 'new_tool',
      severity: 'medium',
      message: `Agent "${agentId}" started using tool "${toolName}" which was not seen during the baseline period`,
      agentId,
      tool: toolName,
      detectedAt: new Date(now).toISOString(),
    };
  }

  /**
   * Detect if the call rate for a tool is >Nx the baseline average.
   */
  private checkFrequencySpike(
    agentId: string,
    toolName: string,
    state: AgentState,
    now: number,
  ): AnomalyReport | null {
    if (!state.baseline) {
      return null;
    }

    const baselineEntry = state.baseline.get(toolName);

    if (!baselineEntry) {
      return null; // New tool — handled by checkNewTool
    }

    const toolTimestamps = state.toolCalls.get(toolName);

    if (!toolTimestamps) {
      return null;
    }

    // Count calls in the frequency window
    const windowStart = now - this.frequencyWindowMs;
    const recentCount = toolTimestamps.filter((t) => t > windowStart).length;
    const windowMinutes = this.frequencyWindowMs / 60_000;
    const currentRate = recentCount / windowMinutes;

    const threshold = baselineEntry.avgCallsPerMinute * this.spikeMultiplier;

    if (currentRate >= threshold && baselineEntry.avgCallsPerMinute > 0) {
      return {
        type: 'frequency_spike',
        severity: 'high',
        message: `Agent "${agentId}" tool "${toolName}" call rate (${currentRate.toFixed(1)}/min) exceeds ${this.spikeMultiplier}x baseline (${baselineEntry.avgCallsPerMinute.toFixed(1)}/min)`,
        agentId,
        tool: toolName,
        detectedAt: new Date(now).toISOString(),
      };
    }

    return null;
  }

  /**
   * Detect suspicious Bash + Write (or Write + Bash) combinations
   * within a short time window. This pattern may indicate file
   * exfiltration attempts.
   */
  private checkSuspiciousCombination(
    agentId: string,
    toolName: string,
    state: AgentState,
    now: number,
  ): AnomalyReport | null {
    // Only trigger when the second tool in a suspicious pair is called
    if (toolName !== 'Bash' && toolName !== 'Write') {
      return null;
    }

    const pairedTool = toolName === 'Bash' ? 'Write' : 'Bash';
    const windowStart = now - this.combinationWindowMs;

    // Look for the paired tool in recent calls within the window
    const hasPairedRecently = state.recentCalls.some(
      ([tool, t]) => tool === pairedTool && t > windowStart && t < now,
    );

    if (!hasPairedRecently) {
      return null;
    }

    return {
      type: 'suspicious_combination',
      severity: 'high',
      message: `Agent "${agentId}" used Bash and Write in quick succession (within ${this.combinationWindowMs}ms), potential file exfiltration`,
      agentId,
      tool: toolName,
      detectedAt: new Date(now).toISOString(),
    };
  }

  /**
   * Remove timestamps older than the tracking window to prevent
   * unbounded memory growth.
   */
  private pruneToolCalls(state: AgentState, now: number): void {
    const cutoff = now - Math.max(this.frequencyWindowMs * 2, MIN_PRUNE_RETENTION_MS);

    for (const [tool, timestamps] of state.toolCalls) {
      const pruned = timestamps.filter((t) => t > cutoff);

      if (pruned.length === 0) {
        // Keep tool in map with empty array to preserve baseline awareness
        // but only if the baseline hasn't been frozen yet
        if (state.baselineComplete) {
          state.toolCalls.set(tool, pruned);
        } else {
          state.toolCalls.delete(tool);
        }
      } else {
        state.toolCalls.set(tool, pruned);
      }
    }
  }
}
