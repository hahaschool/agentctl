import { WorkerError } from '@agentctl/shared';

/**
 * Configuration for the sliding window rate limiter.
 */
export type RateLimiterConfig = {
  /** Maximum tool calls allowed per minute per agent. Default: 120. */
  maxCallsPerMinute?: number;
  /** Maximum tool calls allowed per hour per agent. Default: 3600. */
  maxCallsPerHour?: number;
  /** Sliding window granularity in milliseconds. Default: 1000 (1 second). */
  windowSizeMs?: number;
};

/**
 * Result of a rate limit check.
 */
export type RateLimitCheckResult = {
  /** Whether the call is allowed. */
  allowed: boolean;
  /** Number of calls remaining in the most restrictive active window. */
  remaining: number;
  /** When the current window resets (earliest point a blocked call could succeed). */
  resetAt: Date;
  /** Which limit was exceeded, if any. */
  exceededLimit?: 'per_minute' | 'per_hour';
};

/**
 * Per-tool call statistics for a given agent.
 */
export type ToolCallStats = {
  /** Tool name → count of calls in the current tracking window. */
  toolCounts: Record<string, number>;
  /** Total calls across all tools. */
  totalCalls: number;
};

const DEFAULT_MAX_CALLS_PER_MINUTE = 120;
const DEFAULT_MAX_CALLS_PER_HOUR = 3600;
const DEFAULT_WINDOW_SIZE_MS = 1000;

const ONE_MINUTE_MS = 60_000;
const ONE_HOUR_MS = 3_600_000;

/**
 * Sliding-window rate limiter for tool calls.
 *
 * Tracks call timestamps per (agentId, toolName) pair and enforces
 * configurable per-minute and per-hour limits. The sliding window
 * approach ensures smooth rate limiting without burst-at-boundary
 * issues that fixed windows exhibit.
 */
export class ToolRateLimiter {
  private readonly maxPerMinute: number;
  private readonly maxPerHour: number;
  private readonly windowSizeMs: number;

  /**
   * Map of `agentId` → `toolName` → sorted array of call timestamps.
   */
  private readonly callLog: Map<string, Map<string, number[]>> = new Map();

  constructor(config: RateLimiterConfig = {}) {
    this.maxPerMinute = config.maxCallsPerMinute ?? DEFAULT_MAX_CALLS_PER_MINUTE;
    this.maxPerHour = config.maxCallsPerHour ?? DEFAULT_MAX_CALLS_PER_HOUR;
    this.windowSizeMs = config.windowSizeMs ?? DEFAULT_WINDOW_SIZE_MS;

    if (this.maxPerMinute <= 0) {
      throw new WorkerError('INVALID_RATE_LIMIT_CONFIG', 'maxCallsPerMinute must be positive', {
        maxCallsPerMinute: this.maxPerMinute,
      });
    }

    if (this.maxPerHour <= 0) {
      throw new WorkerError('INVALID_RATE_LIMIT_CONFIG', 'maxCallsPerHour must be positive', {
        maxCallsPerHour: this.maxPerHour,
      });
    }

    if (this.windowSizeMs <= 0) {
      throw new WorkerError('INVALID_RATE_LIMIT_CONFIG', 'windowSizeMs must be positive', {
        windowSizeMs: this.windowSizeMs,
      });
    }
  }

  /**
   * Check whether a tool call is allowed under current rate limits.
   *
   * This method records the call timestamp if allowed. If the call
   * would exceed a limit, it is NOT recorded and the result indicates
   * which limit was exceeded.
   */
  check(agentId: string, toolName: string, now?: Date): RateLimitCheckResult {
    const timestamp = (now ?? new Date()).getTime();

    this.pruneExpired(agentId, timestamp);

    const agentCalls = this.getAgentCalls(agentId);
    const allTimestamps = this.getAllTimestampsForAgent(agentCalls);

    // Check per-minute limit (all tools for this agent)
    const minuteAgo = timestamp - ONE_MINUTE_MS;
    const callsInMinute = allTimestamps.filter((t) => t > minuteAgo).length;

    if (callsInMinute >= this.maxPerMinute) {
      const oldestInWindow = allTimestamps.find((t) => t > minuteAgo) ?? timestamp;
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(oldestInWindow + ONE_MINUTE_MS),
        exceededLimit: 'per_minute',
      };
    }

    // Check per-hour limit (all tools for this agent)
    const hourAgo = timestamp - ONE_HOUR_MS;
    const callsInHour = allTimestamps.filter((t) => t > hourAgo).length;

    if (callsInHour >= this.maxPerHour) {
      const oldestInWindow = allTimestamps.find((t) => t > hourAgo) ?? timestamp;
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(oldestInWindow + ONE_HOUR_MS),
        exceededLimit: 'per_hour',
      };
    }

    // Record the call
    this.recordTimestamp(agentId, toolName, timestamp);

    const minuteRemaining = this.maxPerMinute - callsInMinute - 1;
    const hourRemaining = this.maxPerHour - callsInHour - 1;
    const remaining = Math.min(minuteRemaining, hourRemaining);

    return {
      allowed: true,
      remaining,
      resetAt: new Date(timestamp + ONE_MINUTE_MS),
    };
  }

  /**
   * Clear all rate limit counters for a specific agent.
   */
  reset(agentId: string): void {
    this.callLog.delete(agentId);
  }

  /**
   * Return call statistics for a given agent.
   */
  getStats(agentId: string, now?: Date): ToolCallStats {
    const timestamp = (now ?? new Date()).getTime();
    this.pruneExpired(agentId, timestamp);

    const agentCalls = this.callLog.get(agentId);

    if (!agentCalls) {
      return { toolCounts: {}, totalCalls: 0 };
    }

    const toolCounts: Record<string, number> = {};
    let totalCalls = 0;

    for (const [tool, timestamps] of agentCalls) {
      toolCounts[tool] = timestamps.length;
      totalCalls += timestamps.length;
    }

    return { toolCounts, totalCalls };
  }

  // ── Private helpers ──────────────────────────────────────────────

  private getAgentCalls(agentId: string): Map<string, number[]> {
    let agentCalls = this.callLog.get(agentId);

    if (!agentCalls) {
      agentCalls = new Map();
      this.callLog.set(agentId, agentCalls);
    }

    return agentCalls;
  }

  private getAllTimestampsForAgent(agentCalls: Map<string, number[]>): number[] {
    const all: number[] = [];

    for (const timestamps of agentCalls.values()) {
      all.push(...timestamps);
    }

    return all.sort((a, b) => a - b);
  }

  private recordTimestamp(agentId: string, toolName: string, timestamp: number): void {
    const agentCalls = this.getAgentCalls(agentId);
    let toolTimestamps = agentCalls.get(toolName);

    if (!toolTimestamps) {
      toolTimestamps = [];
      agentCalls.set(toolName, toolTimestamps);
    }

    toolTimestamps.push(timestamp);
  }

  /**
   * Remove timestamps older than the largest window (1 hour) to
   * prevent unbounded memory growth.
   */
  private pruneExpired(agentId: string, now: number): void {
    const agentCalls = this.callLog.get(agentId);

    if (!agentCalls) {
      return;
    }

    const cutoff = now - ONE_HOUR_MS;

    for (const [tool, timestamps] of agentCalls) {
      const pruned = timestamps.filter((t) => t > cutoff);

      if (pruned.length === 0) {
        agentCalls.delete(tool);
      } else {
        agentCalls.set(tool, pruned);
      }
    }

    if (agentCalls.size === 0) {
      this.callLog.delete(agentId);
    }
  }
}
