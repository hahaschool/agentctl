import type { HandoffSnapshot } from '@agentctl/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../api/routes/test-helpers.js';
import type { Database } from '../db/index.js';
import { HandoffStore } from './handoff-store.js';
import { createMockDb, type MockDb } from './test-helpers.js';

function makeSnapshot(): HandoffSnapshot {
  return {
    sourceRuntime: 'claude-code',
    sourceSessionId: 'ms-1',
    sourceNativeSessionId: 'claude-native-1',
    projectPath: '/workspace/app',
    worktreePath: '/workspace/.trees/task-1',
    branch: 'codex/runtime-unification',
    headSha: 'abc123',
    dirtyFiles: ['packages/shared/src/index.ts'],
    diffSummary: 'Added runtime management contracts',
    conversationSummary: 'Shared contracts are complete; continue with persistence.',
    openTodos: ['add runtime config store', 'add session handoff store'],
    nextSuggestedPrompt: 'Continue implementing runtime persistence.',
    activeConfigRevision: 7,
    activeMcpServers: ['filesystem'],
    activeSkills: ['systematic-debugging'],
    reason: 'manual',
  };
}

describe('HandoffStore', () => {
  let mockDb: MockDb;
  let store: HandoffStore;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    store = new HandoffStore(mockDb as unknown as Database, createMockLogger());
  });

  it('creates a handoff record and returns it', async () => {
    const snapshot = makeSnapshot();
    mockDb.returning.mockResolvedValue([
      {
        id: 'handoff-1',
        sourceSessionId: 'ms-1',
        targetSessionId: null,
        sourceRuntime: 'claude-code',
        targetRuntime: 'codex',
        reason: 'manual',
        strategy: 'snapshot-handoff',
        status: 'pending',
        snapshot,
        errorMessage: null,
        createdAt: new Date('2026-03-09T13:00:00Z'),
        completedAt: null,
      },
    ]);

    const handoff = await store.create({
      sourceSessionId: 'ms-1',
      targetSessionId: null,
      sourceRuntime: 'claude-code',
      targetRuntime: 'codex',
      reason: 'manual',
      strategy: 'snapshot-handoff',
      status: 'pending',
      snapshot,
      errorMessage: null,
    });

    expect(mockDb.insert).toHaveBeenCalledOnce();
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceSessionId: 'ms-1',
        targetRuntime: 'codex',
        snapshot,
      }),
    );
    expect(handoff).toMatchObject({
      id: 'handoff-1',
      targetRuntime: 'codex',
      strategy: 'snapshot-handoff',
    });
  });

  it('lists handoffs for a session across source and target sides', async () => {
    mockDb.limit.mockResolvedValue([
      {
        id: 'handoff-1',
        sourceSessionId: 'ms-1',
        targetSessionId: 'ms-2',
        sourceRuntime: 'claude-code',
        targetRuntime: 'codex',
        reason: 'manual',
        strategy: 'snapshot-handoff',
        status: 'succeeded',
        snapshot: makeSnapshot(),
        errorMessage: null,
        createdAt: new Date('2026-03-09T13:00:00Z'),
        completedAt: new Date('2026-03-09T13:01:00Z'),
      },
    ]);

    const handoffs = await store.listForSession('ms-1');

    expect(mockDb.select).toHaveBeenCalledOnce();
    expect(mockDb.where).toHaveBeenCalledOnce();
    expect(mockDb.orderBy).toHaveBeenCalledOnce();
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0]?.status).toBe('succeeded');
  });

  it('records native import attempts for audit and fallback analysis', async () => {
    mockDb.returning.mockResolvedValue([
      {
        id: 'import-1',
        handoffId: 'handoff-1',
        sourceSessionId: 'ms-1',
        targetSessionId: 'ms-2',
        sourceRuntime: 'claude-code',
        targetRuntime: 'codex',
        status: 'failed',
        metadata: { failureStage: 'restore-history' },
        errorMessage: 'Unsupported session format',
        attemptedAt: new Date('2026-03-09T13:00:30Z'),
      },
    ]);

    const attempt = await store.recordNativeImportAttempt({
      handoffId: 'handoff-1',
      sourceSessionId: 'ms-1',
      targetSessionId: 'ms-2',
      sourceRuntime: 'claude-code',
      targetRuntime: 'codex',
      status: 'failed',
      metadata: { failureStage: 'restore-history' },
      errorMessage: 'Unsupported session format',
    });

    expect(mockDb.insert).toHaveBeenCalledOnce();
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        handoffId: 'handoff-1',
        status: 'failed',
      }),
    );
    expect(attempt).toMatchObject({
      id: 'import-1',
      status: 'failed',
      errorMessage: 'Unsupported session format',
    });
  });

  it('summarizes recent handoffs with native import outcomes', async () => {
    mockDb.limit
      .mockResolvedValueOnce([
        {
          id: 'handoff-1',
          sourceSessionId: 'ms-1',
          targetSessionId: 'ms-2',
          sourceRuntime: 'claude-code',
          targetRuntime: 'codex',
          reason: 'manual',
          strategy: 'native-import',
          status: 'succeeded',
          snapshot: makeSnapshot(),
          errorMessage: null,
          createdAt: new Date('2026-03-09T13:00:00Z'),
          completedAt: new Date('2026-03-09T13:01:00Z'),
        },
        {
          id: 'handoff-2',
          sourceSessionId: 'ms-2',
          targetSessionId: 'ms-3',
          sourceRuntime: 'codex',
          targetRuntime: 'claude-code',
          reason: 'manual',
          strategy: 'snapshot-handoff',
          status: 'succeeded',
          snapshot: makeSnapshot(),
          errorMessage: null,
          createdAt: new Date('2026-03-09T13:02:00Z'),
          completedAt: new Date('2026-03-09T13:03:00Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'attempt-1',
          handoffId: 'handoff-1',
          sourceSessionId: 'ms-1',
          targetSessionId: 'ms-2',
          sourceRuntime: 'claude-code',
          targetRuntime: 'codex',
          status: 'succeeded',
          metadata: {},
          errorMessage: null,
          attemptedAt: new Date('2026-03-09T13:00:30Z'),
        },
        {
          id: 'attempt-2',
          handoffId: 'handoff-2',
          sourceSessionId: 'ms-2',
          targetSessionId: 'ms-3',
          sourceRuntime: 'codex',
          targetRuntime: 'claude-code',
          status: 'failed',
          metadata: { reason: 'resume_failed' },
          errorMessage: 'resume failed',
          attemptedAt: new Date('2026-03-09T13:02:30Z'),
        },
      ]);

    const summary = await store.summarizeRecent(50);

    expect(mockDb.select).toHaveBeenCalledTimes(2);
    expect(mockDb.limit).toHaveBeenNthCalledWith(1, 50);
    expect(mockDb.limit).toHaveBeenNthCalledWith(2, 2);
    expect(summary).toEqual({
      total: 2,
      succeeded: 2,
      failed: 0,
      pending: 0,
      nativeImportSuccesses: 1,
      nativeImportFallbacks: 1,
    });
  });
});
