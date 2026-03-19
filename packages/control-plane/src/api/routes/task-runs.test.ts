import type { TaskRun, WorkerLease } from '@agentctl/shared';
import { ControlPlaneError } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskRunStore } from '../../collaboration/task-run-store.js';
import type { WorkerLeaseStore } from '../../collaboration/worker-lease-store.js';
import { taskRunRoutes } from './task-runs.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const RUN_ID = 'run-0000-0000-0001';
const DEF_ID = 'def-001';
const WORKER_ID = 'worker-1';
const AGENT_INSTANCE_ID = 'instance-1';

function makeRun(overrides: Partial<TaskRun> = {}): TaskRun {
  return {
    id: RUN_ID,
    definitionId: DEF_ID,
    spaceId: null,
    threadId: null,
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
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeLease(overrides: Partial<WorkerLease> = {}): WorkerLease {
  return {
    taskRunId: RUN_ID,
    workerId: WORKER_ID,
    agentInstanceId: AGENT_INSTANCE_ID,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    renewedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── Mock stores ───────────────────────────────────────────────────────────────

function createMockTaskRunStore(): TaskRunStore {
  return {
    createRun: vi.fn(),
    getRun: vi.fn(),
    listRuns: vi.fn(),
    updateStatus: vi.fn(),
    updateHeartbeat: vi.fn(),
    getRunsByGraph: vi.fn(),
  } as unknown as TaskRunStore;
}

function createMockWorkerLeaseStore(): WorkerLeaseStore {
  return {
    claimLease: vi.fn(),
    renewLease: vi.fn(),
    releaseLease: vi.fn(),
    getLease: vi.fn(),
    getExpiredLeases: vi.fn(),
  } as unknown as WorkerLeaseStore;
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('task-runs routes', () => {
  let app: FastifyInstance;
  let taskRunStore: TaskRunStore;
  let workerLeaseStore: WorkerLeaseStore;

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

  // ── POST / (create run) ──────────────────────────────────────────────────

  describe('POST /api/task-runs', () => {
    const validBody = { definitionId: DEF_ID };

    it('creates a task run and returns 201', async () => {
      const run = makeRun();
      vi.mocked(taskRunStore.createRun).mockResolvedValueOnce(run);

      const res = await app.inject({
        method: 'POST',
        url: '/api/task-runs',
        payload: validBody,
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as TaskRun;
      expect(body.id).toBe(RUN_ID);
      expect(body.definitionId).toBe(DEF_ID);
      expect(body.status).toBe('pending');
    });

    it('passes optional spaceId and threadId to the store', async () => {
      vi.mocked(taskRunStore.createRun).mockResolvedValueOnce(
        makeRun({ spaceId: 'space-1', threadId: 'thread-1' }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/task-runs',
        payload: { definitionId: DEF_ID, spaceId: 'space-1', threadId: 'thread-1' },
      });

      expect(res.statusCode).toBe(201);
      expect(vi.mocked(taskRunStore.createRun)).toHaveBeenCalledWith(
        expect.objectContaining({ spaceId: 'space-1', threadId: 'thread-1' }),
      );
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

    it('returns 400 when definitionId is an empty string', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/task-runs',
        payload: { definitionId: '' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_DEFINITION_ID');
    });
  });

  // ── GET /:id (get run with lease) ────────────────────────────────────────

  describe('GET /api/task-runs/:id', () => {
    it('returns the run with lease when a lease exists', async () => {
      const run = makeRun();
      const lease = makeLease();
      vi.mocked(taskRunStore.getRun).mockResolvedValueOnce(run);
      vi.mocked(workerLeaseStore.getLease).mockResolvedValueOnce(lease);

      const res = await app.inject({ method: 'GET', url: `/api/task-runs/${RUN_ID}` });

      expect(res.statusCode).toBe(200);
      const body = res.json() as TaskRun & { lease: WorkerLease };
      expect(body.id).toBe(RUN_ID);
      expect(body.lease).toBeDefined();
      expect(body.lease.workerId).toBe(WORKER_ID);
    });

    it('returns the run with lease null when no lease exists', async () => {
      const run = makeRun();
      vi.mocked(taskRunStore.getRun).mockResolvedValueOnce(run);
      vi.mocked(workerLeaseStore.getLease).mockResolvedValueOnce(undefined);

      const res = await app.inject({ method: 'GET', url: `/api/task-runs/${RUN_ID}` });

      expect(res.statusCode).toBe(200);
      const body = res.json() as TaskRun & { lease: null };
      expect(body.lease).toBeNull();
    });

    it('returns 404 when run does not exist', async () => {
      vi.mocked(taskRunStore.getRun).mockResolvedValueOnce(undefined);

      const res = await app.inject({ method: 'GET', url: '/api/task-runs/nonexistent' });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('RUN_NOT_FOUND');
    });
  });

  // ── PATCH /:id (update status) ───────────────────────────────────────────

  describe('PATCH /api/task-runs/:id', () => {
    it('updates the run status and returns the updated run', async () => {
      const updated = makeRun({ status: 'running' });
      vi.mocked(taskRunStore.updateStatus).mockResolvedValueOnce(updated);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/task-runs/${RUN_ID}`,
        payload: { status: 'running' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('running');
    });

    it('accepts all valid task run statuses', async () => {
      const statuses = ['pending', 'claimed', 'running', 'completed', 'failed', 'cancelled'];
      for (const status of statuses) {
        vi.mocked(taskRunStore.updateStatus).mockResolvedValueOnce(
          makeRun({ status: status as TaskRun['status'] }),
        );
        const res = await app.inject({
          method: 'PATCH',
          url: `/api/task-runs/${RUN_ID}`,
          payload: { status },
        });
        expect(res.statusCode).toBe(200);
      }
    });

    it('passes result and error fields to the store', async () => {
      const updated = makeRun({ status: 'completed', result: { output: 'done' } });
      vi.mocked(taskRunStore.updateStatus).mockResolvedValueOnce(updated);

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/task-runs/${RUN_ID}`,
        payload: { status: 'completed', result: { output: 'done' } },
      });

      expect(res.statusCode).toBe(200);
      expect(vi.mocked(taskRunStore.updateStatus)).toHaveBeenCalledWith(
        RUN_ID,
        expect.objectContaining({ result: { output: 'done' } }),
      );
    });

    it('returns 400 when status is invalid', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/task-runs/${RUN_ID}`,
        payload: { status: 'unknown-status' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_STATUS');
    });

    it('returns 400 when status is missing', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/task-runs/${RUN_ID}`,
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_STATUS');
    });

    it('returns 404 when store throws RUN_NOT_FOUND', async () => {
      vi.mocked(taskRunStore.updateStatus).mockRejectedValueOnce(
        new ControlPlaneError('RUN_NOT_FOUND', 'Task run not found', {}),
      );

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/task-runs/nonexistent',
        payload: { status: 'running' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('RUN_NOT_FOUND');
    });

    it('re-throws unexpected errors', async () => {
      vi.mocked(taskRunStore.updateStatus).mockRejectedValueOnce(new Error('unexpected db error'));

      const res = await app.inject({
        method: 'PATCH',
        url: `/api/task-runs/${RUN_ID}`,
        payload: { status: 'running' },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── POST /:id/claim ──────────────────────────────────────────────────────

  describe('POST /api/task-runs/:id/claim', () => {
    const validBody = { workerId: WORKER_ID, agentInstanceId: AGENT_INSTANCE_ID };

    it('claims the lease and returns 201', async () => {
      const run = makeRun({ status: 'pending' });
      const lease = makeLease();
      vi.mocked(taskRunStore.getRun).mockResolvedValueOnce(run);
      vi.mocked(workerLeaseStore.claimLease).mockResolvedValueOnce(lease);
      vi.mocked(taskRunStore.updateStatus).mockResolvedValueOnce(makeRun({ status: 'claimed' }));

      const res = await app.inject({
        method: 'POST',
        url: `/api/task-runs/${RUN_ID}/claim`,
        payload: validBody,
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as WorkerLease;
      expect(body.workerId).toBe(WORKER_ID);
      expect(body.agentInstanceId).toBe(AGENT_INSTANCE_ID);
    });

    it('updates run status to claimed after claiming lease', async () => {
      const run = makeRun({ status: 'pending' });
      vi.mocked(taskRunStore.getRun).mockResolvedValueOnce(run);
      vi.mocked(workerLeaseStore.claimLease).mockResolvedValueOnce(makeLease());
      vi.mocked(taskRunStore.updateStatus).mockResolvedValueOnce(makeRun({ status: 'claimed' }));

      await app.inject({
        method: 'POST',
        url: `/api/task-runs/${RUN_ID}/claim`,
        payload: validBody,
      });

      expect(vi.mocked(taskRunStore.updateStatus)).toHaveBeenCalledWith(
        RUN_ID,
        expect.objectContaining({ status: 'claimed' }),
      );
    });

    it('passes optional durationMs to claimLease', async () => {
      const run = makeRun({ status: 'pending' });
      vi.mocked(taskRunStore.getRun).mockResolvedValueOnce(run);
      vi.mocked(workerLeaseStore.claimLease).mockResolvedValueOnce(makeLease());
      vi.mocked(taskRunStore.updateStatus).mockResolvedValueOnce(makeRun({ status: 'claimed' }));

      await app.inject({
        method: 'POST',
        url: `/api/task-runs/${RUN_ID}/claim`,
        payload: { ...validBody, durationMs: 120_000 },
      });

      expect(vi.mocked(workerLeaseStore.claimLease)).toHaveBeenCalledWith(
        RUN_ID,
        WORKER_ID,
        AGENT_INSTANCE_ID,
        120_000,
      );
    });

    it('returns 400 when workerId is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/task-runs/${RUN_ID}/claim`,
        payload: { agentInstanceId: AGENT_INSTANCE_ID },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_WORKER_ID');
    });

    it('returns 400 when workerId is an empty string', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/task-runs/${RUN_ID}/claim`,
        payload: { workerId: '', agentInstanceId: AGENT_INSTANCE_ID },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_WORKER_ID');
    });

    it('returns 400 when agentInstanceId is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/task-runs/${RUN_ID}/claim`,
        payload: { workerId: WORKER_ID },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_AGENT_INSTANCE_ID');
    });

    it('returns 400 when agentInstanceId is an empty string', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/task-runs/${RUN_ID}/claim`,
        payload: { workerId: WORKER_ID, agentInstanceId: '' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_AGENT_INSTANCE_ID');
    });

    it('returns 404 when run does not exist', async () => {
      vi.mocked(taskRunStore.getRun).mockResolvedValueOnce(undefined);

      const res = await app.inject({
        method: 'POST',
        url: '/api/task-runs/nonexistent/claim',
        payload: validBody,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('RUN_NOT_FOUND');
    });

    it('returns 409 when run is not pending', async () => {
      vi.mocked(taskRunStore.getRun).mockResolvedValueOnce(makeRun({ status: 'running' }));

      const res = await app.inject({
        method: 'POST',
        url: `/api/task-runs/${RUN_ID}/claim`,
        payload: validBody,
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('RUN_NOT_CLAIMABLE');
    });

    it('returns 409 when store throws LEASE_ALREADY_EXISTS', async () => {
      vi.mocked(taskRunStore.getRun).mockResolvedValueOnce(makeRun({ status: 'pending' }));
      vi.mocked(workerLeaseStore.claimLease).mockRejectedValueOnce(
        new ControlPlaneError('LEASE_ALREADY_EXISTS', 'A lease already exists', {}),
      );

      const res = await app.inject({
        method: 'POST',
        url: `/api/task-runs/${RUN_ID}/claim`,
        payload: validBody,
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('LEASE_ALREADY_EXISTS');
    });

    it('re-throws unexpected errors from claimLease', async () => {
      vi.mocked(taskRunStore.getRun).mockResolvedValueOnce(makeRun({ status: 'pending' }));
      vi.mocked(workerLeaseStore.claimLease).mockRejectedValueOnce(
        new Error('unexpected db error'),
      );

      const res = await app.inject({
        method: 'POST',
        url: `/api/task-runs/${RUN_ID}/claim`,
        payload: validBody,
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── POST /:id/heartbeat ──────────────────────────────────────────────────

  describe('POST /api/task-runs/:id/heartbeat', () => {
    it('renews the lease and updates the heartbeat', async () => {
      const lease = makeLease();
      vi.mocked(workerLeaseStore.renewLease).mockResolvedValueOnce(lease);
      vi.mocked(taskRunStore.updateHeartbeat).mockResolvedValueOnce(undefined);

      const res = await app.inject({
        method: 'POST',
        url: `/api/task-runs/${RUN_ID}/heartbeat`,
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as WorkerLease;
      expect(body.taskRunId).toBe(RUN_ID);
    });

    it('passes optional durationMs to renewLease', async () => {
      vi.mocked(workerLeaseStore.renewLease).mockResolvedValueOnce(makeLease());
      vi.mocked(taskRunStore.updateHeartbeat).mockResolvedValueOnce(undefined);

      await app.inject({
        method: 'POST',
        url: `/api/task-runs/${RUN_ID}/heartbeat`,
        payload: { durationMs: 60_000 },
      });

      expect(vi.mocked(workerLeaseStore.renewLease)).toHaveBeenCalledWith(RUN_ID, 60_000);
    });

    it('calls updateHeartbeat after renewing lease', async () => {
      vi.mocked(workerLeaseStore.renewLease).mockResolvedValueOnce(makeLease());
      vi.mocked(taskRunStore.updateHeartbeat).mockResolvedValueOnce(undefined);

      await app.inject({
        method: 'POST',
        url: `/api/task-runs/${RUN_ID}/heartbeat`,
        payload: {},
      });

      expect(vi.mocked(taskRunStore.updateHeartbeat)).toHaveBeenCalledWith(RUN_ID);
    });

    it('returns 404 when store throws LEASE_NOT_FOUND', async () => {
      vi.mocked(workerLeaseStore.renewLease).mockRejectedValueOnce(
        new ControlPlaneError('LEASE_NOT_FOUND', 'No lease found', {}),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/task-runs/nonexistent/heartbeat',
        payload: {},
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('LEASE_NOT_FOUND');
    });

    it('re-throws unexpected errors from renewLease', async () => {
      vi.mocked(workerLeaseStore.renewLease).mockRejectedValueOnce(
        new Error('unexpected db error'),
      );

      const res = await app.inject({
        method: 'POST',
        url: `/api/task-runs/${RUN_ID}/heartbeat`,
        payload: {},
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── GET / (list runs) ────────────────────────────────────────────────────

  describe('GET /api/task-runs', () => {
    it('returns all task runs', async () => {
      const runs = [makeRun(), makeRun({ id: 'run-002', status: 'completed' })];
      vi.mocked(taskRunStore.listRuns).mockResolvedValueOnce(runs);

      const res = await app.inject({ method: 'GET', url: '/api/task-runs' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(2);
    });

    it('returns empty array when no runs exist', async () => {
      vi.mocked(taskRunStore.listRuns).mockResolvedValueOnce([]);

      const res = await app.inject({ method: 'GET', url: '/api/task-runs' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(0);
    });
  });
});
