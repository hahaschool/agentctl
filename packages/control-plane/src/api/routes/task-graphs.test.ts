import {
  ControlPlaneError,
  type TaskDefinition,
  type TaskEdge,
  type TaskGraph,
  type TaskRun,
} from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { taskGraphRoutes } from './task-graphs.js';

const GRAPH_ID = 'graph-1';
const GRAPH_ID_2 = 'graph-2';
const DEF_ID_1 = 'def-1';
const DEF_ID_2 = 'def-2';
const DEF_ID_3 = 'def-3';

function makeGraph(overrides: Partial<TaskGraph> = {}): TaskGraph {
  return {
    id: GRAPH_ID,
    name: 'Primary graph',
    createdAt: '2026-03-19T00:00:00.000Z',
    ...overrides,
  };
}

function makeDefinition(overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return {
    id: DEF_ID_1,
    graphId: GRAPH_ID,
    type: 'task',
    name: 'Definition 1',
    description: 'Do the thing',
    requiredCapabilities: ['search'],
    estimatedTokens: 200,
    timeoutMs: 60_000,
    maxRetryAttempts: 2,
    retryBackoffMs: 5_000,
    createdAt: '2026-03-19T00:00:00.000Z',
    ...overrides,
  };
}

function makeEdge(overrides: Partial<TaskEdge> = {}): TaskEdge {
  return {
    fromDefinition: DEF_ID_1,
    toDefinition: DEF_ID_2,
    type: 'blocks',
    ...overrides,
  };
}

function makeRun(overrides: Partial<TaskRun> = {}): TaskRun {
  return {
    id: 'run-1',
    definitionId: DEF_ID_1,
    spaceId: null,
    threadId: null,
    status: 'completed',
    attempt: 1,
    assigneeInstanceId: null,
    machineId: null,
    claimedAt: null,
    startedAt: null,
    completedAt: '2026-03-19T01:00:00.000Z',
    lastHeartbeatAt: null,
    result: null,
    error: null,
    createdAt: '2026-03-19T00:30:00.000Z',
    ...overrides,
  };
}

function createTaskGraphStoreMock() {
  return {
    listGraphs: vi.fn<() => Promise<TaskGraph[]>>().mockResolvedValue([]),
    createGraph: vi.fn<(input: { name: string }) => Promise<TaskGraph>>(),
    getGraph: vi.fn<(id: string) => Promise<TaskGraph | undefined>>().mockResolvedValue(undefined),
    deleteGraph: vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined),
    getDefinitions: vi.fn<(graphId: string) => Promise<TaskDefinition[]>>().mockResolvedValue([]),
    getEdges: vi.fn<(graphId: string) => Promise<TaskEdge[]>>().mockResolvedValue([]),
    addDefinition:
      vi.fn<
        (input: {
          graphId: string;
          type: string;
          name: string;
          description?: string;
          requiredCapabilities?: string[];
          estimatedTokens?: number;
          timeoutMs?: number;
          maxRetryAttempts?: number;
          retryBackoffMs?: number;
        }) => Promise<TaskDefinition>
      >(),
    addEdge:
      vi.fn<
        (input: { fromDefinition: string; toDefinition: string; type: string }) => Promise<TaskEdge>
      >(),
    validateGraph: vi
      .fn<(graphId: string) => Promise<{ valid: boolean; errors: string[] }>>()
      .mockResolvedValue({ valid: true, errors: [] }),
    removeEdge: vi
      .fn<(fromDefinition: string, toDefinition: string) => Promise<void>>()
      .mockResolvedValue(undefined),
    getReadyDefinitions: vi
      .fn<
        (
          definitions: ReadonlyArray<TaskDefinition>,
          edges: ReadonlyArray<TaskEdge>,
          completedDefinitionIds: ReadonlySet<string>,
        ) => TaskDefinition[]
      >()
      .mockReturnValue([]),
  };
}

function createTaskRunStoreMock() {
  return {
    getRunsByGraph: vi.fn<(graphId: string) => Promise<TaskRun[]>>().mockResolvedValue([]),
  };
}

