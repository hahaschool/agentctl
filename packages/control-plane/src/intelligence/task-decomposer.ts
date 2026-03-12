// ── LLM-based task auto-decomposition service (§10.5 Phase 5b) ──

import type {
  DecomposedEdge,
  DecomposedTask,
  DecompositionConstraints,
  DecompositionRequest,
  DecompositionResponse,
  DecompositionResult,
} from '@agentctl/shared';
import { ControlPlaneError } from '@agentctl/shared';
import type { Logger } from 'pino';

import type { AgentProfileStore } from '../collaboration/agent-profile-store.js';
import type { TaskGraphStore } from '../collaboration/task-graph-store.js';
import type { WorkerNodeStore } from '../collaboration/worker-node-store.js';
import type { LiteLLMClient } from '../router/litellm-client.js';
import { buildUserPrompt, DECOMPOSE_SYSTEM_PROMPT } from './prompts/decompose-task.js';

const DEFAULT_MAX_SUB_TASKS = 10;
const DEFAULT_MAX_DEPTH_LEVELS = 4;
const DEFAULT_MODEL_ID = 'claude-sonnet-4-20250514';

export type TaskDecomposerOptions = {
  readonly litellmClient: LiteLLMClient;
  readonly agentProfileStore: AgentProfileStore;
  readonly workerNodeStore: WorkerNodeStore;
  readonly taskGraphStore: TaskGraphStore;
  readonly logger: Logger;
  readonly modelId?: string;
};

export class TaskDecomposer {
  private readonly litellmClient: LiteLLMClient;
  private readonly agentProfileStore: AgentProfileStore;
  private readonly workerNodeStore: WorkerNodeStore;
  private readonly taskGraphStore: TaskGraphStore;
  private readonly logger: Logger;
  private readonly modelId: string;

  constructor(options: TaskDecomposerOptions) {
    this.litellmClient = options.litellmClient;
    this.agentProfileStore = options.agentProfileStore;
    this.workerNodeStore = options.workerNodeStore;
    this.taskGraphStore = options.taskGraphStore;
    this.logger = options.logger;
    this.modelId = options.modelId ?? process.env.DECOMPOSE_MODEL_ID ?? DEFAULT_MODEL_ID;
  }

  /**
   * Decompose a natural-language task description into a TaskGraph.
   * Calls the LLM, validates the result, persists the graph, and returns the response.
   */
  async decompose(request: DecompositionRequest): Promise<DecompositionResponse> {
    this.logger.info(
      { description: request.description.slice(0, 100) },
      'Starting task decomposition',
    );

    const result = await this.callLlm(request);
    const availableCapabilities = await this.getAvailableCapabilities();
    const validationErrors = this.validateDecomposition(
      result,
      availableCapabilities,
      request.constraints,
    );

    // Persist the graph even if there are non-critical validation warnings
    const { graphId, definitionIdMap } = await this.persistGraph(result, request.description);

    this.logger.info(
      {
        graphId,
        taskCount: result.tasks.length,
        edgeCount: result.edges.length,
        validationErrorCount: validationErrors.length,
      },
      'Task decomposition completed',
    );

    return {
      graphId,
      definitionIdMap,
      result,
      validationErrors,
    };
  }

  /**
   * Preview a decomposition without persisting. Useful for dry-run UIs.
   */
  async preview(
    request: DecompositionRequest,
  ): Promise<{ result: DecompositionResult; validationErrors: readonly string[] }> {
    this.logger.info(
      { description: request.description.slice(0, 100) },
      'Previewing task decomposition',
    );

    const result = await this.callLlm(request);
    const availableCapabilities = await this.getAvailableCapabilities();
    const validationErrors = this.validateDecomposition(
      result,
      availableCapabilities,
      request.constraints,
    );

    return { result, validationErrors };
  }

  // ── Private: LLM call ─────────────────────────────────────────

