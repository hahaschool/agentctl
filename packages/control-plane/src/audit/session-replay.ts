import type { ReplayEvent, ReplayFilter, SessionTimeline } from '@agentctl/shared';

/** Threshold: more than 10 tool calls within this window triggers rapid_fire. */
const RAPID_FIRE_WINDOW_MS = 5_000;
const RAPID_FIRE_MIN_CALLS = 10;

/** Denial rate threshold (fraction, not percentage). */
const HIGH_DENIAL_RATE_THRESHOLD = 0.2;

/** Cost threshold for a single tool call in USD. */
const COST_SPIKE_THRESHOLD_USD = 1;

/**
 * The fraction of the timeline that must be free of Bash calls before a late
 * Bash call is considered unusual (the "unusual_tool_sequence" heuristic).
 */
const UNUSUAL_SEQUENCE_PREFIX_RATIO = 0.8;

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

export type AuditEntry = {
  kind: string;
  timestamp: string;
  sessionId: string;
  agentId: string;
  tool?: string;
  inputHash?: string;
  decision?: string;
  denyReason?: string;
  costUsd?: number;
  durationMs?: number;
  status?: string;
  output?: string;
  input?: Record<string, unknown>;
  [key: string]: unknown;
};

export type SessionSummary = {
  sessionId: string;
  agentId: string;
  duration: number;
  totalToolCalls: number;
  uniqueTools: string[];
  deniedCalls: number;
  denialRate: number;
  totalCostUsd: number;
  averageDurationMs: number;
};

