import type { TaskDefinition, TaskEdge, TaskGraph } from '@agentctl/shared';
import { ControlPlaneError, validateTaskGraph } from '@agentctl/shared';
import { and, eq } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';
import { taskDefinitions, taskEdges, taskGraphs } from '../db/index.js';

type CreateGraphInput = {
  name: string;
};

type AddDefinitionInput = {
  graphId: string;
  type: string;
  name: string;
  description?: string;
  requiredCapabilities?: string[];
  estimatedTokens?: number | null;
  timeoutMs?: number;
  maxRetryAttempts?: number;
  retryBackoffMs?: number;
};

type AddEdgeInput = {
  fromDefinition: string;
  toDefinition: string;
  type: string;
};

export class TaskGraphStore {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  // ── Graph CRUD ───────────────────────────────────────────────

  async createGraph(input: CreateGraphInput): Promise<TaskGraph> {
    const rows = await this.db.insert(taskGraphs).values({ name: input.name }).returning();

    if (rows.length === 0) {
      throw new ControlPlaneError('GRAPH_CREATE_FAILED', 'Failed to insert task graph', { input });
    }

    this.logger.info({ graphId: rows[0].id, name: input.name }, 'Task graph created');
    return this.toGraph(rows[0]);
  }

  async getGraph(id: string): Promise<TaskGraph | undefined> {
    const rows = await this.db.select().from(taskGraphs).where(eq(taskGraphs.id, id));
    return rows.length === 0 ? undefined : this.toGraph(rows[0]);
  }

  async listGraphs(): Promise<TaskGraph[]> {
    const rows = await this.db.select().from(taskGraphs);
    return rows.map((r) => this.toGraph(r));
  }

  async deleteGraph(id: string): Promise<void> {
    const result = await this.db
      .delete(taskGraphs)
      .where(eq(taskGraphs.id, id))
      .returning({ id: taskGraphs.id });

    if (result.length === 0) {
      throw new ControlPlaneError('GRAPH_NOT_FOUND', `Task graph '${id}' does not exist`, { id });
    }

    this.logger.info({ graphId: id }, 'Task graph deleted');
  }

  // ── Definitions ──────────────────────────────────────────────

  async addDefinition(input: AddDefinitionInput): Promise<TaskDefinition> {
    const rows = await this.db
      .insert(taskDefinitions)
      .values({
        graphId: input.graphId,
        type: input.type,
        name: input.name,
        description: input.description ?? '',
        requiredCapabilities: input.requiredCapabilities ?? [],
        estimatedTokens: input.estimatedTokens ?? null,
        timeoutMs: input.timeoutMs ?? 3600000,
        maxRetryAttempts: input.maxRetryAttempts ?? 1,
        retryBackoffMs: input.retryBackoffMs ?? 5000,
      })
      .returning();

    if (rows.length === 0) {
      throw new ControlPlaneError('DEFINITION_CREATE_FAILED', 'Failed to insert task definition', {
        input,
      });
    }

    this.logger.info(
      { definitionId: rows[0].id, graphId: input.graphId, name: input.name },
      'Task definition added',
    );
    return this.toDefinition(rows[0]);
  }

  async getDefinitions(graphId: string): Promise<TaskDefinition[]> {
    const rows = await this.db
      .select()
      .from(taskDefinitions)
      .where(eq(taskDefinitions.graphId, graphId));
    return rows.map((r) => this.toDefinition(r));
  }

  async getDefinition(id: string): Promise<TaskDefinition | undefined> {
    const rows = await this.db.select().from(taskDefinitions).where(eq(taskDefinitions.id, id));
    return rows.length === 0 ? undefined : this.toDefinition(rows[0]);
  }

  // ── Edges ────────────────────────────────────────────────────