  private async callLlm(request: DecompositionRequest): Promise<DecompositionResult> {
    const [profiles, nodes] = await Promise.all([
      this.agentProfileStore.listProfiles(),
      this.workerNodeStore.listNodes(),
    ]);

    const profileSummaries = profiles.map(
      (p) =>
        `${p.name} (${p.runtimeType}): capabilities=[${p.capabilities.join(', ')}], model=${p.modelId}`,
    );

    const allNodeCapabilities = [...new Set(nodes.flatMap((n) => n.capabilities))];

    const constraints = request.constraints;
    const userPrompt = buildUserPrompt({
      description: request.description,
      profileSummaries,
      nodeCapabilities: allNodeCapabilities,
      maxSubTasks: constraints?.maxSubTasks ?? DEFAULT_MAX_SUB_TASKS,
      maxDepthLevels: constraints?.maxDepthLevels ?? DEFAULT_MAX_DEPTH_LEVELS,
      budgetTokens: constraints?.budgetTokens,
      requiredCapabilities: constraints?.requiredCapabilities
        ? [...constraints.requiredCapabilities]
        : undefined,
      excludeCapabilities: constraints?.excludeCapabilities
        ? [...constraints.excludeCapabilities]
        : undefined,
    });

    const response = await this.litellmClient.chatCompletion({
      model: this.modelId,
      messages: [
        { role: 'system', content: DECOMPOSE_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new ControlPlaneError(
        'DECOMPOSE_EMPTY_RESPONSE',
        'LLM returned an empty response for task decomposition',
        { model: this.modelId },
      );
    }

    return this.parseResult(content);
  }

  // ── Private: Parse LLM output ──────────────────────────────────

  private parseResult(raw: string): DecompositionResult {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ControlPlaneError('DECOMPOSE_INVALID_JSON', 'LLM response is not valid JSON', {
        responsePreview: raw.slice(0, 300),
      });
    }

    if (typeof parsed !== 'object' || parsed === null) {
      throw new ControlPlaneError('DECOMPOSE_INVALID_SCHEMA', 'LLM response is not a JSON object', {
        responsePreview: raw.slice(0, 300),
      });
    }

    const obj = parsed as Record<string, unknown>;

    if (!Array.isArray(obj.tasks)) {
      throw new ControlPlaneError(
        'DECOMPOSE_INVALID_SCHEMA',
        'LLM response missing "tasks" array',
        { keys: Object.keys(obj) },
      );
    }

    if (!Array.isArray(obj.edges)) {
      throw new ControlPlaneError(
        'DECOMPOSE_INVALID_SCHEMA',
        'LLM response missing "edges" array',
        { keys: Object.keys(obj) },
      );
    }

    const tasks = (obj.tasks as unknown[]).map((t) => this.parseTask(t));
    const edges = (obj.edges as unknown[]).map((e) => this.parseEdge(e));

    return {
      tasks,
      edges,
      suggestedApprovalGates: Array.isArray(obj.suggestedApprovalGates)
        ? (obj.suggestedApprovalGates as string[]).filter((g) => typeof g === 'string')
        : [],
      reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : '',
      estimatedTotalTokens:
        typeof obj.estimatedTotalTokens === 'number' ? obj.estimatedTotalTokens : 0,
      estimatedTotalCostUsd:
        typeof obj.estimatedTotalCostUsd === 'number' ? obj.estimatedTotalCostUsd : null,
    };
  }

  private parseTask(raw: unknown): DecomposedTask {
    if (typeof raw !== 'object' || raw === null) {
      throw new ControlPlaneError('DECOMPOSE_INVALID_SCHEMA', 'Task entry is not an object', {});
    }

    const t = raw as Record<string, unknown>;

    return {
      tempId: typeof t.tempId === 'string' ? t.tempId : String(t.tempId ?? ''),
      type: t.type === 'gate' ? 'gate' : 'task',
      name: typeof t.name === 'string' ? t.name : '',
      description: typeof t.description === 'string' ? t.description : '',
      requiredCapabilities: Array.isArray(t.requiredCapabilities)
        ? (t.requiredCapabilities as unknown[]).filter((c): c is string => typeof c === 'string')
        : [],
      estimatedTokens: typeof t.estimatedTokens === 'number' ? t.estimatedTokens : 0,
      timeoutMs: typeof t.timeoutMs === 'number' ? t.timeoutMs : 3_600_000,
    };
  }

  private parseEdge(raw: unknown): DecomposedEdge {
    if (typeof raw !== 'object' || raw === null) {
      throw new ControlPlaneError('DECOMPOSE_INVALID_SCHEMA', 'Edge entry is not an object', {});
    }

    const e = raw as Record<string, unknown>;

    return {
      from: typeof e.from === 'string' ? e.from : '',
      to: typeof e.to === 'string' ? e.to : '',
      type: e.type === 'context' ? 'context' : 'blocks',
    };
  }

  // ── Private: Validation ────────────────────────────────────────

  private validateDecomposition(
    result: DecompositionResult,
    availableCapabilities: ReadonlySet<string>,
    constraints?: DecompositionConstraints,
  ): string[] {
    const errors: string[] = [];

    // Check empty tasks
    if (result.tasks.length === 0) {
      errors.push('Decomposition produced zero tasks');
    }

    // Check max sub-tasks
    const maxTasks = constraints?.maxSubTasks ?? DEFAULT_MAX_SUB_TASKS;
    if (result.tasks.length > maxTasks) {
      errors.push(`Too many sub-tasks: ${result.tasks.length} exceeds limit of ${maxTasks}`);
    }

    // Check duplicate tempIds
    const tempIds = new Set<string>();
    for (const task of result.tasks) {
      if (tempIds.has(task.tempId)) {
        errors.push(`Duplicate tempId: "${task.tempId}"`);
      }
      tempIds.add(task.tempId);
    }

    // Check tasks have names
    for (const task of result.tasks) {
      if (!task.name.trim()) {
        errors.push(`Task "${task.tempId}" has an empty name`);
      }
    }

    // Check edge references
    for (const edge of result.edges) {
      if (!tempIds.has(edge.from)) {
        errors.push(`Edge references unknown "from" tempId: "${edge.from}"`);
      }
      if (!tempIds.has(edge.to)) {
        errors.push(`Edge references unknown "to" tempId: "${edge.to}"`);
      }
    }

    // Check for cycles (simple DFS)
    const cycleError = this.detectCycle(result.tasks, result.edges);
    if (cycleError) {
      errors.push(cycleError);
    }

    // Check capabilities against available profiles
    if (availableCapabilities.size > 0) {
      for (const task of result.tasks) {
        for (const cap of task.requiredCapabilities) {
          if (!availableCapabilities.has(cap)) {
            errors.push(`Task "${task.tempId}" requires unknown capability: "${cap}"`);
          }
        }
      }
    }

    // Check DAG depth
    const maxDepth = constraints?.maxDepthLevels ?? DEFAULT_MAX_DEPTH_LEVELS;
    const depth = this.computeMaxDepth(result.tasks, result.edges);
    if (depth > maxDepth) {
      errors.push(`DAG depth ${depth} exceeds limit of ${maxDepth}`);
    }

    // Check suggested approval gates reference valid tasks
    for (const gateId of result.suggestedApprovalGates) {
      if (!tempIds.has(gateId)) {
        errors.push(`Suggested approval gate references unknown tempId: "${gateId}"`);
      }
    }

    return errors;
  }

  private detectCycle(
    tasks: readonly DecomposedTask[],
    edges: readonly DecomposedEdge[],
  ): string | null {
    const adjacency = new Map<string, string[]>();
    for (const task of tasks) {
      adjacency.set(task.tempId, []);
    }
    for (const edge of edges) {
      const neighbors = adjacency.get(edge.from);
      if (neighbors) {
        neighbors.push(edge.to);
      }
    }

    const visited = new Set<string>();
    const inStack = new Set<string>();

    const dfs = (node: string): boolean => {
      visited.add(node);
      inStack.add(node);

      for (const neighbor of adjacency.get(node) ?? []) {
        if (inStack.has(neighbor)) {
          return true;
        }
        if (!visited.has(neighbor) && dfs(neighbor)) {
          return true;
        }
      }

      inStack.delete(node);
      return false;
    };

    for (const task of tasks) {
      if (!visited.has(task.tempId) && dfs(task.tempId)) {
        return 'Decomposition contains a cycle in the dependency graph';
      }
    }

    return null;
  }

  private computeMaxDepth(
    tasks: readonly DecomposedTask[],
    edges: readonly DecomposedEdge[],
  ): number {
    if (tasks.length === 0) {
      return 0;
    }

    // Build adjacency and in-degree for topological sort
    const adjacency = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    for (const task of tasks) {
      adjacency.set(task.tempId, []);
      inDegree.set(task.tempId, 0);
    }

    // Only count blocking edges for depth
    const blockingEdges = edges.filter((e) => e.type === 'blocks');
    for (const edge of blockingEdges) {
      const neighbors = adjacency.get(edge.from);
      if (neighbors) {
        neighbors.push(edge.to);
      }
      inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    }

    // BFS-based level computation
    const depth = new Map<string, number>();
    const queue: string[] = [];

    for (const task of tasks) {
      if ((inDegree.get(task.tempId) ?? 0) === 0) {
        queue.push(task.tempId);
        depth.set(task.tempId, 1);
      }
    }

    let maxDepth = queue.length > 0 ? 1 : 0;

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      const currentDepth = depth.get(current) ?? 1;

      for (const neighbor of adjacency.get(current) ?? []) {
        const newDepth = currentDepth + 1;
        const existingDepth = depth.get(neighbor) ?? 0;

        if (newDepth > existingDepth) {
          depth.set(neighbor, newDepth);
          if (newDepth > maxDepth) {
            maxDepth = newDepth;
          }
        }

        const deg = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, deg);
        if (deg === 0) {
          queue.push(neighbor);
        }
      }
    }

    return maxDepth;
  }

