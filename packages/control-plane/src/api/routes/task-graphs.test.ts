import { ControlPlaneError } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskGraphStore } from '../../collaboration/task-graph-store.js';
import type { TaskRunStore } from '../../collaboration/task-run-store.js';
import { taskGraphRoutes } from './task-graphs.js';

// ── Fixture IDs ────────────────────────────────────────────────────────────

const GRAPH_ID = 'graph-00000000-0000-4000-a000-000000000001';
const DEF_ID_A = 'def-aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const DEF_ID_B = 'def-bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const NOW = new Date().toISOString();

// ── Fixture Factories ──────────────────────────────────────────────────────

function makeGraph(overrides: Record<string, unknown> = {}) {
  return {
    id: GRAPH_ID,
    name: 'Test Graph',
    createdAt: NOW,
    ...overrides,
  };
}

function makeDefinition(overrides: Record<string, unknown> = {}) {
  return {
    id: DEF_ID_A,
    graphId: GRAPH_ID,
    type: 'task',
    name: 'My Task',
    description: '',
    requiredCapabilities: [],
    estimatedTokens: null,
    timeoutMs: 3600000,
    maxRetryAttempts: 1,
    retryBackoffMs: 5000,
    createdAt: NOW,
    ...overrides,
  };
}

function makeEdge(overrides: Record<string, unknown> = {}) {
  return {
    fromDefinition: DEF_ID_A,
    toDefinition: DEF_ID_B,
    type: 'blocks',
    ...overrides,
  };
}

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-001',
    definitionId: DEF_ID_A,
    spaceId: null,
    threadId: null,
    status: 'completed',
    attempt: 1,
    assigneeInstanceId: null,
    machineId: null,
    claimedAt: null,
    startedAt: null,
    completedAt: NOW,
    lastHeartbeatAt: null,
    result: null,
    error: null,
    createdAt: NOW,
    ...overrides,
  };
}

// ── Store Mock Factories ───────────────────────────────────────────────────

function createMockTaskGraphStore(): TaskGraphStore {
  return {
    createGraph: vi.fn(),
    getGraph: vi.fn(),
    listGraphs: vi.fn(),
    deleteGraph: vi.fn(),
    addDefinition: vi.fn(),
    getDefinitions: vi.fn(),
    getDefinition: vi.fn(),
    addEdge: vi.fn(),
    getEdges: vi.fn(),
    removeEdge: vi.fn(),
    validateGraph: vi.fn(),
    getReadyDefinitions: vi.fn(),
  } as unknown as TaskGraphStore;
}

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

// ── Test Suite ─────────────────────────────────────────────────────────────

