import { describe, expect, it, vi } from 'vitest';

import type { RuntimeSessionInfo } from '../services/api-client.js';
import {
  getRuntimeTabBadgeCount,
  refreshRuntimeTabBadgeSnapshot,
  toRuntimeTabBadgeCount,
} from './runtime-tab-badge.js';

function makeRuntimeSession(overrides: Partial<RuntimeSessionInfo> = {}): RuntimeSessionInfo {
  return {
    id: 'ms-1',
    runtime: 'codex',
    nativeSessionId: 'codex-native-1',
    machineId: 'machine-1',
    agentId: 'agent-1',
    projectPath: '/tmp/project',
    worktreePath: '/tmp/project/.trees/runtime',
    status: 'active',
    configRevision: 1,
    handoffStrategy: null,
    handoffSourceSessionId: null,
    metadata: {},
    startedAt: '2024-01-01T00:00:00Z',
    lastHeartbeat: '2024-01-01T00:05:00Z',
    endedAt: null,
    ...overrides,
  };
}

describe('getRuntimeTabBadgeCount', () => {
  it('counts only handing_off managed runtime sessions', () => {
    expect(
      getRuntimeTabBadgeCount([
        makeRuntimeSession({ id: 'ms-1', status: 'handing_off' }),
        makeRuntimeSession({ id: 'ms-2', status: 'active' }),
        makeRuntimeSession({ id: 'ms-3', status: 'handing_off' }),
        makeRuntimeSession({ id: 'ms-4', status: 'error' }),
      ]),
    ).toBe(2);
  });

  it('adds pending approval count to the badge total', () => {
    expect(
      getRuntimeTabBadgeCount(
        [
          makeRuntimeSession({ id: 'ms-1', status: 'handing_off' }),
          makeRuntimeSession({ id: 'ms-2', status: 'active' }),
        ],
        3,
      ),
    ).toBe(4);
  });

  it('returns zero when no managed runtimes are switching', () => {
    expect(
      getRuntimeTabBadgeCount([
        makeRuntimeSession({ status: 'active' }),
        makeRuntimeSession({ status: 'paused' }),
      ]),
    ).toBe(0);
  });

  it('preserves approval count when only runtime fetching succeeds', async () => {
    await expect(
      refreshRuntimeTabBadgeSnapshot({
        previous: { handoffCount: 3, approvalCount: 4 },
        loadRuntimeSessions: vi
          .fn()
          .mockResolvedValue([
            makeRuntimeSession({ status: 'handing_off' }),
            makeRuntimeSession({ status: 'active' }),
          ]),
        loadPendingApprovalCount: vi.fn().mockRejectedValue(new Error('approval fetch failed')),
      }),
    ).resolves.toEqual({
      handoffCount: 1,
      approvalCount: 4,
    });
  });

  it('preserves handoff count when only approvals fetching succeeds', async () => {
    await expect(
      refreshRuntimeTabBadgeSnapshot({
        previous: { handoffCount: 2, approvalCount: 1 },
        loadRuntimeSessions: vi.fn().mockRejectedValue(new Error('runtime fetch failed')),
        loadPendingApprovalCount: vi.fn().mockResolvedValue(5),
      }),
    ).resolves.toEqual({
      handoffCount: 2,
      approvalCount: 5,
    });
  });

  it('keeps the previous approval count when the approvals tab owns live polling', async () => {
    const snapshot = await refreshRuntimeTabBadgeSnapshot({
      previous: { handoffCount: 0, approvalCount: 6 },
      includeApprovalCount: false,
      loadRuntimeSessions: vi
        .fn()
        .mockResolvedValue([
          makeRuntimeSession({ status: 'handing_off' }),
          makeRuntimeSession({ status: 'handing_off' }),
        ]),
      loadPendingApprovalCount: vi.fn().mockResolvedValue(0),
    });

    expect(snapshot).toEqual({
      handoffCount: 2,
      approvalCount: 6,
    });
    expect(toRuntimeTabBadgeCount(snapshot)).toBe(8);
  });
});
