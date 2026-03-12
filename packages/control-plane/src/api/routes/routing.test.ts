import type {
  AgentProfile,
  RoutingDecision,
  RoutingOutcome,
  RoutingScoreBreakdown,
  TaskRun,
} from '@agentctl/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentProfileStore } from '../../collaboration/agent-profile-store.js';
import type { RoutingStore } from '../../collaboration/routing-store.js';
import type { TaskRunStore } from '../../collaboration/task-run-store.js';
import type { WorkerNodeStore } from '../../collaboration/worker-node-store.js';
import { RoutingEngine, type RoutingWeights } from '../../intelligence/routing-engine.js';
import { routingRoutes } from './routing.js';

// ── Helpers ─────────────────────────────────────────────────

const NOW = new Date().toISOString();

function makeProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: 'profile-1',
    name: 'Test Agent',
    runtimeType: 'claude-code',
    modelId: 'claude-sonnet-4-20250514',
    providerId: 'anthropic',
    capabilities: ['typescript', 'testing'],
    toolScopes: [],
    maxTokensPerTask: 100_000,
    maxCostPerHour: 5.0,
    createdAt: NOW,
    ...overrides,
  };
}

const mockBreakdown: RoutingScoreBreakdown = {
  capabilityMatch: 1.0,
  loadScore: 0.8,
  costScore: 0.7,
  successRateScore: 0.9,
  durationScore: 0.6,
  weightedTotal: 0.78,
};

const mockDecision: RoutingDecision = {
  id: 'decision-1',
  taskDefinitionId: 'td-1',
  taskRunId: 'run-1',
  selectedProfileId: 'profile-1',
  selectedNodeId: 'node-1',
  score: 0.78,
  breakdown: mockBreakdown,
  mode: 'auto',
  createdAt: NOW,
};

const mockOutcome: RoutingOutcome = {
  id: 'outcome-1',
  routingDecisionId: 'decision-1',
  taskRunId: 'run-1',
  profileId: 'profile-1',
  nodeId: 'node-1',
  capabilities: ['typescript'],
  status: 'completed',
  durationMs: 5000,
  costUsd: 0.5,
  tokensUsed: 10000,
  errorCode: null,
  createdAt: NOW,
};

const mockTaskRun: TaskRun = {
  id: 'run-1',
  definitionId: 'td-1',
  spaceId: null,
  threadId: null,
  status: 'completed',
  attempt: 1,
  assigneeInstanceId: 'instance-1',
  machineId: 'node-1',
  claimedAt: NOW,
  startedAt: NOW,
  completedAt: NOW,
  lastHeartbeatAt: NOW,
  result: null,
  error: null,
  createdAt: NOW,
};

// ── Test Setup ──────────────────────────────────────────────

