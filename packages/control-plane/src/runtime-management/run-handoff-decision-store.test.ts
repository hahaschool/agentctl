import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../api/routes/test-helpers.js';
import type { Database } from '../db/index.js';
import { RunHandoffDecisionStore } from './run-handoff-decision-store.js';
import { createMockDb, type MockDb } from './test-helpers.js';

describe('RunHandoffDecisionStore', () => {
  let mockDb: MockDb;
  let store: RunHandoffDecisionStore;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    store = new RunHandoffDecisionStore(mockDb as unknown as Database, createMockLogger());
  });

  it('creates a run handoff decision record and maps it back to the shared shape', async () => {
    mockDb.returning.mockResolvedValue([
      {
        id: 'decision-1',
        sourceRunId: 'run-1',
        sourceManagedSessionId: 'ms-1',
        targetRunId: null,
        handoffId: null,
        trigger: 'task-affinity',
        stage: 'dispatch',
        mode: 'dry-run',
        status: 'suggested',
        dedupeKey: 'run-1:task-affinity:codex',
        policySnapshot: { enabled: true, mode: 'dry-run' },
        signalPayload: { preferredRuntime: 'codex' },
        reason: 'Prompt looks Python-heavy.',
        skippedReason: null,
        createdAt: new Date('2026-03-11T10:00:00Z'),
        updatedAt: new Date('2026-03-11T10:00:00Z'),
      },
    ]);

    const decision = await store.create({
      sourceRunId: 'run-1',
      sourceManagedSessionId: 'ms-1',
      targetRunId: null,
      handoffId: null,
      trigger: 'task-affinity',
      stage: 'dispatch',
      mode: 'dry-run',
      status: 'suggested',
      dedupeKey: 'run-1:task-affinity:codex',
      policySnapshot: { enabled: true, mode: 'dry-run' },
      signalPayload: { preferredRuntime: 'codex' },
      reason: 'Prompt looks Python-heavy.',
      skippedReason: null,
    });

    expect(mockDb.insert).toHaveBeenCalledOnce();
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceRunId: 'run-1',
        trigger: 'task-affinity',
        status: 'suggested',
      }),
    );
    expect(decision).toMatchObject({
      id: 'decision-1',
      sourceRunId: 'run-1',
      trigger: 'task-affinity',
      status: 'suggested',
      handoffId: null,
    });
  });

  it('lists decision history for a run in reverse chronological order', async () => {
    mockDb.limit.mockResolvedValue([
      {
        id: 'decision-2',
        sourceRunId: 'run-1',
        sourceManagedSessionId: 'ms-1',
        targetRunId: 'run-2',
        handoffId: 'handoff-1',
        trigger: 'task-affinity',
        stage: 'dispatch',
        mode: 'execute',
        status: 'executed',
        dedupeKey: 'run-1:task-affinity:codex',
        policySnapshot: { enabled: true, mode: 'execute' },
        signalPayload: { preferredRuntime: 'codex' },
        reason: 'Prompt looks Python-heavy.',
        skippedReason: null,
        createdAt: new Date('2026-03-11T10:05:00Z'),
        updatedAt: new Date('2026-03-11T10:05:30Z'),
      },
      {
        id: 'decision-1',
        sourceRunId: 'run-1',
        sourceManagedSessionId: 'ms-1',
        targetRunId: null,
        handoffId: null,
        trigger: 'task-affinity',
        stage: 'dispatch',
        mode: 'dry-run',
        status: 'suggested',
        dedupeKey: 'run-1:task-affinity:codex',
        policySnapshot: { enabled: true, mode: 'dry-run' },
        signalPayload: { preferredRuntime: 'codex' },
        reason: 'Prompt looks Python-heavy.',
        skippedReason: null,
        createdAt: new Date('2026-03-11T10:00:00Z'),
        updatedAt: new Date('2026-03-11T10:00:00Z'),
      },
    ]);

    const decisions = await store.listForRun('run-1');

    expect(mockDb.select).toHaveBeenCalledOnce();
    expect(mockDb.where).toHaveBeenCalledOnce();
    expect(mockDb.orderBy).toHaveBeenCalledOnce();
    expect(decisions).toHaveLength(2);
    expect(decisions[0]?.handoffId).toBe('handoff-1');
    expect(decisions[1]?.status).toBe('suggested');
  });
});
