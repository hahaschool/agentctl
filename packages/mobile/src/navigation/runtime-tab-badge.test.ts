import { describe, expect, it } from 'vitest';

import type { RuntimeSessionInfo } from '../services/api-client.js';
import { getRuntimeTabBadgeCount } from './runtime-tab-badge.js';

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

  it('returns zero when no managed runtimes are switching', () => {
    expect(
      getRuntimeTabBadgeCount([
        makeRuntimeSession({ status: 'active' }),
        makeRuntimeSession({ status: 'paused' }),
      ]),
    ).toBe(0);
  });
});