describe('task-graphs routes', () => {
  let app: FastifyInstance;
  let taskGraphStore: ReturnType<typeof createMockTaskGraphStore>;
  let taskRunStore: ReturnType<typeof createMockTaskRunStore>;

  beforeEach(async () => {
    taskGraphStore = createMockTaskGraphStore();
    taskRunStore = createMockTaskRunStore();

    app = Fastify({ logger: false });
    await app.register(taskGraphRoutes, {
      prefix: '/api/task-graphs',
      taskGraphStore,
      taskRunStore,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  // ── GET / ─────────────────────────────────────────────────────────────

  describe('GET /api/task-graphs', () => {
    it('returns an array of all graphs', async () => {
      const graphs = [makeGraph(), makeGraph({ id: 'graph-002', name: 'Graph B' })];
      vi.mocked(taskGraphStore.listGraphs).mockResolvedValueOnce(graphs as never);

      const res = await app.inject({ method: 'GET', url: '/api/task-graphs' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(2);
    });

    it('returns an empty array when no graphs exist', async () => {
      vi.mocked(taskGraphStore.listGraphs).mockResolvedValueOnce([]);

      const res = await app.inject({ method: 'GET', url: '/api/task-graphs' });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });
  });

  // ── POST / ────────────────────────────────────────────────────────────

  describe('POST /api/task-graphs', () => {
    it('creates a graph and returns 201', async () => {
      const graph = makeGraph();
      vi.mocked(taskGraphStore.createGraph).mockResolvedValueOnce(graph as never);

      const res = await app.inject({
        method: 'POST',
        url: '/api/task-graphs',
        payload: { name: 'Test Graph' },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBe(GRAPH_ID);
      expect(body.name).toBe('Test Graph');
    });

    it('trims whitespace from name before creating', async () => {
      const graph = makeGraph({ name: 'Trimmed' });
      vi.mocked(taskGraphStore.createGraph).mockResolvedValueOnce(graph as never);

      const res = await app.inject({
        method: 'POST',
        url: '/api/task-graphs',
        payload: { name: '  Trimmed  ' },
      });

      expect(res.statusCode).toBe(201);
      expect(vi.mocked(taskGraphStore.createGraph)).toHaveBeenCalledWith({ name: 'Trimmed' });
    });

    it('returns 400 when name is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/task-graphs',
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_NAME');
    });

    it('returns 400 when name is an empty string', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/task-graphs',
        payload: { name: '' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_NAME');
    });

    it('returns 400 when name is only whitespace', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/task-graphs',
        payload: { name: '   ' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_NAME');
    });
  });

  // ── GET /:id ──────────────────────────────────────────────────────────

  describe('GET /api/task-graphs/:id', () => {
    it('returns graph with definitions and edges', async () => {
      const graph = makeGraph();
      const definitions = [makeDefinition()];
      const edges = [makeEdge()];

      vi.mocked(taskGraphStore.getGraph).mockResolvedValueOnce(graph as never);
      vi.mocked(taskGraphStore.getDefinitions).mockResolvedValueOnce(definitions as never);
      vi.mocked(taskGraphStore.getEdges).mockResolvedValueOnce(edges as never);

      const res = await app.inject({ method: 'GET', url: `/api/task-graphs/${GRAPH_ID}` });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(GRAPH_ID);
      expect(body.definitions).toHaveLength(1);
      expect(body.edges).toHaveLength(1);
    });

    it('returns 404 when graph does not exist', async () => {
      vi.mocked(taskGraphStore.getGraph).mockResolvedValueOnce(undefined);

      const res = await app.inject({ method: 'GET', url: '/api/task-graphs/nonexistent' });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('GRAPH_NOT_FOUND');
    });

    it('returns empty arrays for definitions and edges when graph has none', async () => {
      const graph = makeGraph();
      vi.mocked(taskGraphStore.getGraph).mockResolvedValueOnce(graph as never);
      vi.mocked(taskGraphStore.getDefinitions).mockResolvedValueOnce([]);
      vi.mocked(taskGraphStore.getEdges).mockResolvedValueOnce([]);

      const res = await app.inject({ method: 'GET', url: `/api/task-graphs/${GRAPH_ID}` });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.definitions).toEqual([]);
      expect(body.edges).toEqual([]);
    });
  });

  // ── DELETE /:id ───────────────────────────────────────────────────────

  describe('DELETE /api/task-graphs/:id', () => {
    it('deletes a graph and returns ok: true', async () => {
      vi.mocked(taskGraphStore.deleteGraph).mockResolvedValueOnce(undefined);

      const res = await app.inject({ method: 'DELETE', url: `/api/task-graphs/${GRAPH_ID}` });

      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
    });

    it('returns 404 when graph does not exist', async () => {
      vi.mocked(taskGraphStore.deleteGraph).mockRejectedValueOnce(
        new ControlPlaneError('GRAPH_NOT_FOUND', 'Task graph not found'),
      );

      const res = await app.inject({ method: 'DELETE', url: '/api/task-graphs/nonexistent' });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('GRAPH_NOT_FOUND');
    });

    it('re-throws unexpected errors from deleteGraph', async () => {
      vi.mocked(taskGraphStore.deleteGraph).mockRejectedValueOnce(new Error('DB connection lost'));

      const res = await app.inject({ method: 'DELETE', url: `/api/task-graphs/${GRAPH_ID}` });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── POST /:id/definitions ─────────────────────────────────────────────

  describe('POST /api/task-graphs/:id/definitions', () => {
    const validBody = {
      type: 'task',
      name: 'My Definition',
    };

    it('adds a definition and returns 201', async () => {
      const graph = makeGraph();
      const definition = makeDefinition();

      vi.mocked(taskGraphStore.getGraph).mockResolvedValueOnce(graph as never);
      vi.mocked(taskGraphStore.addDefinition).mockResolvedValueOnce(definition as never);

      const res = await app.inject({
        method: 'POST',
        url: `/api/task-graphs/${GRAPH_ID}/definitions`,
        payload: validBody,
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().id).toBe(DEF_ID_A);
    });

    it('passes optional fields to addDefinition', async () => {
      const graph = makeGraph();
      const definition = makeDefinition({ description: 'A detailed task', estimatedTokens: 1000 });

      vi.mocked(taskGraphStore.getGraph).mockResolvedValueOnce(graph as never);
      vi.mocked(taskGraphStore.addDefinition).mockResolvedValueOnce(definition as never);

      const res = await app.inject({
        method: 'POST',
        url: `/api/task-graphs/${GRAPH_ID}/definitions`,
        payload: {
          ...validBody,
          description: 'A detailed task',
          estimatedTokens: 1000,
          timeoutMs: 60000,
          maxRetryAttempts: 3,
          retryBackoffMs: 2000,
          requiredCapabilities: ['gpu'],
        },
      });

      expect(res.statusCode).toBe(201);
      expect(vi.mocked(taskGraphStore.addDefinition)).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'A detailed task',
          estimatedTokens: 1000,
          timeoutMs: 60000,
          maxRetryAttempts: 3,
          retryBackoffMs: 2000,
          requiredCapabilities: ['gpu'],
        }),
      );
    });

    it('returns 404 when graph does not exist', async () => {
      vi.mocked(taskGraphStore.getGraph).mockResolvedValueOnce(undefined);

      const res = await app.inject({
        method: 'POST',
        url: '/api/task-graphs/nonexistent/definitions',
        payload: validBody,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('GRAPH_NOT_FOUND');
    });

    it('returns 400 when type is invalid', async () => {
      const graph = makeGraph();
      vi.mocked(taskGraphStore.getGraph).mockResolvedValueOnce(graph as never);

      const res = await app.inject({
        method: 'POST',
        url: `/api/task-graphs/${GRAPH_ID}/definitions`,
        payload: { ...validBody, type: 'invalid-type' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_TYPE');
    });

    it('returns 400 when type is missing', async () => {
      const graph = makeGraph();
      vi.mocked(taskGraphStore.getGraph).mockResolvedValueOnce(graph as never);

      const res = await app.inject({
        method: 'POST',
        url: `/api/task-graphs/${GRAPH_ID}/definitions`,
        payload: { name: 'My Task' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_TYPE');
    });

    it('returns 400 when name is empty', async () => {
      const graph = makeGraph();
      vi.mocked(taskGraphStore.getGraph).mockResolvedValueOnce(graph as never);

      const res = await app.inject({
        method: 'POST',
        url: `/api/task-graphs/${GRAPH_ID}/definitions`,
        payload: { type: 'task', name: '' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_NAME');
    });

    it('accepts all valid node types', async () => {
      const nodeTypes = ['task', 'gate', 'fork', 'join'];

      for (const nodeType of nodeTypes) {
        const graph = makeGraph();
        const definition = makeDefinition({ type: nodeType });

        vi.mocked(taskGraphStore.getGraph).mockResolvedValueOnce(graph as never);
        vi.mocked(taskGraphStore.addDefinition).mockResolvedValueOnce(definition as never);

        const res = await app.inject({
          method: 'POST',
          url: `/api/task-graphs/${GRAPH_ID}/definitions`,
          payload: { type: nodeType, name: 'Node' },
        });

        expect(res.statusCode).toBe(201);
      }
    });
  });

  // ── POST /:id/edges ───────────────────────────────────────────────────

  describe('POST /api/task-graphs/:id/edges', () => {
    const validBody = {
      fromDefinition: DEF_ID_A,
      toDefinition: DEF_ID_B,
      type: 'blocks',
    };

    it('adds an edge and returns 201 when graph is valid', async () => {
      const graph = makeGraph();
      const edge = makeEdge();

      vi.mocked(taskGraphStore.getGraph).mockResolvedValueOnce(graph as never);
      vi.mocked(taskGraphStore.addEdge).mockResolvedValueOnce(edge as never);
      vi.mocked(taskGraphStore.validateGraph).mockResolvedValueOnce({
        valid: true,
        errors: [],
      } as never);

      const res = await app.inject({
        method: 'POST',
        url: `/api/task-graphs/${GRAPH_ID}/edges`,
        payload: validBody,
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.fromDefinition).toBe(DEF_ID_A);
      expect(body.toDefinition).toBe(DEF_ID_B);
    });

    it('rolls back and returns 400 when adding edge creates invalid DAG', async () => {
      const graph = makeGraph();
      const edge = makeEdge();

      vi.mocked(taskGraphStore.getGraph).mockResolvedValueOnce(graph as never);
      vi.mocked(taskGraphStore.addEdge).mockResolvedValueOnce(edge as never);
      vi.mocked(taskGraphStore.validateGraph).mockResolvedValueOnce({
        valid: false,
        errors: ['Cycle detected'],
      } as never);
      vi.mocked(taskGraphStore.removeEdge).mockResolvedValueOnce(undefined);

      const res = await app.inject({
        method: 'POST',
        url: `/api/task-graphs/${GRAPH_ID}/edges`,
        payload: validBody,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_DAG');
      expect(vi.mocked(taskGraphStore.removeEdge)).toHaveBeenCalledWith(DEF_ID_A, DEF_ID_B);
    });

    it('does best-effort rollback when removeEdge throws', async () => {
      const graph = makeGraph();
      const edge = makeEdge();

      vi.mocked(taskGraphStore.getGraph).mockResolvedValueOnce(graph as never);
      vi.mocked(taskGraphStore.addEdge).mockResolvedValueOnce(edge as never);
      vi.mocked(taskGraphStore.validateGraph).mockResolvedValueOnce({
        valid: false,
        errors: ['Cycle detected'],
      } as never);
      vi.mocked(taskGraphStore.removeEdge).mockRejectedValueOnce(new Error('already gone'));

      const res = await app.inject({
        method: 'POST',
        url: `/api/task-graphs/${GRAPH_ID}/edges`,
        payload: validBody,
      });

      // Still returns 400 even if rollback fails
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_DAG');
    });

    it('returns 404 when graph does not exist', async () => {
      vi.mocked(taskGraphStore.getGraph).mockResolvedValueOnce(undefined);

      const res = await app.inject({
        method: 'POST',
        url: '/api/task-graphs/nonexistent/edges',
        payload: validBody,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('GRAPH_NOT_FOUND');
    });

    it('returns 400 when fromDefinition is missing', async () => {
      const graph = makeGraph();
      vi.mocked(taskGraphStore.getGraph).mockResolvedValueOnce(graph as never);

      const res = await app.inject({
        method: 'POST',
        url: `/api/task-graphs/${GRAPH_ID}/edges`,
        payload: { toDefinition: DEF_ID_B, type: 'blocks' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_EDGE');
    });

    it('returns 400 when toDefinition is missing', async () => {
      const graph = makeGraph();
      vi.mocked(taskGraphStore.getGraph).mockResolvedValueOnce(graph as never);

      const res = await app.inject({
        method: 'POST',
        url: `/api/task-graphs/${GRAPH_ID}/edges`,
        payload: { fromDefinition: DEF_ID_A, type: 'blocks' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_EDGE');
    });

    it('returns 400 when edge type is invalid', async () => {
      const graph = makeGraph();
      vi.mocked(taskGraphStore.getGraph).mockResolvedValueOnce(graph as never);

      const res = await app.inject({
        method: 'POST',
        url: `/api/task-graphs/${GRAPH_ID}/edges`,
        payload: { ...validBody, type: 'invalid-edge-type' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_EDGE_TYPE');
    });

    it('accepts all valid edge types', async () => {
      const edgeTypes = ['blocks', 'context'];

      for (const edgeType of edgeTypes) {
        const graph = makeGraph();
        const edge = makeEdge({ type: edgeType });

        vi.mocked(taskGraphStore.getGraph).mockResolvedValueOnce(graph as never);
        vi.mocked(taskGraphStore.addEdge).mockResolvedValueOnce(edge as never);
        vi.mocked(taskGraphStore.validateGraph).mockResolvedValueOnce({
          valid: true,
          errors: [],
        } as never);

        const res = await app.inject({
          method: 'POST',
          url: `/api/task-graphs/${GRAPH_ID}/edges`,
          payload: { ...validBody, type: edgeType },
        });

        expect(res.statusCode).toBe(201);
      }
    });
  });

  // ── POST /:id/validate ────────────────────────────────────────────────

  describe('POST /api/task-graphs/:id/validate', () => {
    it('returns validation result for a valid graph', async () => {
      const graph = makeGraph();
      const validationResult = { valid: true, errors: [] };

      vi.mocked(taskGraphStore.getGraph).mockResolvedValueOnce(graph as never);
      vi.mocked(taskGraphStore.validateGraph).mockResolvedValueOnce(validationResult as never);

      const res = await app.inject({
        method: 'POST',
        url: `/api/task-graphs/${GRAPH_ID}/validate`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.valid).toBe(true);
      expect(body.errors).toEqual([]);
    });

    it('returns validation errors for an invalid graph', async () => {
      const graph = makeGraph();
      const validationResult = { valid: false, errors: ['Cycle detected between node A and B'] };

      vi.mocked(taskGraphStore.getGraph).mockResolvedValueOnce(graph as never);
      vi.mocked(taskGraphStore.validateGraph).mockResolvedValueOnce(validationResult as never);

      const res = await app.inject({
        method: 'POST',
        url: `/api/task-graphs/${GRAPH_ID}/validate`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.valid).toBe(false);
      expect(body.errors).toHaveLength(1);
    });

    it('returns 404 when graph does not exist', async () => {
      vi.mocked(taskGraphStore.getGraph).mockResolvedValueOnce(undefined);

      const res = await app.inject({
        method: 'POST',
        url: '/api/task-graphs/nonexistent/validate',
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('GRAPH_NOT_FOUND');
    });
  });

  // ── GET /:id/ready ────────────────────────────────────────────────────

  describe('GET /api/task-graphs/:id/ready', () => {
    it('returns ready definitions for a graph with completed runs', async () => {
      const graph = makeGraph();
      const defA = makeDefinition({ id: DEF_ID_A });
      const defB = makeDefinition({ id: DEF_ID_B });
      const definitions = [defA, defB];
      const edges = [makeEdge({ fromDefinition: DEF_ID_A, toDefinition: DEF_ID_B })];
      const completedRun = makeRun({ definitionId: DEF_ID_A, status: 'completed' });

      vi.mocked(taskGraphStore.getGraph).mockResolvedValueOnce(graph as never);
      vi.mocked(taskGraphStore.getDefinitions).mockResolvedValueOnce(definitions as never);
      vi.mocked(taskGraphStore.getEdges).mockResolvedValueOnce(edges as never);
      vi.mocked(taskRunStore.getRunsByGraph).mockResolvedValueOnce([completedRun] as never);
      vi.mocked(taskGraphStore.getReadyDefinitions).mockReturnValueOnce([defB] as never);

      const res = await app.inject({
        method: 'GET',
        url: `/api/task-graphs/${GRAPH_ID}/ready`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].id).toBe(DEF_ID_B);
    });

    it('returns all definitions as ready when no runs exist', async () => {
      const graph = makeGraph();
      const definitions = [makeDefinition()];

      vi.mocked(taskGraphStore.getGraph).mockResolvedValueOnce(graph as never);
      vi.mocked(taskGraphStore.getDefinitions).mockResolvedValueOnce(definitions as never);
      vi.mocked(taskGraphStore.getEdges).mockResolvedValueOnce([]);
      vi.mocked(taskRunStore.getRunsByGraph).mockResolvedValueOnce([]);
      vi.mocked(taskGraphStore.getReadyDefinitions).mockReturnValueOnce(definitions as never);

      const res = await app.inject({
        method: 'GET',
        url: `/api/task-graphs/${GRAPH_ID}/ready`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(1);
    });

    it('passes a set of completed definition IDs to getReadyDefinitions', async () => {
      const graph = makeGraph();
      const definitions = [makeDefinition()];
      const completedRun = makeRun({ definitionId: DEF_ID_A, status: 'completed' });
      const pendingRun = makeRun({ id: 'run-002', definitionId: DEF_ID_B, status: 'pending' });

      vi.mocked(taskGraphStore.getGraph).mockResolvedValueOnce(graph as never);
      vi.mocked(taskGraphStore.getDefinitions).mockResolvedValueOnce(definitions as never);
      vi.mocked(taskGraphStore.getEdges).mockResolvedValueOnce([]);
      vi.mocked(taskRunStore.getRunsByGraph).mockResolvedValueOnce([
        completedRun,
        pendingRun,
      ] as never);
      vi.mocked(taskGraphStore.getReadyDefinitions).mockReturnValueOnce([]);

      await app.inject({
        method: 'GET',
        url: `/api/task-graphs/${GRAPH_ID}/ready`,
      });

      // Only the completed run's definitionId should be in the completed set
      const completedSetArg = vi.mocked(taskGraphStore.getReadyDefinitions).mock.calls[0][2];
      expect(completedSetArg.has(DEF_ID_A)).toBe(true);
      expect(completedSetArg.has(DEF_ID_B)).toBe(false);
    });

    it('returns 404 when graph does not exist', async () => {
      vi.mocked(taskGraphStore.getGraph).mockResolvedValueOnce(undefined);

      const res = await app.inject({
        method: 'GET',
        url: '/api/task-graphs/nonexistent/ready',
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('GRAPH_NOT_FOUND');
    });
  });
});
