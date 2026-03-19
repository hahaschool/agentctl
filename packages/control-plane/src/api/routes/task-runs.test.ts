import { ControlPlaneError } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskRunStore } from '../../collaboration/task-run-store.js';
import type { WorkerLeaseStore } from '../../collaboration/worker-lease-store.js';
import { taskRunRoutes } from './task-runs.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const RUN_ID = 'run-00000000-0000-4000-a000-000000000001';
const DEF_ID = 'def-00000000-0000-4000-a000-000000000002';
const SPACE_ID = 'space-00000000-0000-4000-a000-000000000003';
const THREAD_ID = 'thread-00000000-0000-4000-a000-000000000004';
const NOW = new Date().toISOString();
const EXPIRES_AT = new Date(Date.now() + 60_000).toISOString();
const RENEWED_AT = new Date(Date.now() + 30_000).toISOString();

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    definitionId: DEF_ID,
    spaceId: SPACE_ID,
    threadId: THREAD_ID,
    status: 'pending',
    attempt: 1,
    assigneeInstanceId: null,
    machineId: null,
    claimedAt: null,
    startedAt: null,
    completedAt: null,
    lastHeartbeatAt: null,
    result: null,
    error: null,
    createdAt: NOW,
    ...overrides,
  };
}

function makeLease(overrides: Record<string, unknown> = {}) {
  return {
    taskRunId: RUN_ID,
    workerId: 'worker-1',
    agentInstanceId: 'agent-instance-1',
    expiresAt: EXPIRES_AT,
    renewedAt: RENEWED_AT,
    ...overrides,
  };
}

// ── Store Mocks ─────────────────────────────────────────────────────────────

function createMockTaskRunStore(): TaskRunStore {
  return {
    createRun: vi.fn().mockResolvedValue(makeRun()),
    getRun: vi.fn().mockResolvedValue(makeRun()),
    listRuns: vi.fn().mockResolvedValue([]),
    updateStatus: vi.fn().mockResolvedValue(makeRun({ status: 'completed' })),
    updateHeartbeat: vi.fn().mockResolvedValue(undefined),
    getRunsByGraph: vi.fn().mockResolvedValue([]),
  } as unknown as TaskRunStore;
}

function createMockWorkerLeaseStore(): WorkerLeaseStore {
  return {
    claimLease: vi.fn().mockResolvedValue(makeLease()),
    renewLease: vi.fn().mockResolvedValue(makeLease()),
    releaseLease: vi.fn().mockResolvedValue(undefined),
    getLease: vi.fn().mockResolvedValue(undefined),
    getExpiredLeases: vi.fn().mockResolvedValue([]),
  } as unknown as WorkerLeaseStore;
}

// ── Test Suite ──────────────────────────────────────────────────────────────

