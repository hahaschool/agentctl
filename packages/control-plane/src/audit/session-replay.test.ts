import { describe, expect, it } from 'vitest';

import type { AuditEntry } from './session-replay.js';
import {
  buildTimeline,
  filterEvents,
  findSuspiciousPatterns,
  generateSummary,
} from './session-replay.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    kind: 'tool_call',
    timestamp: '2026-03-01T10:00:00.000Z',
    sessionId: 'session-1',
    agentId: 'agent-1',
    tool: 'Read',
    ...overrides,
  };
}

function makeEntries(count: number, overrides: Partial<AuditEntry> = {}): AuditEntry[] {
  return Array.from({ length: count }, (_, i) =>
    makeEntry({
      timestamp: new Date(Date.parse('2026-03-01T10:00:00.000Z') + i * 1000).toISOString(),
      ...overrides,
    }),
  );
}

// =============================================================================
// buildTimeline
// =============================================================================

describe('buildTimeline', () => {
  it('builds a timeline from audit entries for a given session and agent', () => {
    const entries: AuditEntry[] = [
      makeEntry({ timestamp: '2026-03-01T10:00:00.000Z', tool: 'Read' }),
      makeEntry({
        timestamp: '2026-03-01T10:00:01.000Z',
        tool: 'Write',
        kind: 'tool_result',
      }),
      makeEntry({
        timestamp: '2026-03-01T10:00:02.000Z',
        tool: 'Bash',
        kind: 'tool_call',
      }),
    ];

    const timeline = buildTimeline(entries, 'session-1', 'agent-1');

    expect(timeline.sessionId).toBe('session-1');
    expect(timeline.agentId).toBe('agent-1');
    expect(timeline.totalEvents).toBe(3);
    expect(timeline.events).toHaveLength(3);
    expect(timeline.startedAt).toBe('2026-03-01T10:00:00.000Z');
    expect(timeline.endedAt).toBe('2026-03-01T10:00:02.000Z');
  });

  it('orders events by timestamp', () => {
    const entries: AuditEntry[] = [
      makeEntry({ timestamp: '2026-03-01T10:00:02.000Z', tool: 'Bash' }),
      makeEntry({ timestamp: '2026-03-01T10:00:00.000Z', tool: 'Read' }),
      makeEntry({ timestamp: '2026-03-01T10:00:01.000Z', tool: 'Write' }),
    ];

    const timeline = buildTimeline(entries, 'session-1', 'agent-1');

    expect(timeline.events[0].tool).toBe('Read');
    expect(timeline.events[1].tool).toBe('Write');
    expect(timeline.events[2].tool).toBe('Bash');
  });

  it('filters entries to only the requested session and agent', () => {
    const entries: AuditEntry[] = [
      makeEntry({ sessionId: 'session-1', agentId: 'agent-1', tool: 'Read' }),
      makeEntry({
        sessionId: 'session-2',
        agentId: 'agent-1',
        tool: 'Write',
      }),
      makeEntry({ sessionId: 'session-1', agentId: 'agent-2', tool: 'Bash' }),
      makeEntry({
        sessionId: 'session-1',
        agentId: 'agent-1',
        tool: 'Glob',
        timestamp: '2026-03-01T10:00:01.000Z',
      }),
    ];

    const timeline = buildTimeline(entries, 'session-1', 'agent-1');

    expect(timeline.totalEvents).toBe(2);
    expect(timeline.events.map((e) => e.tool)).toEqual(['Read', 'Glob']);
  });

  it('returns an empty timeline when no entries match', () => {
    const entries: AuditEntry[] = [makeEntry({ sessionId: 'session-2', agentId: 'agent-2' })];

    const timeline = buildTimeline(entries, 'session-1', 'agent-1');

    expect(timeline.totalEvents).toBe(0);
    expect(timeline.events).toEqual([]);
  });

  it('handles a single event (no endedAt)', () => {
    const entries: AuditEntry[] = [makeEntry({ timestamp: '2026-03-01T10:00:00.000Z' })];

    const timeline = buildTimeline(entries, 'session-1', 'agent-1');

    expect(timeline.totalEvents).toBe(1);
    expect(timeline.startedAt).toBe('2026-03-01T10:00:00.000Z');
    expect(timeline.endedAt).toBeUndefined();
  });

  it('collects unique tools used', () => {
    const entries: AuditEntry[] = [
      makeEntry({ tool: 'Read', timestamp: '2026-03-01T10:00:00.000Z' }),
      makeEntry({ tool: 'Read', timestamp: '2026-03-01T10:00:01.000Z' }),
      makeEntry({ tool: 'Bash', timestamp: '2026-03-01T10:00:02.000Z' }),
      makeEntry({ tool: 'Write', timestamp: '2026-03-01T10:00:03.000Z' }),
    ];

    const timeline = buildTimeline(entries, 'session-1', 'agent-1');

    expect(timeline.toolsUsed).toEqual(expect.arrayContaining(['Read', 'Bash', 'Write']));
    expect(timeline.toolsUsed).toHaveLength(3);
  });

  it('counts denied calls', () => {
    const entries: AuditEntry[] = [
      makeEntry({
        decision: 'allow',
        timestamp: '2026-03-01T10:00:00.000Z',
      }),
      makeEntry({
        decision: 'deny',
        denyReason: 'blocked',
        timestamp: '2026-03-01T10:00:01.000Z',
      }),
      makeEntry({
        decision: 'deny',
        denyReason: 'rate limited',
        timestamp: '2026-03-01T10:00:02.000Z',
      }),
    ];

    const timeline = buildTimeline(entries, 'session-1', 'agent-1');

    expect(timeline.deniedCalls).toBe(2);
  });

  it('sums total cost', () => {
    const entries: AuditEntry[] = [
      makeEntry({
        costUsd: 0.05,
        timestamp: '2026-03-01T10:00:00.000Z',
      }),
      makeEntry({
        costUsd: 0.1,
        timestamp: '2026-03-01T10:00:01.000Z',
      }),
      makeEntry({ timestamp: '2026-03-01T10:00:02.000Z' }),
    ];

    const timeline = buildTimeline(entries, 'session-1', 'agent-1');

    expect(timeline.totalCostUsd).toBeCloseTo(0.15);
  });

  it('maps pre_tool_use kind to tool_call eventType', () => {
    const entries: AuditEntry[] = [makeEntry({ kind: 'pre_tool_use' })];

    const timeline = buildTimeline(entries, 'session-1', 'agent-1');

    expect(timeline.events[0].eventType).toBe('tool_call');
  });

  it('maps post_tool_use kind to tool_result eventType', () => {
    const entries: AuditEntry[] = [makeEntry({ kind: 'post_tool_use' })];

    const timeline = buildTimeline(entries, 'session-1', 'agent-1');

    expect(timeline.events[0].eventType).toBe('tool_result');
  });

  it('maps error kind to error eventType', () => {
    const entries: AuditEntry[] = [makeEntry({ kind: 'error' })];

    const timeline = buildTimeline(entries, 'session-1', 'agent-1');

    expect(timeline.events[0].eventType).toBe('error');
  });

  it('preserves denyReason in events', () => {
    const entries: AuditEntry[] = [
      makeEntry({
        decision: 'deny',
        denyReason: 'rate_limit_exceeded',
      }),
    ];

    const timeline = buildTimeline(entries, 'session-1', 'agent-1');

    expect(timeline.events[0].decision).toBe('deny');
    expect(timeline.events[0].denyReason).toBe('rate_limit_exceeded');
  });
});