describe('routing routes', () => {
  let app: FastifyInstance;

  const mockRoutingStore = {
    recordDecision: vi.fn().mockResolvedValue(mockDecision),
    getDecisionByTaskRun: vi.fn().mockResolvedValue(mockDecision),
    recordOutcome: vi.fn().mockResolvedValue(mockOutcome),
    getAggregateStats: vi.fn().mockResolvedValue({
      successRate: 0.9,
      avgDurationMs: 5000,
      avgCostUsd: 0.5,
      count: 10,
    }),
  } as unknown as RoutingStore;

  const mockAgentProfileStore = {
    listProfiles: vi.fn().mockResolvedValue([makeProfile()]),
    listInstancesByProfile: vi.fn().mockResolvedValue([]),
  } as unknown as AgentProfileStore;

  const mockWorkerNodeStore = {
    listNodes: vi.fn().mockResolvedValue([
      {
        id: 'node-1',
        hostname: 'test',
        tailscaleIp: '100.64.0.1',
        maxConcurrentAgents: 3,
        currentLoad: 0,
        capabilities: [],
        status: 'online',
        lastHeartbeatAt: NOW,
        createdAt: NOW,
      },
    ]),
  } as unknown as WorkerNodeStore;

  const mockTaskRunStore = {
    getRun: vi.fn().mockResolvedValue(mockTaskRun),
  } as unknown as TaskRunStore;

  const weights: RoutingWeights = { load: 0.25, cost: 0.2, successRate: 0.35, duration: 0.2 };
  const routingEngine = new RoutingEngine(weights);

  beforeAll(async () => {
    app = Fastify();
    await app.register(routingRoutes, {
      prefix: '/api/routing',
      routingEngine,
      routingStore: mockRoutingStore,
      agentProfileStore: mockAgentProfileStore,
      workerNodeStore: mockWorkerNodeStore,
      taskRunStore: mockTaskRunStore,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default mocks
    (mockRoutingStore.recordDecision as ReturnType<typeof vi.fn>).mockResolvedValue(mockDecision);
    (mockRoutingStore.getDecisionByTaskRun as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockDecision,
    );
    (mockRoutingStore.recordOutcome as ReturnType<typeof vi.fn>).mockResolvedValue(mockOutcome);
    (mockRoutingStore.getAggregateStats as ReturnType<typeof vi.fn>).mockResolvedValue({
      successRate: 0.9,
      avgDurationMs: 5000,
      avgCostUsd: 0.5,
      count: 10,
    });
    (mockAgentProfileStore.listProfiles as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeProfile(),
    ]);
    (mockAgentProfileStore.listInstancesByProfile as ReturnType<typeof vi.fn>).mockResolvedValue(
      [],
    );
    (mockTaskRunStore.getRun as ReturnType<typeof vi.fn>).mockResolvedValue(mockTaskRun);
  });

  describe('POST /api/routing/rank', () => {
    it('returns ranked candidates', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/routing/rank',
        payload: {
          taskDefinitionId: 'td-1',
          requiredCapabilities: ['typescript'],
          estimatedTokens: 50000,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);
      expect(body[0]).toHaveProperty('profileId');
      expect(body[0]).toHaveProperty('nodeId');
      expect(body[0]).toHaveProperty('score');
      expect(body[0]).toHaveProperty('breakdown');
    });

    it('returns 400 for missing required fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/routing/rank',
        payload: { taskDefinitionId: 'td-1' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /api/routing/assign', () => {
    it('records a routing decision', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/routing/assign',
        payload: {
          taskRunId: 'run-1',
          taskDefinitionId: 'td-1',
          profileId: 'profile-1',
          nodeId: 'node-1',
          score: 0.78,
          breakdown: mockBreakdown,
          mode: 'auto',
        },
      });

      expect(res.statusCode).toBe(201);
      expect(mockRoutingStore.recordDecision).toHaveBeenCalledOnce();
    });

    it('returns 400 for missing fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/routing/assign',
        payload: { taskRunId: 'run-1' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/routing/decisions/:taskRunId', () => {
    it('returns the routing decision for a task run', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/routing/decisions/run-1',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe('decision-1');
      expect(body.taskRunId).toBe('run-1');
    });

    it('returns 404 when no decision exists', async () => {
      (mockRoutingStore.getDecisionByTaskRun as ReturnType<typeof vi.fn>).mockResolvedValue(
        undefined,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/routing/decisions/unknown-run',
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /api/routing/outcomes', () => {
    it('records an outcome', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/routing/outcomes',
        payload: {
          taskRunId: 'run-1',
          status: 'completed',
          durationMs: 5000,
          costUsd: 0.5,
          tokensUsed: 10000,
        },
      });

      expect(res.statusCode).toBe(201);
      expect(mockRoutingStore.recordOutcome).toHaveBeenCalledOnce();
    });

    it('returns 400 for invalid status', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/routing/outcomes',
        payload: {
          taskRunId: 'run-1',
          status: 'invalid-status',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 404 when task run not found', async () => {
      (mockTaskRunStore.getRun as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const res = await app.inject({
        method: 'POST',
        url: '/api/routing/outcomes',
        payload: {
          taskRunId: 'unknown-run',
          status: 'completed',
        },
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