  // ── Private: Helpers ───────────────────────────────────────────

  private async getAvailableCapabilities(): Promise<ReadonlySet<string>> {
    const profiles = await this.agentProfileStore.listProfiles();
    const capabilities = new Set<string>();
    for (const profile of profiles) {
      for (const cap of profile.capabilities) {
        capabilities.add(cap);
      }
    }
    return capabilities;
  }

  // ── Private: Persistence ───────────────────────────────────────

  private async persistGraph(
    result: DecompositionResult,
    description: string,
  ): Promise<{ graphId: string; definitionIdMap: Record<string, string> }> {
    const graphName = `auto-decompose: ${description.slice(0, 80)}`;
    const graph = await this.taskGraphStore.createGraph({ name: graphName });

    const definitionIdMap: Record<string, string> = {};

    // Create all task definitions
    for (const task of result.tasks) {
      const definition = await this.taskGraphStore.addDefinition({
        graphId: graph.id,
        type: task.type,
        name: task.name,
        description: task.description,
        requiredCapabilities: [...task.requiredCapabilities],
        estimatedTokens: task.estimatedTokens,
        timeoutMs: task.timeoutMs,
      });

      definitionIdMap[task.tempId] = definition.id;
    }

    // Create all edges (mapping tempIds to real IDs)
    for (const edge of result.edges) {
      const fromId = definitionIdMap[edge.from];
      const toId = definitionIdMap[edge.to];

      if (fromId && toId) {
        await this.taskGraphStore.addEdge({
          fromDefinition: fromId,
          toDefinition: toId,
          type: edge.type,
        });
      }
    }

    return { graphId: graph.id, definitionIdMap };
  }
}