// =============================================================================
// filterEvents
// =============================================================================

describe('filterEvents', () => {
  const timeline = buildTimeline(
    [
      makeEntry({
        tool: 'Read',
        kind: 'tool_call',
        timestamp: '2026-03-01T10:00:00.000Z',
      }),
      makeEntry({
        tool: 'Read',
        kind: 'tool_result',
        timestamp: '2026-03-01T10:00:01.000Z',
      }),
      makeEntry({
        tool: 'Bash',
        kind: 'tool_call',
        timestamp: '2026-03-01T10:00:02.000Z',
      }),
      makeEntry({
        tool: 'Bash',
        kind: 'tool_result',
        timestamp: '2026-03-01T10:00:03.000Z',
      }),
      makeEntry({
        tool: 'Write',
        kind: 'tool_call',
        timestamp: '2026-03-01T10:00:04.000Z',
      }),
    ],
    'session-1',
    'agent-1',
  );

  it('filters by tool name', () => {
    const result = filterEvents(timeline, {
      toolName: 'Bash',
    });

    expect(result).toHaveLength(2);
    expect(result.every((e) => e.tool === 'Bash')).toBe(true);
  });

  it('filters by event type', () => {
    const result = filterEvents(timeline, {
      eventType: 'tool_result',
    });

    expect(result).toHaveLength(2);
    expect(result.every((e) => e.eventType === 'tool_result')).toBe(true);
  });

  it('filters by time range (fromTimestamp)', () => {
    const result = filterEvents(timeline, {
      fromTimestamp: '2026-03-01T10:00:02.000Z',
    });

    expect(result).toHaveLength(3);
  });

  it('filters by time range (toTimestamp)', () => {
    const result = filterEvents(timeline, {
      toTimestamp: '2026-03-01T10:00:01.000Z',
    });

    expect(result).toHaveLength(2);
  });

  it('filters by combined from and to timestamps', () => {
    const result = filterEvents(timeline, {
      fromTimestamp: '2026-03-01T10:00:01.000Z',
      toTimestamp: '2026-03-01T10:00:03.000Z',
    });

    expect(result).toHaveLength(3);
  });

  it('applies pagination with limit', () => {
    const result = filterEvents(timeline, {
      limit: 2,
    });

    expect(result).toHaveLength(2);
  });

  it('applies pagination with offset', () => {
    const result = filterEvents(timeline, {
      offset: 3,
    });

    expect(result).toHaveLength(2);
  });

  it('applies pagination with limit and offset', () => {
    const result = filterEvents(timeline, {
      offset: 1,
      limit: 2,
    });

    expect(result).toHaveLength(2);
    expect(result[0].tool).toBe('Read');
    expect(result[0].eventType).toBe('tool_result');
  });

  it('returns empty array when no events match filter', () => {
    const result = filterEvents(timeline, {
      toolName: 'Grep',
    });

    expect(result).toEqual([]);
  });

  it('returns all events when no filter criteria are set', () => {
    const result = filterEvents(timeline, {});

    expect(result).toHaveLength(5);
  });
});