describe('task-runs routes', () => {
  let app: FastifyInstance;
  let taskRunStore: ReturnType<typeof createMockTaskRunStore>;
  let workerLeaseStore: ReturnType<typeof createMockWorkerLeaseStore>;

  beforeEach(async () => {
    taskRunStore = createMockTaskRunStore();
    workerLeaseStore = createMockWorkerLeaseStore();

    app = Fastify({ logger: false });
    await app.register(taskRunRoutes, {
      prefix: '/api/task-runs',
      taskRunStore,
      workerLeaseStore,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  // ── GET / ────────────────────────────────────────────────────────────────

  describe('GET /api/task-runs', () => {
    it('returns all task runs', async () => {
      const runs = [makeRun(), makeRun({ id: 'run-2', status: 'completed' })];
      vi.mocked(taskRunStore.listRuns).mockResolvedValueOnce(runs as never);

      const res = await app.inject({ method: 'GET', url: '/api/task-runs' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(2);
      expect(taskRunStore.listRuns).toHaveBeenCalledOnce();
    });

    it('returns an empty array when no runs exist', async () => {
      vi.mocked(taskRunStore.listRuns).mockResolvedValueOnce([]);

      const res = await app.inject({ method: 'GET', url: '/api/task-runs' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });
  });

  // ── POST / ───────────────────────────────────────────────────────────────

  describe('POST /api/task-runs', () => {
    it('creates a run and returns 201', async () => {
      const created = makeRun();
      vi.mocked(taskRunStore.createRun).mockResolvedValueOnce(created as never);

      const res = await app.inject({
        method: 'POST',
        url: '/api/task-runs',
        payload: {
          definitionId: DEF_ID,
          spaceId: SPACE_ID,
          threadId: THREAD_ID,
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ id: RUN_ID, definitionId: DEF_ID });
      expect(taskRunStore.createRun).toHaveBeenCalledWith({
        definitionId: DEF_ID,
        spaceId: SPACE_ID,
        threadId: THREAD_ID,
      });
    });

    it('passes optional fields through when omitted', async () => {
      vi.mocked(taskRunStore.createRun).mockResolvedValueOnce(
        makeRun({ spaceId: null, threadId: null }) as never,
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/task-runs',
        payload: { definitionId: DEF_ID },
      });

      expect(res.statusCode).toBe(201);
      expect(taskRunStore.createRun).toHaveBeenCalledWith({
        definitionId: DEF_ID,
        spaceId: undefined,
        threadId: undefined,
      });
    });

    it('returns 400 when definitionId is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/task-runs',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_DEFINITION_ID');
    });

    it('returns 400 when definitionId is not a string', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/task-runs',
        payload: { definitionId: 123 },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_DEFINITION_ID');
    });
  });

  // ── GET /:id ─────────────────────────────────────────────────────────────

  describe('GET /api/task-runs/:id', () => {
    it('returns the task run with its lease when one exists', async () => {
      vi.mocked(taskRunStore.getRun).mockResolvedValueOnce(makeRun() as never);
      vi.mocked(workerLeaseStore.getLease).mockResolvedValueOnce(makeLease() as never);

      const res = await app.inject({ method: 'GET', url: `/api/task-runs/${RUN_ID}` });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        id: RUN_ID,
        lease: expect.objectContaining({ taskRunId: RUN_ID, workerId: 'worker-1' }),
      });
    });

    it('returns lease as null when no lease exists', async () => {
      vi.mocked(taskRunStore.getRun).mockResolvedValueOnce(makeRun() as never);
      vi.mocked(workerLeaseStore.getLease).mockResolvedValueOnce(undefined);

      const res = await app.inject({ method: 'GET', url: `/api/task-runs/${RUN_ID}` });

      expect(res.statusCode).toBe(200);
      expect(res.json().lease).toBeNull();
    });

    it('returns 404 when the run does not exist', async () => {
      vi.mocked(taskRunStore.getRun).mockResolvedValueOnce(undefined);

      const res = await app.inject({ method: 'GET', url: '/api/task-runs/missing-run' });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('RUN_NOT_FOUND');
    });
  });

  // ── PATCH /:id ───────────────────────────────────────────────────────────

  describe('PATCH /api/task-runs/:id', () => {
    it('updates a run status and forwards result and error payloads', async () => {
      const updated = makeRun({
        status: 'completed',
        result: { ok: true },
        error: { warning: 'none' },
      });
      vi.mocked(taskRunStore.updateStatus).mockResolvedValueOnce(updated as never);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/task-runs/${RUN_ID}`,
        payload: {
          status: 'completed',
          result: { ok: true },
          error: { warning: 'none' },
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        id: RUN_ID,
        status: 'completed',
        result: { ok: true },
        error: { warning: 'none' },
      });
      expect(taskRunStore.updateStatus).toHaveBeenCalledWith(RUN_ID, {
        status: 'completed',
        result: { ok: true },
        error: { warning: 'none' },
      });
    });

    it('returns 400 when status is invalid', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/task-runs/${RUN_ID}`,
        payload: { status: 'queued' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_STATUS');
    });

    it('returns 404 when update targets a missing run', async () => {
      vi.mocked(taskRunStore.updateStatus).mockRejectedValueOnce(
        new ControlPlaneError('RUN_NOT_FOUND', 'Task run not found', {}),
      );

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/task-runs/${RUN_ID}`,
        payload: { status: 'running' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('RUN_NOT_FOUND');
    });
  });

  // ── POST /:id/claim ─────────────────────────────────────────────────────

  describe('POST /api/task-runs/:id/claim', () => {
    const validBody = {
      workerId: 'worker-1',
      agentInstanceId: 'agent-instance-1',
      durationMs: 120_000,
    };

    it('claims a lease for a pending run and marks the run claimed', async () => {
      vi.mocked(taskRunStore.getRun).mockResolvedValueOnce(makeRun({ status: 'pending' }) as never);
      vi.mocked(workerLeaseStore.claimLease).mockResolvedValueOnce(makeLease() as never);
      vi.mocked(taskRunStore.updateStatus).mockResolvedValueOnce(
        makeRun({ status: 'claimed' }) as never,
      );

      const res = await app.inject({
        method: 'POST',
        url: `/api/task-runs/${RUN_ID}/claim`,
        payload: validBody,
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ taskRunId: RUN_ID, workerId: 'worker-1' });
      expect(workerLeaseStore.claimLease).toHaveBeenCalledWith(
        RUN_ID,
        'worker-1',
        'agent-instance-1',
        120_000,
      );
      expect(taskRunStore.updateStatus).toHaveBeenCalledWith(RUN_ID, { status: 'claimed' });
    });

    it('returns 400 when workerId is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/task-runs/${RUN_ID}/claim`,
        payload: { ...validBody, workerId: '' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_WORKER_ID');
    });

    it('returns 400 when agentInstanceId is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/task-runs/${RUN_ID}/claim`,
        payload: { ...validBody, agentInstanceId: '' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_AGENT_INSTANCE_ID');
    });

    it('returns 404 when the run does not exist', async () => {
      vi.mocked(taskRunStore.getRun).mockResolvedValueOnce(undefined);

      const res = await app.inject({
        method: 'POST',
        url: `/api/task-runs/${RUN_ID}/claim`,
        payload: validBody,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('RUN_NOT_FOUND');
    });

    it('returns 409 when the run is not pending', async () => {
      vi.mocked(taskRunStore.getRun).mockResolvedValueOnce(makeRun({ status: 'running' }) as never);

      const res = await app.inject({
        method: 'POST',
        url: `/api/task-runs/${RUN_ID}/claim`,
        payload: validBody,
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('RUN_NOT_CLAIMABLE');
      expect(workerLeaseStore.claimLease).not.toHaveBeenCalled();
    });

    it('returns 409 when a lease already exists', async () => {
      vi.mocked(taskRunStore.getRun).mockResolvedValueOnce(makeRun({ status: 'pending' }) as never);
      vi.mocked(workerLeaseStore.claimLease).mockRejectedValueOnce(
        new ControlPlaneError('LEASE_ALREADY_EXISTS', 'Lease exists', {}),
      );

      const res = await app.inject({
        method: 'POST',
        url: `/api/task-runs/${RUN_ID}/claim`,
        payload: validBody,
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('LEASE_ALREADY_EXISTS');
      expect(taskRunStore.updateStatus).not.toHaveBeenCalled();
    });
  });

  // ── POST /:id/heartbeat ─────────────────────────────────────────────────

  describe('POST /api/task-runs/:id/heartbeat', () => {
    it('renews the lease and updates the run heartbeat', async () => {
      vi.mocked(workerLeaseStore.renewLease).mockResolvedValueOnce(makeLease() as never);

      const res = await app.inject({
        method: 'POST',
        url: `/api/task-runs/${RUN_ID}/heartbeat`,
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ taskRunId: RUN_ID, workerId: 'worker-1' });
      expect(workerLeaseStore.renewLease).toHaveBeenCalledWith(RUN_ID, undefined);
      expect(taskRunStore.updateHeartbeat).toHaveBeenCalledWith(RUN_ID);
    });

    it('passes durationMs to lease renewal', async () => {
      vi.mocked(workerLeaseStore.renewLease).mockResolvedValueOnce(makeLease() as never);

      const res = await app.inject({
        method: 'POST',
        url: `/api/task-runs/${RUN_ID}/heartbeat`,
        payload: { durationMs: 300_000 },
      });

      expect(res.statusCode).toBe(200);
      expect(workerLeaseStore.renewLease).toHaveBeenCalledWith(RUN_ID, 300_000);
    });

    it('returns 404 when no active lease exists', async () => {
      vi.mocked(workerLeaseStore.renewLease).mockRejectedValueOnce(
        new ControlPlaneError('LEASE_NOT_FOUND', 'Lease missing', {}),
      );

      const res = await app.inject({
        method: 'POST',
        url: `/api/task-runs/${RUN_ID}/heartbeat`,
        payload: {},
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('LEASE_NOT_FOUND');
      expect(taskRunStore.updateHeartbeat).not.toHaveBeenCalled();
    });
  });
});
