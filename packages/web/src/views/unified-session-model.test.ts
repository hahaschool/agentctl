import { describe, expect, it } from 'vitest';

import type { RuntimeSession, Session } from '@/lib/api';
import {
  buildUnifiedSessionRows,
  getUnifiedSessionSearchTerms,
  mapAgentSessionToUnifiedRow,
  mapRuntimeSessionToUnifiedRow,
} from './unified-session-model';

function createAgentSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    agentId: 'agent-1',
    agentName: 'Planner',
    machineId: 'machine-agent',
    sessionUrl: null,
    claudeSessionId: 'claude-session-1',
    status: 'active',
    projectPath: '/workspace/agent',
    pid: 101,
    startedAt: '2026-03-10T08:00:00.000Z',
    lastHeartbeat: '2026-03-10T08:05:00.000Z',
    endedAt: null,
    metadata: {
      costUsd: 1.23,
      messageCount: 12,
      model: 'claude-3-7-sonnet',
    },
    accountId: 'account-1',
    model: 'claude-3-7-sonnet',
    ...overrides,
  };
}

function createRuntimeSession(overrides: Partial<RuntimeSession> = {}): RuntimeSession {
  return {
    id: 'runtime-1',
    runtime: 'codex',
    nativeSessionId: 'native-123',
    machineId: 'machine-runtime',
    agentId: 'agent-runtime',
    projectPath: '/workspace/runtime',
    worktreePath: '/workspace/runtime/.trees/codex',
    status: 'paused',
    configRevision: 7,
    handoffStrategy: 'snapshot-handoff',
    handoffSourceSessionId: 'runtime-0',
    metadata: {
      model: 'gpt-5-codex',
      activeMcpServers: ['github', 'filesystem'],
      profile: 'default',
    },
    startedAt: '2026-03-10T07:00:00.000Z',
    lastHeartbeat: '2026-03-10T07:30:00.000Z',
    endedAt: '2026-03-10T07:45:00.000Z',
    ...overrides,
  };
}

describe('unified-session-model', () => {
  it('maps agent sessions into unified agent rows', () => {
    const session = createAgentSession();

    const row = mapAgentSessionToUnifiedRow(session);

    expect(row.kind).toBe('agent');
    expect(row.id).toBe(session.id);
    expect(row.label).toBe('Planner');
    expect(row.secondaryLabel).toBe('claude-3-7-sonnet');
    expect(row.activityAt).toBe('2026-03-10T08:05:00.000Z');
    expect(row.session).toBe(session);
  });

  it('maps runtime sessions into unified runtime rows', () => {
    const session = createRuntimeSession();

    const row = mapRuntimeSessionToUnifiedRow(session);

    expect(row.kind).toBe('runtime');
    expect(row.id).toBe(session.id);
    expect(row.label).toBe('Runtime · Codex');
    expect(row.secondaryLabel).toBe('native-123');
    expect(row.activityAt).toBe('2026-03-10T07:45:00.000Z');
    expect(row.session).toBe(session);
  });

  it('derives activityAt from the most recent useful timestamp per session kind', () => {
    const agentRow = mapAgentSessionToUnifiedRow(
      createAgentSession({
        lastHeartbeat: null,
      }),
    );
    const runtimeRow = mapRuntimeSessionToUnifiedRow(
      createRuntimeSession({
        endedAt: null,
      }),
    );

    expect(agentRow.activityAt).toBe('2026-03-10T08:00:00.000Z');
    expect(runtimeRow.activityAt).toBe('2026-03-10T07:30:00.000Z');
  });

  it('builds runtime search terms from runtime-specific metadata', () => {
    const row = mapRuntimeSessionToUnifiedRow(createRuntimeSession());

    expect(getUnifiedSessionSearchTerms(row)).toEqual(
      expect.arrayContaining([
        'runtime-1',
        'codex',
        'native-123',
        'machine-runtime',
        '/workspace/runtime',
        '/workspace/runtime/.trees/codex',
        'snapshot-handoff',
        'runtime-0',
        '7',
        'gpt-5-codex',
        'github',
        'filesystem',
        'default',
      ]),
    );
  });

  it('builds a unified list ordered by latest activity', () => {
    const rows = buildUnifiedSessionRows(
      [createAgentSession()],
      [createRuntimeSession({ endedAt: '2026-03-10T09:00:00.000Z' })],
    );

    expect(rows.map((row) => `${row.kind}:${row.id}`)).toEqual([
      'runtime:runtime-1',
      'agent:session-1',
    ]);
  });
});