// =============================================================================
// generateSummary
// =============================================================================

describe('generateSummary', () => {
  it('computes summary statistics from a timeline', () => {
    const entries: AuditEntry[] = [
      makeEntry({
        kind: 'tool_call',
        tool: 'Read',
        durationMs: 100,
        costUsd: 0.01,
        timestamp: '2026-03-01T10:00:00.000Z',
      }),
      makeEntry({
        kind: 'tool_call',
        tool: 'Bash',
        durationMs: 200,
        costUsd: 0.02,
        timestamp: '2026-03-01T10:00:05.000Z',
      }),
      makeEntry({
        kind: 'tool_call',
        tool: 'Read',
        durationMs: 150,
        costUsd: 0.01,
        decision: 'deny',
        denyReason: 'blocked',
        timestamp: '2026-03-01T10:00:10.000Z',
      }),
    ];

    const timeline = buildTimeline(entries, 'session-1', 'agent-1');
    const summary = generateSummary(timeline);

    expect(summary.sessionId).toBe('session-1');
    expect(summary.agentId).toBe('agent-1');
    expect(summary.totalToolCalls).toBe(3);
    expect(summary.uniqueTools).toEqual(expect.arrayContaining(['Read', 'Bash']));
    expect(summary.uniqueTools).toHaveLength(2);
    expect(summary.deniedCalls).toBe(1);
    expect(summary.denialRate).toBeCloseTo((1 / 3) * 100);
    expect(summary.totalCostUsd).toBeCloseTo(0.04);
    expect(summary.averageDurationMs).toBeCloseTo(150);
    expect(summary.duration).toBe(10_000);
  });

  it('returns zero duration for single-event timeline', () => {
    const entries: AuditEntry[] = [makeEntry({ kind: 'tool_call', durationMs: 100 })];

    const timeline = buildTimeline(entries, 'session-1', 'agent-1');
    const summary = generateSummary(timeline);

    expect(summary.duration).toBe(0);
  });

  it('returns zero denial rate when no tool calls exist', () => {
    const entries: AuditEntry[] = [makeEntry({ kind: 'status_change', status: 'running' })];

    const timeline = buildTimeline(entries, 'session-1', 'agent-1');
    const summary = generateSummary(timeline);

    expect(summary.denialRate).toBe(0);
    expect(summary.totalToolCalls).toBe(0);
  });

  it('computes averageDurationMs only from events that have a duration', () => {
    const entries: AuditEntry[] = [
      makeEntry({
        kind: 'tool_call',
        durationMs: 200,
        timestamp: '2026-03-01T10:00:00.000Z',
      }),
      makeEntry({
        kind: 'tool_call',
        timestamp: '2026-03-01T10:00:01.000Z',
      }),
      makeEntry({
        kind: 'tool_call',
        durationMs: 100,
        timestamp: '2026-03-01T10:00:02.000Z',
      }),
    ];

    const timeline = buildTimeline(entries, 'session-1', 'agent-1');
    const summary = generateSummary(timeline);

    expect(summary.averageDurationMs).toBeCloseTo(150);
  });
});

