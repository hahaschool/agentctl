import {
  ControlPlaneError,
  isTaskEdgeType,
  isTaskNodeType,
  TASK_EDGE_TYPES,
  TASK_NODE_TYPES,
} from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { TaskGraphStore } from '../../collaboration/task-graph-store.js';
import type { TaskRunStore } from '../../collaboration/task-run-store.js';

export type TaskGraphRoutesOptions = {
  taskGraphStore: TaskGraphStore;
  taskRunStore: TaskRunStore;
};

export const taskGraphRoutes: FastifyPluginAsync<TaskGraphRoutesOptions> = async (app, opts) => {
  const { taskGraphStore, taskRunStore } = opts;

  // ── List Graphs ────────────────────────────────────────────

  app.get('/', { schema: { tags: ['task-graph'], summary: 'List all task graphs' } }, async () => {
    return await taskGraphStore.listGraphs();
  });

  // ── Create Graph ───────────────────────────────────────────

  app.post<{ Body: { name: string } }>(
    '/',
    { schema: { tags: ['task-graph'], summary: 'Create a task graph' } },
    async (request, reply) => {
      const { name } = request.body;

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return reply.code(400).send({
          error: 'INVALID_NAME',
          message: 'A non-empty "name" string is required',
        });
      }

      const graph = await taskGraphStore.createGraph({ name: name.trim() });
      return reply.code(201).send(graph);
    },
  );

  // ── Get Graph (with definitions + edges) ───────────────────

  app.get<{ Params: { id: string } }>(
    '/:id',
    { schema: { tags: ['task-graph'], summary: 'Get task graph with definitions and edges' } },
    async (request, reply) => {
      const graph = await taskGraphStore.getGraph(request.params.id);
      if (!graph) {
        return reply.code(404).send({
          error: 'GRAPH_NOT_FOUND',
          message: 'Task graph not found',
        });
      }

      const definitions = await taskGraphStore.getDefinitions(graph.id);
      const edges = await taskGraphStore.getEdges(graph.id);

      return { ...graph, definitions, edges };
    },
  );

  // ── Delete Graph ───────────────────────────────────────────

  app.delete<{ Params: { id: string } }>(
    '/:id',
    { schema: { tags: ['task-graph'], summary: 'Delete a task graph' } },
    async (request, reply) => {
      try {
        await taskGraphStore.deleteGraph(request.params.id);
        return { ok: true };
      } catch (err) {
        if (err instanceof ControlPlaneError && err.code === 'GRAPH_NOT_FOUND') {
          return reply.code(404).send({
            error: 'GRAPH_NOT_FOUND',
            message: 'Task graph not found',
          });
        }
        throw err;
      }
    },
  );

  // ── Add Definition ─────────────────────────────────────────

  app.post<{
    Params: { id: string };
    Body: {
      type: string;
      name: string;
      description?: string;
      requiredCapabilities?: string[];
      estimatedTokens?: number;
      timeoutMs?: number;
      maxRetryAttempts?: number;
      retryBackoffMs?: number;
    };
  }>(
    '/:id/definitions',
    { schema: { tags: ['task-graph'], summary: 'Add task definition to graph' } },
    async (request, reply) => {
      const graph = await taskGraphStore.getGraph(request.params.id);
      if (!graph) {
        return reply.code(404).send({
          error: 'GRAPH_NOT_FOUND',
          message: 'Task graph not found',
        });
      }

      const { type, name } = request.body;

      if (!type || !isTaskNodeType(type)) {
        return reply.code(400).send({
          error: 'INVALID_TYPE',
          message: `type must be one of: ${TASK_NODE_TYPES.join(', ')}`,
        });
      }

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return reply.code(400).send({
          error: 'INVALID_NAME',
          message: 'A non-empty "name" string is required',
        });
      }

      const definition = await taskGraphStore.addDefinition({
        graphId: request.params.id,
        type,
        name: name.trim(),
        description: request.body.description,
        requiredCapabilities: request.body.requiredCapabilities,
        estimatedTokens: request.body.estimatedTokens,
        timeoutMs: request.body.timeoutMs,
        maxRetryAttempts: request.body.maxRetryAttempts,
        retryBackoffMs: request.body.retryBackoffMs,
      });

      return reply.code(201).send(definition);
    },
  );

  // ── Add Edge ───────────────────────────────────────────────

  app.post<{
    Params: { id: string };
    Body: {
      fromDefinition: string;
      toDefinition: string;
      type: string;
    };
  }>(
    '/:id/edges',
    { schema: { tags: ['task-graph'], summary: 'Add edge to task graph (validates DAG)' } },
    async (request, reply) => {
      const graph = await taskGraphStore.getGraph(request.params.id);
      if (!graph) {
        return reply.code(404).send({
          error: 'GRAPH_NOT_FOUND',
          message: 'Task graph not found',
        });
      }

      const { fromDefinition, toDefinition, type } = request.body;

      if (!fromDefinition || !toDefinition) {
        return reply.code(400).send({
          error: 'INVALID_EDGE',
          message: 'Both "fromDefinition" and "toDefinition" are required',
        });
      }

      if (!type || !isTaskEdgeType(type)) {
        return reply.code(400).send({
          error: 'INVALID_EDGE_TYPE',
          message: `type must be one of: ${TASK_EDGE_TYPES.join(', ')}`,
        });
      }

      // Add the edge
      const edge = await taskGraphStore.addEdge({ fromDefinition, toDefinition, type });

      // Validate DAG after adding
      const validation = await taskGraphStore.validateGraph(request.params.id);
      if (!validation.valid) {
        // Rollback the edge
        try {
          await taskGraphStore.removeEdge(fromDefinition, toDefinition);
        } catch {
          // Best-effort rollback
        }
        return reply.code(400).send({
          error: 'INVALID_DAG',
          message: 'Adding this edge would create an invalid DAG',
          details: validation.errors,
        });
      }

      return reply.code(201).send(edge);
    },
  );

  // ── Validate Graph ─────────────────────────────────────────

  app.post<{ Params: { id: string } }>(
    '/:id/validate',
    { schema: { tags: ['task-graph'], summary: 'Validate task graph DAG' } },
    async (request, reply) => {
      const graph = await taskGraphStore.getGraph(request.params.id);
      if (!graph) {
        return reply.code(404).send({
          error: 'GRAPH_NOT_FOUND',
          message: 'Task graph not found',
        });
      }

      const result = await taskGraphStore.validateGraph(request.params.id);
      return result;
    },
  );

  // ── Get Ready Tasks ────────────────────────────────────────

  app.get<{ Params: { id: string } }>(
    '/:id/ready',
    { schema: { tags: ['task-graph'], summary: 'Get task definitions ready to execute' } },
    async (request, reply) => {
      const graph = await taskGraphStore.getGraph(request.params.id);
      if (!graph) {
        return reply.code(404).send({
          error: 'GRAPH_NOT_FOUND',
          message: 'Task graph not found',
        });
      }

      const definitions = await taskGraphStore.getDefinitions(graph.id);
      const edges = await taskGraphStore.getEdges(graph.id);
      const runs = await taskRunStore.getRunsByGraph(graph.id);

      // Build set of completed definition IDs
      const completedDefIds = new Set(
        runs.filter((r) => r.status === 'completed').map((r) => r.definitionId),
      );

      const ready = taskGraphStore.getReadyDefinitions(definitions, edges, completedDefIds);
      return ready;
    },
  );
};
