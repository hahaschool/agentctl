import type { RunHandoffDecision } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { runHandoffRoutes } from './run-handoffs.js';

type RunHandoffDecisionStoreMock = {
  listForRun: ReturnType<typeof vi.fn>;
};

async function buildApp(
  runHandoffDecisionStore: RunHandoffDecisionStoreMock,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(runHandoffRoutes, {
    prefix: '/api/runs',
    runHandoffDecisionStore: runHandoffDecisionStore as never,
  });
  await app.ready();
  return app;
}

describe('runHandoffRoutes', () => {
  let app: FastifyInstance;
  let runHandoffDecisionStore: RunHandoffDecisionStoreMock;

  beforeAll(async () => {
    runHandoffDecisionStore = {
      listForRun: vi.fn(),
    };
    app = await buildApp(runHandoffDecisionStore);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/runs/:id/handoff-history returns ordered decision records and count', async () => {
    const decisions: RunHandoffDecision[] = [
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
        createdAt: '2026-03-11T10:05:00.000Z',
        updatedAt: '2026-03-11T10:05:30.000Z',
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
        createdAt: '2026-03-11T10:00:00.000Z',
        updatedAt: '2026-03-11T10:00:00.000Z',
      },
    ];
    runHandoffDecisionStore.listForRun.mockResolvedValue(decisions);

    const response = await app.inject({
      method: 'GET',
      url: '/api/runs/run-1/handoff-history',
    });

    expect(response.statusCode).toBe(200);
    expect(runHandoffDecisionStore.listForRun).toHaveBeenCalledWith('run-1', 50);
    expect(response.json()).toEqual({
      decisions,
      count: 2,
    });
  });

  it('honors the optional limit query parameter', async () => {
    runHandoffDecisionStore.listForRun.mockResolvedValue([]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/runs/run-1/handoff-history?limit=5',
    });

    expect(response.statusCode).toBe(200);
    expect(runHandoffDecisionStore.listForRun).toHaveBeenCalledWith('run-1', 5);
    expect(response.json()).toEqual({ decisions: [], count: 0 });
  });
});