// =============================================================================
// findSuspiciousPatterns
// =============================================================================

describe('findSuspiciousPatterns', () => {
  it('detects rapid_fire when >10 tool calls within 5 seconds', () => {
    // 12 tool calls in 3 seconds
    const entries = Array.from({ length: 12 }, (_, i) =>
      makeEntry({
        kind: 'tool_call',
        tool: 'Read',
        timestamp: new Date(Date.parse('2026-03-01T10:00:00.000Z') + i * 250).toISOString(),
      }),
    );

    const timeline = buildTimeline(entries, 'session-1', 'agent-1');
    const patterns = findSuspiciousPatterns(timeline);

    const rapidFire = patterns.find((p) => p.type === 'rapid_fire');
    expect(rapidFire).toBeDefined();
    expect(rapidFire?.severity).toBe('high');
    expect(rapidFire?.evidence.length).toBeGreaterThan(10);
  });

  it('does not detect rapid_fire when calls are spread out', () => {
    // 12 tool calls, each 1s apart
    const entries = Array.from({ length: 12 }, (_, i) =>
      makeEntry({
        kind: 'tool_call',
        tool: 'Read',
        timestamp: new Date(Date.parse('2026-03-01T10:00:00.000Z') + i * 1000).toISOString(),
      }),
    );

    const timeline = buildTimeline(entries, 'session-1', 'agent-1');
    const patterns = findSuspiciousPatterns(timeline);

    expect(patterns.find((p) => p.type === 'rapid_fire')).toBeUndefined();
  });

  it('does not detect rapid_fire when there are <=10 tool calls', () => {
    const entries = makeEntries(10, { kind: 'tool_call' });

    const timeline = buildTimeline(entries, 'session-1', 'agent-1');
    const patterns = findSuspiciousPatterns(timeline);

    expect(patterns.find((p) => p.type === 'rapid_fire')).toBeUndefined();
  });

  it('detects high_denial_rate when >20% of calls are denied', () => {
    const entries: AuditEntry[] = [
      ...makeEntries(3, {
        kind: 'tool_call',
        decision: 'allow',
        tool: 'Read',
      }),
      makeEntry({
        kind: 'tool_call',
        decision: 'deny',
        denyReason: 'blocked',
        tool: 'Bash',
        timestamp: '2026-03-01T10:00:04.000Z',
      }),
    ];

    const timeline = buildTimeline(entries, 'session-1', 'agent-1');
    const patterns = findSuspiciousPatterns(timeline);

    const highDenial = patterns.find((p) => p.type === 'high_denial_rate');
    expect(highDenial).toBeDefined();
    expect(highDenial?.severity).toBe('medium');
  });

  it('does not detect high_denial_rate when rate is <=20%', () => {
    const entries: AuditEntry[] = [
      ...makeEntries(8, {
        kind: 'tool_call',
        decision: 'allow',
        tool: 'Read',
      }),
      makeEntry({
        kind: 'tool_call',
        decision: 'deny',
        denyReason: 'blocked',
        tool: 'Bash',
        timestamp: '2026-03-01T10:00:09.000Z',
      }),
    ];

    const timeline = buildTimeline(entries, 'session-1', 'agent-1');
    const patterns = findSuspiciousPatterns(timeline);

    expect(patterns.find((p) => p.type === 'high_denial_rate')).toBeUndefined();
  });

  it('does not detect high_denial_rate when there are no tool calls', () => {
    const entries: AuditEntry[] = [makeEntry({ kind: 'status_change', status: 'running' })];

    const timeline = buildTimeline(entries, 'session-1', 'agent-1');
    const patterns = findSuspiciousPatterns(timeline);

    expect(patterns.find((p) => p.type === 'high_denial_rate')).toBeUndefined();
  });

  it('detects unusual_tool_sequence when Bash appears only in the last 20%', () => {
    // 10 Read calls, then 2 Bash calls at the end (Bash in last ~17%)
    const readEntries = Array.from({ length: 10 }, (_, i) =>
      makeEntry({
        kind: 'tool_call',
        tool: 'Read',
        timestamp: new Date(Date.parse('2026-03-01T10:00:00.000Z') + i * 1000).toISOString(),
      }),
    );

    const bashEntries = [
      makeEntry({
        kind: 'tool_call',
        tool: 'Bash',
        timestamp: '2026-03-01T10:00:10.000Z',
      }),
      makeEntry({
        kind: 'tool_call',
        tool: 'Bash',
        timestamp: '2026-03-01T10:00:11.000Z',
      }),
    ];

    const timeline = buildTimeline([...readEntries, ...bashEntries], 'session-1', 'agent-1');
    const patterns = findSuspiciousPatterns(timeline);

    const unusual = patterns.find((p) => p.type === 'unusual_tool_sequence');
    expect(unusual).toBeDefined();
    expect(unusual?.severity).toBe('medium');
  });

  it('does not detect unusual_tool_sequence when Bash appears early', () => {
    const entries: AuditEntry[] = [
      makeEntry({
        kind: 'tool_call',
        tool: 'Read',
        timestamp: '2026-03-01T10:00:00.000Z',
      }),
      makeEntry({
        kind: 'tool_call',
        tool: 'Bash',
        timestamp: '2026-03-01T10:00:01.000Z',
      }),
      makeEntry({
        kind: 'tool_call',
        tool: 'Read',
        timestamp: '2026-03-01T10:00:02.000Z',
      }),
      makeEntry({
        kind: 'tool_call',
        tool: 'Read',
        timestamp: '2026-03-01T10:00:03.000Z',
      }),
      makeEntry({
        kind: 'tool_call',
        tool: 'Read',
        timestamp: '2026-03-01T10:00:04.000Z',
      }),
    ];

    const timeline = buildTimeline(entries, 'session-1', 'agent-1');
    const patterns = findSuspiciousPatterns(timeline);

    expect(patterns.find((p) => p.type === 'unusual_tool_sequence')).toBeUndefined();
  });

  it('does not detect unusual_tool_sequence with fewer than 5 tool calls', () => {
    const entries: AuditEntry[] = [
      makeEntry({
        kind: 'tool_call',
        tool: 'Read',
        timestamp: '2026-03-01T10:00:00.000Z',
      }),
      makeEntry({
        kind: 'tool_call',
        tool: 'Read',
        timestamp: '2026-03-01T10:00:01.000Z',
      }),
      makeEntry({
        kind: 'tool_call',
        tool: 'Bash',
        timestamp: '2026-03-01T10:00:02.000Z',
      }),
    ];

    const timeline = buildTimeline(entries, 'session-1', 'agent-1');
    const patterns = findSuspiciousPatterns(timeline);

    expect(patterns.find((p) => p.type === 'unusual_tool_sequence')).toBeUndefined();
  });

  it('detects cost_spike when a single call costs >$1', () => {
    const entries: AuditEntry[] = [
      makeEntry({
        kind: 'tool_call',
        tool: 'Read',
        costUsd: 0.5,
        timestamp: '2026-03-01T10:00:00.000Z',
      }),
      makeEntry({
        kind: 'tool_call',
        tool: 'Bash',
        costUsd: 2.5,
        timestamp: '2026-03-01T10:00:01.000Z',
      }),
    ];

    const timeline = buildTimeline(entries, 'session-1', 'agent-1');
    const patterns = findSuspiciousPatterns(timeline);

    const costSpike = patterns.filter((p) => p.type === 'cost_spike');
    expect(costSpike).toHaveLength(1);
    expect(costSpike[0].severity).toBe('high');
    expect(costSpike[0].evidence[0].costUsd).toBe(2.5);
  });

  it('detects multiple cost_spikes', () => {
    const entries: AuditEntry[] = [
      makeEntry({
        kind: 'tool_call',
        tool: 'Read',
        costUsd: 1.5,
        timestamp: '2026-03-01T10:00:00.000Z',
      }),
      makeEntry({
        kind: 'tool_call',
        tool: 'Bash',
        costUsd: 3.0,
        timestamp: '2026-03-01T10:00:01.000Z',
      }),
    ];

    const timeline = buildTimeline(entries, 'session-1', 'agent-1');
    const patterns = findSuspiciousPatterns(timeline);

    const costSpikes = patterns.filter((p) => p.type === 'cost_spike');
    expect(costSpikes).toHaveLength(2);
  });

  it('does not detect cost_spike when all costs are under $1', () => {
    const entries: AuditEntry[] = [
      makeEntry({
        kind: 'tool_call',
        tool: 'Read',
        costUsd: 0.5,
        timestamp: '2026-03-01T10:00:00.000Z',
      }),
      makeEntry({
        kind: 'tool_call',
        tool: 'Bash',
        costUsd: 0.99,
        timestamp: '2026-03-01T10:00:01.000Z',
      }),
    ];

    const timeline = buildTimeline(entries, 'session-1', 'agent-1');
    const patterns = findSuspiciousPatterns(timeline);

    expect(patterns.filter((p) => p.type === 'cost_spike')).toHaveLength(0);
  });

  it('returns empty array for clean session', () => {
    const entries: AuditEntry[] = makeEntries(3, {
      kind: 'tool_call',
      tool: 'Read',
      decision: 'allow',
      costUsd: 0.01,
    });

    const timeline = buildTimeline(entries, 'session-1', 'agent-1');
    const patterns = findSuspiciousPatterns(timeline);

    expect(patterns).toEqual([]);
  });

  it('returns empty array for empty timeline', () => {
    const timeline = buildTimeline([], 'session-1', 'agent-1');
    const patterns = findSuspiciousPatterns(timeline);

    expect(patterns).toEqual([]);
  });

  it('detects multiple pattern types simultaneously', () => {
    // Build a scenario with: rapid_fire + cost_spike
    const rapidEntries = Array.from({ length: 12 }, (_, i) =>
      makeEntry({
        kind: 'tool_call',
        tool: 'Read',
        costUsd: i === 5 ? 5.0 : 0.01,
        timestamp: new Date(Date.parse('2026-03-01T10:00:00.000Z') + i * 100).toISOString(),
      }),
    );

    const timeline = buildTimeline(rapidEntries, 'session-1', 'agent-1');
    const patterns = findSuspiciousPatterns(timeline);

    const types = patterns.map((p) => p.type);
    expect(types).toContain('rapid_fire');
    expect(types).toContain('cost_spike');
  });
});
