import type {
  AgentProfile,
  AggregateStats,
  RoutingCandidate,
  RoutingDecision,
  RoutingOutcome,
} from '@agentctl/shared';
import { isRoutingOutcomeStatus } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { AgentProfileStore } from '../../collaboration/agent-profile-store.js';
import type { RoutingStore } from '../../collaboration/routing-store.js';
import type { TaskRunStore } from '../../collaboration/task-run-store.js';
import type { WorkerNodeStore } from '../../collaboration/worker-node-store.js';
import type { RoutingEngine, StatsMap } from '../../intelligence/routing-engine.js';

export type RoutingRoutesOptions = {
  routingEngine: RoutingEngine;
  routingStore: RoutingStore;
  agentProfileStore: AgentProfileStore;
  workerNodeStore: WorkerNodeStore;
  taskRunStore: TaskRunStore;
};

export const routingRoutes: FastifyPluginAsync<RoutingRoutesOptions> = async (app, opts) => {
  const { routingEngine, routingStore, agentProfileStore, workerNodeStore, taskRunStore } = opts;

  // ── POST /rank ────────────────────────────────────────────
  app.post<{
    Body: {
      taskDefinitionId: string;
      requiredCapabilities: string[];
      machineRequirements?: string[];
      estimatedTokens?: number | null;
      limit?: number;
    };
  }>(
    '/rank',
    { schema: { tags: ['routing'], summary: 'Rank agent candidates for a task' } },
    async (request, reply): Promise<RoutingCandidate[]> => {
      const {
        taskDefinitionId,
        requiredCapabilities,
        machineRequirements,
        estimatedTokens,
        limit,
      } = request.body;

      if (
        !taskDefinitionId ||
        !Array.isArray(requiredCapabilities) ||
        requiredCapabilities.length === 0
      ) {
        return reply.code(400).send({
          error: 'INVALID_REQUEST',
          message: 'taskDefinitionId and non-empty requiredCapabilities are required',
        });
      }

      const profiles = await agentProfileStore.listProfiles();
      const nodes = await workerNodeStore.listNodes();

      // Gather instances across all profiles
      const instanceArrays = await Promise.all(
        profiles.map((p) => agentProfileStore.listInstancesByProfile(p.id)),
      );
      const instances = instanceArrays.flat();

      // Build stats map
      const statsMap = await buildStatsMap(routingStore, profiles, requiredCapabilities);

      const candidates = routingEngine.rankCandidates(
        {
          taskDefinitionId,
          requiredCapabilities,
          machineRequirements,
          estimatedTokens: estimatedTokens ?? null,
          limit,
        },
        profiles,
        nodes,
        instances,
        statsMap,
      );

      return candidates;
    },
  );

  // ── POST /assign ──────────────────────────────────────────
  app.post<{
    Body: {
      taskRunId: string;
      taskDefinitionId: string;
      profileId: string;
      nodeId: string;
      score: number;
      breakdown: Record<string, number>;
      mode?: 'auto' | 'suggested';
    };
  }>(
    '/assign',
    { schema: { tags: ['routing'], summary: 'Record a routing assignment decision' } },
    async (request, reply): Promise<RoutingDecision> => {
      const { taskRunId, taskDefinitionId, profileId, nodeId, score, breakdown, mode } =
        request.body;

      if (!taskRunId || !taskDefinitionId || !profileId || !nodeId) {
        return reply.code(400).send({
          error: 'INVALID_REQUEST',
          message: 'taskRunId, taskDefinitionId, profileId, and nodeId are required',
        });
      }

      if (typeof score !== 'number') {
        return reply.code(400).send({
          error: 'INVALID_SCORE',
          message: 'score must be a number',
        });
      }

      const decision = await routingStore.recordDecision({
        taskDefId: taskDefinitionId,
        taskRunId,
        profileId,
        nodeId,
        score,
        breakdown: {
          capabilityMatch: breakdown.capabilityMatch ?? 1.0,
          loadScore: breakdown.loadScore ?? 0,
          costScore: breakdown.costScore ?? 0,
          successRateScore: breakdown.successRateScore ?? 0,
          durationScore: breakdown.durationScore ?? 0,
          weightedTotal: breakdown.weightedTotal ?? score,
        },
        mode: mode ?? 'auto',
      });

      return reply.code(201).send(decision);
    },
  );

  // ── GET /decisions/:taskRunId ─────────────────────────────
  app.get<{
    Params: { taskRunId: string };
  }>(
    '/decisions/:taskRunId',
    { schema: { tags: ['routing'], summary: 'Get routing decision for a task run' } },
    async (request, reply): Promise<RoutingDecision | null> => {
      const decision = await routingStore.getDecisionByTaskRun(request.params.taskRunId);

      if (!decision) {
        return reply.code(404).send({
          error: 'DECISION_NOT_FOUND',
          message: 'No routing decision found for this task run',
        });
      }

      return decision;
    },
  );

  // ── POST /outcomes ────────────────────────────────────────
  app.post<{
    Body: {
      taskRunId: string;
      status: string;
      durationMs?: number;
      costUsd?: number;
      tokensUsed?: number;
      errorCode?: string;
    };
  }>(
    '/outcomes',
    { schema: { tags: ['routing'], summary: 'Record task execution outcome' } },
    async (request, reply): Promise<RoutingOutcome> => {
      const { taskRunId, status, durationMs, costUsd, tokensUsed, errorCode } = request.body;

      if (!taskRunId) {
        return reply.code(400).send({
          error: 'INVALID_REQUEST',
          message: 'taskRunId is required',
        });
      }

      if (!status || !isRoutingOutcomeStatus(status)) {
        return reply.code(400).send({
          error: 'INVALID_STATUS',
          message: 'status must be one of: completed, failed, cancelled',
        });
      }

      // Look up the task run to get profile/node info
      const taskRun = await taskRunStore.getRun(taskRunId);
      if (!taskRun) {
        return reply.code(404).send({
          error: 'TASK_RUN_NOT_FOUND',
          message: 'Task run not found',
        });
      }

      // Look up existing decision
      const decision = await routingStore.getDecisionByTaskRun(taskRunId);

      const outcome = await routingStore.recordOutcome({
        routingDecisionId: decision?.id ?? null,
        taskRunId,
        profileId: decision?.selectedProfileId ?? (taskRun.assigneeInstanceId || 'unknown'),
        nodeId: decision?.selectedNodeId ?? (taskRun.machineId || 'unknown'),
        capabilities: [],
        status,
        durationMs: durationMs ?? null,
        costUsd: costUsd ?? null,
        tokensUsed: tokensUsed ?? null,
        errorCode: errorCode ?? null,
      });

      return reply.code(201).send(outcome);
    },
  );
};

async function buildStatsMap(
  routingStore: RoutingStore,
  profiles: readonly AgentProfile[],
  capabilities: readonly string[],
): Promise<StatsMap> {
  const map = new Map<string, AggregateStats>();

  for (const profile of profiles) {
    try {
      const stats = await routingStore.getAggregateStats(profile.id, capabilities);
      map.set(profile.id, stats);
    } catch {
      // Skip -- engine uses neutral defaults when stats are missing
    }
  }

  return map;
}
