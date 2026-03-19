import type { ApprovalDecision, ApprovalGate } from '@agentctl/shared';
import { ControlPlaneError } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApprovalStore } from '../../collaboration/approval-store.js';
import { approvalRoutes } from './approvals.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const GATE_ID = 'gate-0000-0000-0001';
const TASK_DEF_ID = 'taskdef-001';
const THREAD_ID = 'thread-001';
const TASK_RUN_ID = 'run-001';

function makeGate(overrides: Partial<ApprovalGate> = {}): ApprovalGate {
  return {
    id: GATE_ID,
    taskDefinitionId: TASK_DEF_ID,
    taskRunId: TASK_RUN_ID,
    threadId: THREAD_ID,
    requiredApprovers: [],
    requiredCount: 1,
    timeoutMs: 3_600_000,
    timeoutPolicy: 'pause',
    contextArtifactIds: [],
    status: 'pending',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeDecision(overrides: Partial<ApprovalDecision> = {}): ApprovalDecision {
  return {
    id: 'decision-001',
    gateId: GATE_ID,
    decidedBy: 'user-1',
    action: 'approved',
    comment: null,
    viaTimeout: false,
    decidedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── Mock ApprovalStore ────────────────────────────────────────────────────────

function createMockApprovalStore(): ApprovalStore {
  return {
    createGate: vi.fn(),
    getGate: vi.fn(),
    listGatesByThread: vi.fn(),
    addDecision: vi.fn(),
    getDecisions: vi.fn(),
    tryResolveGate: vi.fn(),
    timeoutGate: vi.fn(),
  } as unknown as ApprovalStore;
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('approval routes', () => {
  let app: FastifyInstance;
  let store: ApprovalStore;

  beforeEach(async () => {
    store = createMockApprovalStore();
    app = Fastify({ logger: false });
    await app.register(approvalRoutes, { prefix: '/api/approvals', approvalStore: store });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  // ── POST / (create gate) ──────────────────────────────────────────────────

  describe('POST /api/approvals', () => {
    const validBody = { taskDefinitionId: TASK_DEF_ID, taskRunId: TASK_RUN_ID };

    it('creates an approval gate and returns 201', async () => {
      const gate = makeGate();
      vi.mocked(store.createGate).mockResolvedValueOnce(gate);

      const res = await app.inject({
        method: 'POST',
        url: '/api/approvals',
        payload: validBody,
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as ApprovalGate;
      expect(body.id).toBe(GATE_ID);
      expect(body.taskDefinitionId).toBe(TASK_DEF_ID);
      expect(body.status).toBe('pending');
    });

    it('passes optional fields through to the store', async () => {
      const gate = makeGate({ requiredCount: 2, timeoutPolicy: 'auto-approve' });
      vi.mocked(store.createGate).mockResolvedValueOnce(gate);

      const res = await app.inject({
        method: 'POST',
        url: '/api/approvals',
        payload: {
          ...validBody,
          requiredApprovers: ['user-a', 'user-b'],
          requiredCount: 2,
          timeoutMs: 60_000,
          timeoutPolicy: 'auto-approve',
          contextArtifactIds: ['artifact-1'],
        },
      });

      expect(res.statusCode).toBe(201);
      expect(vi.mocked(store.createGate)).toHaveBeenCalledWith(
        expect.objectContaining({ requiredCount: 2, timeoutPolicy: 'auto-approve' }),
      );
    });

    it('returns 400 when taskDefinitionId is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/approvals',
        payload: { taskRunId: TASK_RUN_ID },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_TASK_DEFINITION_ID');
    });

    it('returns 400 when taskDefinitionId is an empty string', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/approvals',
        payload: { taskDefinitionId: '' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_TASK_DEFINITION_ID');
    });

    it('returns 400 when timeoutPolicy is invalid', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/approvals',
        payload: { ...validBody, timeoutPolicy: 'bad-policy' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_TIMEOUT_POLICY');
    });

    it('accepts all valid timeoutPolicy values', async () => {
      const policies = ['auto-approve', 'escalate', 'pause', 'reject'];
      for (const policy of policies) {
        vi.mocked(store.createGate).mockResolvedValueOnce(
          makeGate({ timeoutPolicy: policy as ApprovalGate['timeoutPolicy'] }),
        );
        const res = await app.inject({
          method: 'POST',
          url: '/api/approvals',
          payload: { ...validBody, timeoutPolicy: policy },
        });
        expect(res.statusCode).toBe(201);
      }
    });
  });

  // ── GET /:id (get gate with decisions) ───────────────────────────────────

  describe('GET /api/approvals/:id', () => {
    it('returns the gate with its decisions', async () => {
      const gate = makeGate();
      const decisions = [makeDecision()];
      vi.mocked(store.getGate).mockResolvedValueOnce(gate);
      vi.mocked(store.getDecisions).mockResolvedValueOnce(decisions);

      const res = await app.inject({ method: 'GET', url: `/api/approvals/${GATE_ID}` });

      expect(res.statusCode).toBe(200);
      const body = res.json() as ApprovalGate & { decisions: ApprovalDecision[] };
      expect(body.id).toBe(GATE_ID);
      expect(body.decisions).toHaveLength(1);
      expect(body.decisions[0].action).toBe('approved');
    });

    it('returns 404 when gate does not exist', async () => {
      vi.mocked(store.getGate).mockResolvedValueOnce(undefined);

      const res = await app.inject({ method: 'GET', url: '/api/approvals/nonexistent' });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('GATE_NOT_FOUND');
    });
  });

  // ── GET / (list gates by thread) ─────────────────────────────────────────

  describe('GET /api/approvals', () => {
    it('returns gates for the given threadId', async () => {
      const gates = [makeGate(), makeGate({ id: 'gate-002' })];
      vi.mocked(store.listGatesByThread).mockResolvedValueOnce(gates);

      const res = await app.inject({
        method: 'GET',
        url: `/api/approvals?threadId=${THREAD_ID}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(2);
    });

    it('returns 400 when threadId is missing', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/approvals' });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_THREAD_ID');
    });

    it('returns 400 when threadId is an empty string', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/approvals?threadId=' });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_THREAD_ID');
    });
  });

  // ── POST /:id/decisions (add decision) ───────────────────────────────────

  describe('POST /api/approvals/:id/decisions', () => {
    const validBody = { decidedBy: 'user-1', action: 'approved' };

    it('adds a decision and returns 201', async () => {
      const decision = makeDecision();
      vi.mocked(store.addDecision).mockResolvedValueOnce(decision);

      const res = await app.inject({
        method: 'POST',
        url: `/api/approvals/${GATE_ID}/decisions`,
        payload: validBody,
      });

      expect(res.statusCode).toBe(201);
      const body = res.json() as ApprovalDecision;
      expect(body.gateId).toBe(GATE_ID);
      expect(body.action).toBe('approved');
    });

    it('passes gateId from route param to the store', async () => {
      vi.mocked(store.addDecision).mockResolvedValueOnce(makeDecision());

      await app.inject({
        method: 'POST',
        url: `/api/approvals/${GATE_ID}/decisions`,
        payload: validBody,
      });

      expect(vi.mocked(store.addDecision)).toHaveBeenCalledWith(
        expect.objectContaining({ gateId: GATE_ID }),
      );
    });

    it('accepts all valid action values', async () => {
      const actions = ['approved', 'rejected', 'changes-requested'];
      for (const action of actions) {
        vi.mocked(store.addDecision).mockResolvedValueOnce(
          makeDecision({ action: action as ApprovalDecision['action'] }),
        );
        const res = await app.inject({
          method: 'POST',
          url: `/api/approvals/${GATE_ID}/decisions`,
          payload: { decidedBy: 'user-1', action },
        });
        expect(res.statusCode).toBe(201);
      }
    });

    it('returns 400 when decidedBy is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/approvals/${GATE_ID}/decisions`,
        payload: { action: 'approved' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_DECIDED_BY');
    });

    it('returns 400 when decidedBy is an empty string', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/approvals/${GATE_ID}/decisions`,
        payload: { decidedBy: '', action: 'approved' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_DECIDED_BY');
    });

    it('returns 400 when action is invalid', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/approvals/${GATE_ID}/decisions`,
        payload: { decidedBy: 'user-1', action: 'maybe' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_ACTION');
    });

    it('returns 400 when action is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/approvals/${GATE_ID}/decisions`,
        payload: { decidedBy: 'user-1' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_ACTION');
    });

    it('returns 404 when store throws GATE_NOT_FOUND', async () => {
      vi.mocked(store.addDecision).mockRejectedValueOnce(
        new ControlPlaneError('GATE_NOT_FOUND', 'Approval gate not found', {}),
      );

      const res = await app.inject({
        method: 'POST',
        url: `/api/approvals/nonexistent/decisions`,
        payload: validBody,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('GATE_NOT_FOUND');
    });

    it('returns 409 when store throws GATE_ALREADY_RESOLVED', async () => {
      vi.mocked(store.addDecision).mockRejectedValueOnce(
        new ControlPlaneError('GATE_ALREADY_RESOLVED', 'Gate is already approved', {}),
      );

      const res = await app.inject({
        method: 'POST',
        url: `/api/approvals/${GATE_ID}/decisions`,
        payload: validBody,
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('GATE_ALREADY_RESOLVED');
    });

    it('re-throws unexpected errors', async () => {
      vi.mocked(store.addDecision).mockRejectedValueOnce(new Error('unexpected db error'));

      const res = await app.inject({
        method: 'POST',
        url: `/api/approvals/${GATE_ID}/decisions`,
        payload: validBody,
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── GET /:id/decisions ───────────────────────────────────────────────────

  describe('GET /api/approvals/:id/decisions', () => {
    it('returns decisions for an existing gate', async () => {
      const gate = makeGate();
      const decisions = [makeDecision(), makeDecision({ id: 'decision-002', action: 'rejected' })];
      vi.mocked(store.getGate).mockResolvedValueOnce(gate);
      vi.mocked(store.getDecisions).mockResolvedValueOnce(decisions);

      const res = await app.inject({
        method: 'GET',
        url: `/api/approvals/${GATE_ID}/decisions`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(2);
    });

    it('returns 404 when gate does not exist', async () => {
      vi.mocked(store.getGate).mockResolvedValueOnce(undefined);

      const res = await app.inject({
        method: 'GET',
        url: '/api/approvals/nonexistent/decisions',
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('GATE_NOT_FOUND');
    });
  });
});