describe('task-graphs routes', () => {
  let app: FastifyInstance;
  let taskGraphStore: ReturnType<typeof createTaskGraphStoreMock>;
  let taskRunStore: ReturnType<typeof createTaskRunStoreMock>;

  beforeEach(async () => {
    taskGraphStore = createTaskGraphStoreMock();
    taskRunStore = createTaskRunStoreMock();

    app = Fastify({ logger: false });
    await app.register(taskGraphRoutes, {
      prefix: '/api/task-graphs',
      taskGraphStore: taskGraphStore as never,
      taskRunStore: taskRunStore as never,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it('lists graphs', async () => {
    const graphs = [makeGraph(), makeGraph({ id: GRAPH_ID_2, name: 'Secondary graph' })];
    taskGraphStore.listGraphs.mockResolvedValueOnce(graphs);

    const response = await app.inject({
      method: 'GET',
      url: '/api/task-graphs',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(graphs);
  });

  it('creates a graph with a trimmed name', async () => {
    const created = makeGraph({ name: 'Trimmed graph' });
    taskGraphStore.createGraph.mockResolvedValueOnce(created);

    const response = await app.inject({
      method: 'POST',
      url: '/api/task-graphs',
      payload: { name: '  Trimmed graph  ' },
    });

    expect(response.statusCode).toBe(201);
    expect(taskGraphStore.createGraph).toHaveBeenCalledWith({ name: 'Trimmed graph' });
    expect(response.json()).toEqual(created);
  });

  it('returns 400 when creating a graph with an invalid name', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/task-graphs',
      payload: { name: '   ' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'INVALID_NAME',
      message: 'A non-empty "name" string is required',
    });
  });

  it('gets a graph with its definitions and edges', async () => {
    const graph = makeGraph();
    const definitions = [makeDefinition(), makeDefinition({ id: DEF_ID_2, name: 'Definition 2' })];
    const edges = [makeEdge()];
    taskGraphStore.getGraph.mockResolvedValueOnce(graph);
    taskGraphStore.getDefinitions.mockResolvedValueOnce(definitions);
    taskGraphStore.getEdges.mockResolvedValueOnce(edges);

    const response = await app.inject({
      method: 'GET',
      url: `/api/task-graphs/${graph.id}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ...graph, definitions, edges });
  });

  it('returns 404 when getting a missing graph', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/task-graphs/missing-graph',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: 'GRAPH_NOT_FOUND',
      message: 'Task graph not found',
    });
  });

  it('maps graph-not-found deletion errors to 404', async () => {
    taskGraphStore.deleteGraph.mockRejectedValueOnce(
      new ControlPlaneError('GRAPH_NOT_FOUND', "Task graph 'missing-graph' does not exist"),
    );

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/task-graphs/missing-graph',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: 'GRAPH_NOT_FOUND',
      message: 'Task graph not found',
    });
  });

  it('adds a definition after validating graph and payload data', async () => {
    const graph = makeGraph();
    const definition = makeDefinition({ name: 'Trimmed definition', id: DEF_ID_3 });
    taskGraphStore.getGraph.mockResolvedValueOnce(graph);
    taskGraphStore.addDefinition.mockResolvedValueOnce(definition);

    const response = await app.inject({
      method: 'POST',
      url: `/api/task-graphs/${graph.id}/definitions`,
      payload: {
        type: 'task',
        name: '  Trimmed definition  ',
        description: 'Definition description',
        requiredCapabilities: ['git'],
        estimatedTokens: 123,
        timeoutMs: 30_000,
        maxRetryAttempts: 3,
        retryBackoffMs: 1_000,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(taskGraphStore.addDefinition).toHaveBeenCalledWith({
      graphId: graph.id,
      type: 'task',
      name: 'Trimmed definition',
      description: 'Definition description',
      requiredCapabilities: ['git'],
      estimatedTokens: 123,
      timeoutMs: 30_000,
      maxRetryAttempts: 3,
      retryBackoffMs: 1_000,
    });
    expect(response.json()).toEqual(definition);
  });

  it('returns 400 when adding a definition with an invalid type', async () => {
    taskGraphStore.getGraph.mockResolvedValueOnce(makeGraph());

    const response = await app.inject({
      method: 'POST',
      url: `/api/task-graphs/${GRAPH_ID}/definitions`,
      payload: {
        type: 'invalid-type',
        name: 'Definition',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'INVALID_TYPE',
      message: 'type must be one of: task, gate, fork, join',
    });
  });

  it('rolls back an edge when DAG validation fails', async () => {
    const graph = makeGraph();
    const edge = makeEdge();
    taskGraphStore.getGraph.mockResolvedValueOnce(graph);
    taskGraphStore.addEdge.mockResolvedValueOnce(edge);
    taskGraphStore.validateGraph.mockResolvedValueOnce({
      valid: false,
      errors: ['Cycle detected between def-1 and def-2'],
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/task-graphs/${graph.id}/edges`,
      payload: {
        fromDefinition: edge.fromDefinition,
        toDefinition: edge.toDefinition,
        type: edge.type,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(taskGraphStore.addEdge).toHaveBeenCalledWith({
      fromDefinition: edge.fromDefinition,
      toDefinition: edge.toDefinition,
      type: edge.type,
    });
    expect(taskGraphStore.removeEdge).toHaveBeenCalledWith(edge.fromDefinition, edge.toDefinition);
    expect(response.json()).toEqual({
      error: 'INVALID_DAG',
      message: 'Adding this edge would create an invalid DAG',
      details: ['Cycle detected between def-1 and def-2'],
    });
  });

  it('returns 400 when adding an edge with an invalid type', async () => {
    taskGraphStore.getGraph.mockResolvedValueOnce(makeGraph());

    const response = await app.inject({
      method: 'POST',
      url: `/api/task-graphs/${GRAPH_ID}/edges`,
      payload: {
        fromDefinition: DEF_ID_1,
        toDefinition: DEF_ID_2,
        type: 'invalid-edge',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'INVALID_EDGE_TYPE',
      message: 'type must be one of: blocks, context',
    });
  });

  it('returns validation results for an existing graph', async () => {
    const graph = makeGraph();
    const validation = { valid: true, errors: [] };
    taskGraphStore.getGraph.mockResolvedValueOnce(graph);
    taskGraphStore.validateGraph.mockResolvedValueOnce(validation);

    const response = await app.inject({
      method: 'POST',
      url: `/api/task-graphs/${graph.id}/validate`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(validation);
  });

  it('returns ready definitions based on completed runs', async () => {
    const graph = makeGraph();
    const definitions = [
      makeDefinition({ id: DEF_ID_1, name: 'Done definition' }),
      makeDefinition({ id: DEF_ID_2, name: 'Ready definition' }),
    ];
    const edges = [makeEdge({ fromDefinition: DEF_ID_1, toDefinition: DEF_ID_2 })];
    const readyDefinitions = [definitions[1]];
    taskGraphStore.getGraph.mockResolvedValueOnce(graph);
    taskGraphStore.getDefinitions.mockResolvedValueOnce(definitions);
    taskGraphStore.getEdges.mockResolvedValueOnce(edges);
    taskRunStore.getRunsByGraph.mockResolvedValueOnce([
      makeRun({ definitionId: DEF_ID_1, status: 'completed' }),
      makeRun({ id: 'run-2', definitionId: DEF_ID_2, status: 'running' }),
    ]);
    taskGraphStore.getReadyDefinitions.mockReturnValueOnce(readyDefinitions);

    const response = await app.inject({
      method: 'GET',
      url: `/api/task-graphs/${graph.id}/ready`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(readyDefinitions);
    expect(taskGraphStore.getReadyDefinitions).toHaveBeenCalledTimes(1);

    const readyCall = taskGraphStore.getReadyDefinitions.mock.calls[0];
    expect(readyCall).toBeDefined();
    if (!readyCall) {
      throw new Error('Expected getReadyDefinitions to be called once');
    }

    const [calledDefinitions, calledEdges, completedDefinitionIds] = readyCall;
    expect(calledDefinitions).toEqual(definitions);
    expect(calledEdges).toEqual(edges);
    expect([...completedDefinitionIds]).toEqual([DEF_ID_1]);
  });
});