export type SuspiciousPattern = {
  type: 'rapid_fire' | 'high_denial_rate' | 'unusual_tool_sequence' | 'cost_spike';
  severity: 'low' | 'medium' | 'high';
  message: string;
  evidence: ReplayEvent[];
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Build a timeline from raw audit log entries. */
export function buildTimeline(
  entries: AuditEntry[],
  sessionId: string,
  agentId: string,
): SessionTimeline {
  const sessionEntries = entries
    .filter((e) => e.sessionId === sessionId && e.agentId === agentId)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const events: ReplayEvent[] = sessionEntries.map((entry) => entryToEvent(entry));

  const toolsUsed = [...new Set(events.filter((e) => e.tool).map((e) => e.tool as string))];

  const deniedCalls = events.filter((e) => e.decision === 'deny').length;

  const totalCostUsd = events.reduce((sum, e) => sum + (e.costUsd ?? 0), 0);

  const startedAt =
    sessionEntries.length > 0 ? sessionEntries[0].timestamp : new Date().toISOString();

  const endedAt =
    sessionEntries.length > 1 ? sessionEntries[sessionEntries.length - 1].timestamp : undefined;

  return {
    sessionId,
    agentId,
    startedAt,
    endedAt,
    totalEvents: events.length,
    totalCostUsd,
    toolsUsed,
    deniedCalls,
    events,
  };
}

/** Filter events in a timeline. */
export function filterEvents(timeline: SessionTimeline, filter: ReplayFilter): ReplayEvent[] {
  let filtered = [...timeline.events];

  if (filter.toolName) {
    filtered = filtered.filter((e) => e.tool === filter.toolName);
  }

  if (filter.eventType) {
    filtered = filtered.filter((e) => e.eventType === filter.eventType);
  }

  if (filter.fromTimestamp) {
    const from = new Date(filter.fromTimestamp).getTime();
    filtered = filtered.filter((e) => new Date(e.timestamp).getTime() >= from);
  }

  if (filter.toTimestamp) {
    const to = new Date(filter.toTimestamp).getTime();
    filtered = filtered.filter((e) => new Date(e.timestamp).getTime() <= to);
  }

  const offset = filter.offset ?? 0;
  const limit = filter.limit ?? filtered.length;

  return filtered.slice(offset, offset + limit);
}

/** Generate a summary of the session. */
export function generateSummary(timeline: SessionTimeline): SessionSummary {
  const toolCallEvents = timeline.events.filter((e) => e.eventType === 'tool_call');

  const totalToolCalls = toolCallEvents.length;

  const uniqueTools = [
    ...new Set(toolCallEvents.filter((e) => e.tool).map((e) => e.tool as string)),
  ];

  const deniedCalls = timeline.events.filter((e) => e.decision === 'deny').length;

  const denialRate = totalToolCalls > 0 ? (deniedCalls / totalToolCalls) * 100 : 0;

  const totalCostUsd = timeline.totalCostUsd;

  const durationsMs = timeline.events
    .filter((e) => e.durationMs !== undefined && e.durationMs !== null)
    .map((e) => e.durationMs as number);

  const averageDurationMs =
    durationsMs.length > 0 ? durationsMs.reduce((sum, d) => sum + d, 0) / durationsMs.length : 0;

  const startTime = new Date(timeline.startedAt).getTime();
  const endTime = timeline.endedAt ? new Date(timeline.endedAt).getTime() : startTime;
  const duration = endTime - startTime;

  return {
    sessionId: timeline.sessionId,
    agentId: timeline.agentId,
    duration,
    totalToolCalls,
    uniqueTools,
    deniedCalls,
    denialRate,
    totalCostUsd,
    averageDurationMs,
  };
}

/** Find suspicious patterns in a session. */
export function findSuspiciousPatterns(timeline: SessionTimeline): SuspiciousPattern[] {
  const patterns: SuspiciousPattern[] = [];

  const rapidFire = detectRapidFire(timeline.events);
  if (rapidFire) {
    patterns.push(rapidFire);
  }

  const highDenial = detectHighDenialRate(timeline.events);
  if (highDenial) {
    patterns.push(highDenial);
  }

  const unusualSequence = detectUnusualToolSequence(timeline.events);
  if (unusualSequence) {
    patterns.push(unusualSequence);
  }

  const costSpikes = detectCostSpikes(timeline.events);
  for (const spike of costSpikes) {
    patterns.push(spike);
  }

  return patterns;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function entryToEvent(entry: AuditEntry): ReplayEvent {
  const eventType = mapKindToEventType(entry.kind);

  const event: ReplayEvent = {
    timestamp: entry.timestamp,
    eventType,
  };

  if (entry.tool) {
    event.tool = entry.tool;
  }

  if (entry.input) {
    event.input = entry.input;
  }

  if (entry.output) {
    event.output = entry.output;
  }

  if (entry.decision === 'allow' || entry.decision === 'deny') {
    event.decision = entry.decision;
  }

  if (entry.denyReason) {
    event.denyReason = entry.denyReason;
  }

  if (entry.status) {
    event.status = entry.status;
  }

  if (entry.costUsd !== undefined && entry.costUsd !== null) {
    event.costUsd = entry.costUsd;
  }

  if (entry.durationMs !== undefined && entry.durationMs !== null) {
    event.durationMs = entry.durationMs;
  }

  return event;
}

function mapKindToEventType(kind: string): ReplayEvent['eventType'] {
  switch (kind) {
    case 'pre_tool_use':
    case 'tool_call':
      return 'tool_call';
    case 'post_tool_use':
    case 'tool_result':
      return 'tool_result';
    case 'status_change':
      return 'status_change';
    case 'error':
      return 'error';
    case 'cost_update':
      return 'cost_update';
    default:
      return 'tool_call';
  }
}

/**
 * Detect rapid_fire: >10 tool calls within a 5-second sliding window.
 */
function detectRapidFire(events: ReplayEvent[]): SuspiciousPattern | null {
  const toolCalls = events.filter((e) => e.eventType === 'tool_call');
  if (toolCalls.length <= RAPID_FIRE_MIN_CALLS) {
    return null;
  }

  const timestamps = toolCalls.map((e) => new Date(e.timestamp).getTime());

  for (let i = 0; i <= timestamps.length - RAPID_FIRE_MIN_CALLS; i++) {
    const windowEnd = timestamps[i] + RAPID_FIRE_WINDOW_MS;
    // Find how many calls fall within [timestamps[i], timestamps[i] + 5000]
    let j = i;
    while (j < timestamps.length && timestamps[j] <= windowEnd) {
      j++;
    }
    const countInWindow = j - i;

    if (countInWindow > RAPID_FIRE_MIN_CALLS) {
      const evidence = toolCalls.slice(i, j);
      return {
        type: 'rapid_fire',
        severity: 'high',
        message: `${countInWindow} tool calls detected within ${RAPID_FIRE_WINDOW_MS / 1000}s window`,
        evidence,
      };
    }
  }

  return null;
}

/**
 * Detect high_denial_rate: >20% of tool calls denied.
 */
function detectHighDenialRate(events: ReplayEvent[]): SuspiciousPattern | null {
  const toolCalls = events.filter((e) => e.eventType === 'tool_call');
  if (toolCalls.length === 0) {
    return null;
  }

  const denied = toolCalls.filter((e) => e.decision === 'deny');
  const rate = denied.length / toolCalls.length;

  if (rate > HIGH_DENIAL_RATE_THRESHOLD) {
    return {
      type: 'high_denial_rate',
      severity: 'medium',
      message: `${(rate * 100).toFixed(1)}% of tool calls were denied (${denied.length}/${toolCalls.length})`,
      evidence: denied,
    };
  }

  return null;
}

/**
 * Detect unusual_tool_sequence: Bash appearing only after 80% of calls
 * were Read/Write-only.
 */
function detectUnusualToolSequence(events: ReplayEvent[]): SuspiciousPattern | null {
  const toolCalls = events.filter((e) => e.eventType === 'tool_call');
  if (toolCalls.length < 5) {
    return null;
  }

  const prefixLength = Math.floor(toolCalls.length * UNUSUAL_SEQUENCE_PREFIX_RATIO);
  const prefix = toolCalls.slice(0, prefixLength);
  const suffix = toolCalls.slice(prefixLength);

  // Check that prefix has NO Bash calls
  const prefixHasBash = prefix.some((e) => e.tool === 'Bash');
  if (prefixHasBash) {
    return null;
  }

  // Check that prefix only has Read/Write calls (safe tools)
  const safeTools = new Set(['Read', 'Write', 'Edit', 'Glob', 'Grep']);
  const prefixOnlySafe = prefix.every((e) => !e.tool || safeTools.has(e.tool));
  if (!prefixOnlySafe) {
    return null;
  }

  // Check that suffix HAS Bash calls
  const bashInSuffix = suffix.filter((e) => e.tool === 'Bash');
  if (bashInSuffix.length === 0) {
    return null;
  }

  return {
    type: 'unusual_tool_sequence',
    severity: 'medium',
    message: `Bash commands appeared only in the last ${((1 - UNUSUAL_SEQUENCE_PREFIX_RATIO) * 100).toFixed(0)}% of tool calls after ${prefixLength} safe-only calls`,
    evidence: bashInSuffix,
  };
}

/**
 * Detect cost_spike: any single tool call costing more than $1.
 */
function detectCostSpikes(events: ReplayEvent[]): SuspiciousPattern[] {
  const patterns: SuspiciousPattern[] = [];

  for (const event of events) {
    if (event.costUsd !== undefined && event.costUsd > COST_SPIKE_THRESHOLD_USD) {
      patterns.push({
        type: 'cost_spike',
        severity: 'high',
        message: `Single tool call cost $${event.costUsd.toFixed(2)} (threshold: $${COST_SPIKE_THRESHOLD_USD})`,
        evidence: [event],
      });
    }
  }

  return patterns;
}