  async addEdge(input: AddEdgeInput): Promise<TaskEdge> {
    const rows = await this.db
      .insert(taskEdges)
      .values({
        fromDefinition: input.fromDefinition,
        toDefinition: input.toDefinition,
        type: input.type,
      })
      .returning();

    if (rows.length === 0) {
      throw new ControlPlaneError('EDGE_CREATE_FAILED', 'Failed to insert task edge', { input });
    }

    this.logger.info(
      { from: input.fromDefinition, to: input.toDefinition, type: input.type },
      'Task edge added',
    );
    return this.toEdge(rows[0]);
  }

  async getEdges(graphId: string): Promise<TaskEdge[]> {
    // Join through definitions to get edges for a specific graph
    const defs = await this.getDefinitions(graphId);
    const defIds = new Set(defs.map((d) => d.id));

    if (defIds.size === 0) {
      return [];
    }

    const allEdges = await this.db.select().from(taskEdges);
    return allEdges
      .filter((e) => defIds.has(e.fromDefinition) || defIds.has(e.toDefinition))
      .map((e) => this.toEdge(e));
  }

  async removeEdge(fromDefinition: string, toDefinition: string): Promise<void> {
    const result = await this.db
      .delete(taskEdges)
      .where(
        and(eq(taskEdges.fromDefinition, fromDefinition), eq(taskEdges.toDefinition, toDefinition)),
      )
      .returning();

    if (result.length === 0) {
      throw new ControlPlaneError('EDGE_NOT_FOUND', 'Task edge does not exist', {
        fromDefinition,
        toDefinition,
      });
    }

    this.logger.info({ from: fromDefinition, to: toDefinition }, 'Task edge removed');
  }

  // ── DAG Validation ───────────────────────────────────────────

  async validateGraph(graphId: string) {
    const defs = await this.getDefinitions(graphId);
    const edges = await this.getEdges(graphId);
    const nodeIds = defs.map((d) => d.id);
    return validateTaskGraph(nodeIds, edges);
  }

  // ── Ready Tasks ──────────────────────────────────────────────

  /**
   * Get task definitions in a graph whose blocking dependencies are all
   * completed (i.e., ready to execute). Requires taskRuns to be checked
   * externally -- this returns definitions that have no unresolved blocking
   * predecessor in the edge set, given a set of completed definition IDs.
   */
  getReadyDefinitions(
    definitions: ReadonlyArray<TaskDefinition>,
    edges: ReadonlyArray<TaskEdge>,
    completedDefinitionIds: ReadonlySet<string>,
  ): TaskDefinition[] {
    const blockingEdges = edges.filter((e) => e.type === 'blocks');

    return definitions.filter((def) => {
      if (completedDefinitionIds.has(def.id)) {
        return false; // already completed
      }

      const blockers = blockingEdges.filter((e) => e.toDefinition === def.id);
      return blockers.every((b) => completedDefinitionIds.has(b.fromDefinition));
    });
  }

  // ── Row Mappers ──────────────────────────────────────────────

  private toGraph(row: typeof taskGraphs.$inferSelect): TaskGraph {
    return {
      id: row.id,
      name: row.name ?? '',
      createdAt: (row.createdAt ?? new Date()).toISOString(),
    };
  }

  private toDefinition(row: typeof taskDefinitions.$inferSelect): TaskDefinition {
    return {
      id: row.id,
      graphId: row.graphId,
      type: row.type as TaskDefinition['type'],
      name: row.name,
      description: row.description ?? '',
      requiredCapabilities: (row.requiredCapabilities ?? []) as string[],
      estimatedTokens: row.estimatedTokens ?? null,
      timeoutMs: row.timeoutMs ?? 3600000,
      maxRetryAttempts: row.maxRetryAttempts ?? 1,
      retryBackoffMs: row.retryBackoffMs ?? 5000,
      createdAt: (row.createdAt ?? new Date()).toISOString(),
    };
  }

  private toEdge(row: typeof taskEdges.$inferSelect): TaskEdge {
    return {
      fromDefinition: row.fromDefinition,
      toDefinition: row.toDefinition,
      type: row.type as TaskEdge['type'],
    };
  }
}
