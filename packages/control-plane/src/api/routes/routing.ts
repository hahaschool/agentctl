import type {
  AgentProfile,
  AggregateStats,
  RoutingCandidate,
  RoutingDecision,
  RoutingOutcome,
} from '@agentctl/shared';
import { isRoutingOutcomeStatus } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import type { AgentProfileStore } from '../../collaboration/agent-profile-store.js';
import type { RoutingStore } from '../../collaboration/routing-store.js';
import type { TaskRunStore } from '../../collaboration/task-run-store.js';
import type { WorkerNodeStore } from '../../collaboration/worker-node-store.js';
import type { RoutingEngine, StatsMap } from '../../intelligence/routing-engine.js';

// Routing inputs feed scorer loops, DB writes, and outcome-learning stats. Keep
// strings/arrays/numbers bounded before any store or engine call so a bad API
// payload cannot amplify work or poison persisted scoring data.
const MAX_ROUTING_ID_LENGTH = 512;
const MAX_ROUTING_LABEL_LENGTH = 128;
const MAX_ROUTING_ARRAY_ITEMS = 64;
const MAX_RANK_LIMIT = 50;
const MAX_ESTIMATED_TOKENS = 1_000_000_000;
const MAX_OUTCOME_DURATION_MS = 365 * 24 * 60 * 60 * 1_000;
const MAX_OUTCOME_COST_USD = 1_000_000;
const MAX_OUTCOME_TOKENS_USED = 10_000_000_000;
const MAX_BREAKDOWN_JSON_BYTES = 4_096;

const trimmedString = (max: number) =>
  z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(max));

const routingIdSchema = trimmedString(MAX_ROUTING_ID_LENGTH);
const routingLabelSchema = trimmedString(MAX_ROUTING_LABEL_LENGTH);
const nonnegativeFiniteNumber = z.number().finite().nonnegative();
const nonnegativeInteger = z.number().finite().int().nonnegative();

const boundedBreakdownObject = (value: Record<string, unknown>) => {
  try {
    return JSON.stringify(value).length <= MAX_BREAKDOWN_JSON_BYTES;
  } catch {
    return false;
  }
};

const routingBreakdownSchema = z
  .object({
    capabilityMatch: nonnegativeFiniteNumber.optional(),
    loadScore: nonnegativeFiniteNumber.optional(),
    costScore: nonnegativeFiniteNumber.optional(),
    successRateScore: nonnegativeFiniteNumber.optional(),
    durationScore: nonnegativeFiniteNumber.optional(),
    weightedTotal: nonnegativeFiniteNumber.optional(),
  })
  .passthrough()
  .refine(boundedBreakdownObject, {
    message: `breakdown JSON must be ≤ ${MAX_BREAKDOWN_JSON_BYTES} bytes`,
  });

const rankBodySchema = z.object({
  taskDefinitionId: routingIdSchema,
  requiredCapabilities: z.array(routingLabelSchema).min(1).max(MAX_ROUTING_ARRAY_ITEMS),
  machineRequirements: z.array(routingLabelSchema).max(MAX_ROUTING_ARRAY_ITEMS).optional(),
  estimatedTokens: nonnegativeInteger.max(MAX_ESTIMATED_TOKENS).nullable().optional(),
  limit: z
    .number()
    .finite()
    .int()
    .positive()
    .transform((value) => Math.min(value, MAX_RANK_LIMIT))
    .optional(),
});

const assignBodySchema = z.object({
  taskRunId: routingIdSchema,
  taskDefinitionId: routingIdSchema,
  profileId: routingIdSchema,
  nodeId: routingIdSchema,
  score: nonnegativeFiniteNumber,
  breakdown: routingBreakdownSchema,
  mode: z.enum(['auto', 'suggested']).optional(),
});

const outcomeBodySchema = z.object({
  taskRunId: routingIdSchema,
  status: z.string().refine(isRoutingOutcomeStatus),
  durationMs: nonnegativeInteger.max(MAX_OUTCOME_DURATION_MS).nullable().optional(),
  costUsd: nonnegativeFiniteNumber.max(MAX_OUTCOME_COST_USD).nullable().optional(),
  tokensUsed: nonnegativeInteger.max(MAX_OUTCOME_TOKENS_USED).nullable().optional(),
  errorCode: z.string().max(MAX_ROUTING_ID_LENGTH).nullable().optional(),
});

function invalidRoutingRequest(message: string) {
  return { error: 'INVALID_REQUEST', message };
}

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
      const parsed = rankBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(
            invalidRoutingRequest(
              `taskDefinitionId must be a non-empty string ≤ ${MAX_ROUTING_ID_LENGTH} chars; requiredCapabilities must contain 1-${MAX_ROUTING_ARRAY_ITEMS} bounded strings; numeric fields must be finite and non-negative`,
            ),
          );
      }
      const {
        taskDefinitionId,
        requiredCapabilities,
        machineRequirements,
        estimatedTokens,
        limit,
      } = parsed.data;

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
      const parsed = assignBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(
            invalidRoutingRequest(
              `assignment ids must be non-empty strings ≤ ${MAX_ROUTING_ID_LENGTH} chars; score and breakdown fields must be finite non-negative numbers`,
            ),
          );
      }
      const { taskRunId, taskDefinitionId, profileId, nodeId, score, breakdown, mode } =
        parsed.data;

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
      const parsed = outcomeBodySchema.safeParse(request.body);
      if (!parsed.success) {
        const statusIssue = parsed.error.issues.find((issue) => issue.path[0] === 'status');
        if (statusIssue) {
          return reply.code(400).send({
            error: 'INVALID_STATUS',
            message: 'status must be one of: completed, failed, cancelled',
          });
        }
        return reply.code(400).send({
          error: 'INVALID_REQUEST',
          message: `taskRunId/errorCode must be bounded strings; durationMs, costUsd, and tokensUsed must be finite non-negative numbers`,
        });
      }
      const { taskRunId, status, durationMs, costUsd, tokensUsed, errorCode } = parsed.data;

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
