import type { Machine } from '@agentctl/shared';
import { describe, expect, it } from 'vitest';
import type { RuntimeSessionInfo } from '../services/runtime-session-api.js';
import type { SessionInfo } from '../services/session-api.js';
import {
  buildSessionBrowserItems,
  dateRangeFromPreset,
  filterSessionBrowserItems,
  matchesDateRange,
} from './session-browser-model.js';

function makeClassicSession(partial: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: 'session-1',
    projectPath: '/tmp/classic-project',
    status: 'active',
    messageCount: 5,
    lastActivity: '2026-03-09T12:05:00.000Z',
    model: 'claude-sonnet-4',
    costUsd: 0.25,
    ...partial,
  };
}

function makeRuntimeSession(partial: Partial<RuntimeSessionInfo> = {}): RuntimeSessionInfo {
  return {
    id: 'runtime-1',
    runtime: 'codex',
    nativeSessionId: 'native-1',
    machineId: 'machine-1',
    agentId: null,
    projectPath: '/tmp/runtime-project',
    worktreePath: '/tmp/runtime-project/.trees/runtime',
    status: 'active',
    configRevision: 3,
    handoffStrategy: null,
    handoffSourceSessionId: null,
    metadata: { model: 'gpt-5-codex' },
    startedAt: '2026-03-09T12:00:00.000Z',
    lastHeartbeat: '2026-03-09T12:10:00.000Z',
    endedAt: null,
    ...partial,
  };
}

function makeMachine(partial: Partial<Machine> = {}): Machine {
  return {
    id: 'machine-1',
    hostname: 'mac-mini',
    tailscaleIp: '100.0.0.1',
    os: 'darwin',
    arch: 'arm64',
    status: 'online',
    lastHeartbeat: new Date('2026-03-09T12:10:00.000Z'),
    capabilities: { gpu: false, docker: true, maxConcurrentAgents: 4 },
    createdAt: new Date('2026-03-09T10:00:00.000Z'),
    ...partial,
  };
}

describe('session-browser-model', () => {
  it('builds a unified browser list and sorts by most recent activity', () => {
    const items = buildSessionBrowserItems({
      classicSessions: [
        makeClassicSession({ id: 'session-older', lastActivity: '2026-03-09T11:59:00.000Z' }),
      ],
      runtimeSessions: [
        makeRuntimeSession({
          id: 'runtime-fresh',
          runtime: 'codex',
          lastHeartbeat: '2026-03-09T12:10:00.000Z',
        }),
        makeRuntimeSession({
          id: 'runtime-middle',
          runtime: 'claude-code',
          machineId: 'machine-2',
          metadata: { model: 'claude-sonnet-4' },
          lastHeartbeat: '2026-03-09T12:03:00.000Z',
        }),
      ],
      machines: [
        makeMachine(),
        makeMachine({
          id: 'machine-2',
          hostname: 'ec2-runner',
          os: 'linux',
          tailscaleIp: '100.0.0.2',
        }),
      ],
    });

    expect(items.map((item) => item.id)).toEqual([
      'runtime-fresh',
      'runtime-middle',
      'session-older',
    ]);
    expect(items[0]).toMatchObject({
      kind: 'runtime',
      runtime: 'codex',
      machineLabel: 'mac-mini',
      model: 'gpt-5-codex',
    });
    expect(items[2]).toMatchObject({
      kind: 'session',
      runtime: 'claude-code',
      messageCount: 5,
      machineId: null,
    });
  });

  it('filters by browser type, runtime, machine, and status', () => {
    const items = buildSessionBrowserItems({
      classicSessions: [
        makeClassicSession({ id: 'session-active', status: 'active' }),
        makeClassicSession({
          id: 'session-ended',
          status: 'ended',
          lastActivity: '2026-03-08T12:00:00.000Z',
        }),
      ],
      runtimeSessions: [
        makeRuntimeSession({
          id: 'runtime-codex',
          runtime: 'codex',
          machineId: 'machine-1',
          status: 'active',
        }),
        makeRuntimeSession({
          id: 'runtime-claude',
          runtime: 'claude-code',
          machineId: 'machine-2',
          status: 'paused',
          metadata: { model: 'claude-sonnet-4' },
        }),
      ],
      machines: [
        makeMachine(),
        makeMachine({
          id: 'machine-2',
          hostname: 'ec2-runner',
          os: 'linux',
          tailscaleIp: '100.0.0.2',
        }),
      ],
    });

    expect(
      filterSessionBrowserItems(items, {
        type: 'runtime',
        runtime: 'claude-code',
        machineId: 'machine-2',
        status: 'paused',
        dateRange: { from: null, to: null },
      }).map((item) => item.id),
    ).toEqual(['runtime-claude']);

    expect(
      filterSessionBrowserItems(items, {
        type: 'session',
        runtime: 'all',
        machineId: 'all',
        status: 'active',
        dateRange: { from: null, to: null },
      }).map((item) => item.id),
    ).toEqual(['session-active']);
  });

  it('filters by date range', () => {
    const items = buildSessionBrowserItems({
      classicSessions: [
        makeClassicSession({
          id: 'session-recent',
          lastActivity: '2026-03-09T12:00:00.000Z',
        }),
        makeClassicSession({
          id: 'session-old',
          lastActivity: '2026-03-01T12:00:00.000Z',
        }),
      ],
      runtimeSessions: [],
      machines: [],
    });

    const filtered = filterSessionBrowserItems(items, {
      type: 'all',
      runtime: 'all',
      machineId: 'all',
      status: 'all',
      dateRange: {
        from: new Date('2026-03-08T00:00:00.000Z'),
        to: null,
      },
    });

    expect(filtered.map((item) => item.id)).toEqual(['session-recent']);
  });

  it('matchesDateRange returns true for null range', () => {
    expect(matchesDateRange('2026-03-09T12:00:00.000Z', { from: null, to: null })).toBe(true);
  });

  it('matchesDateRange returns false for timestamps before from', () => {
    expect(
      matchesDateRange('2026-03-01T12:00:00.000Z', {
        from: new Date('2026-03-08T00:00:00.000Z'),
        to: null,
      }),
    ).toBe(false);
  });

  it('dateRangeFromPreset returns null range for "all"', () => {
    const range = dateRangeFromPreset('all');
    expect(range.from).toBeNull();
    expect(range.to).toBeNull();
  });

  it('dateRangeFromPreset returns non-null from for "24h"', () => {
    const range = dateRangeFromPreset('24h');
    expect(range.from).toBeInstanceOf(Date);
    expect(range.to).toBeNull();
  });
});
