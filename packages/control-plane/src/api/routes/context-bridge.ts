import type { ContextBudgetPolicy, OverflowStrategy } from '@agentctl/shared';
import {
  CONTEXT_REF_MODES,
  ControlPlaneError,
  isContextRefMode,
  isOverflowStrategy,
} from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { Logger } from 'pino';
import type { ContextBridgeStore } from '../../collaboration/context-bridge-store.js';
import { ContextBudgetManager } from '../../collaboration/context-budget-manager.js';
import type { EventStore } from '../../collaboration/event-store.js';
import type { SpaceStore } from '../../collaboration/space-store.js';

export type ContextBridgeRoutesOptions = {
  contextBridgeStore: ContextBridgeStore;
  spaceStore: SpaceStore;
  eventStore: EventStore;
};

export const contextBridgeRoutes: FastifyPluginAsync<ContextBridgeRoutesOptions> = async (
  app,
  opts,
) => {
  const { contextBridgeStore, spaceStore, eventStore } = opts;

  // ---------------------------------------------------------------------------
  // Context Refs
  // ---------------------------------------------------------------------------

  app.post<{
    Params: { spaceId: string };
    Body: {
      sourceSpaceId: string;
      sourceThreadId?: string;
      sourceEventId?: string;
      targetThreadId: string;
      mode: string;
      snapshotPayload?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
      createdBy: string;
    };
  }>(
    '/:spaceId/context-refs',
    { schema: { tags: ['context-bridge'], summary: 'Create a context reference in target space' } },
    async (request, reply) => {
      const { spaceId } = request.params;
      const { sourceSpaceId, sourceThreadId, sourceEventId, targetThreadId, mode, createdBy } =
        request.body;

      // Validate target space exists
      const targetSpace = await spaceStore.getSpace(spaceId);
      if (!targetSpace) {
        return reply.code(404).send({
          error: 'SPACE_NOT_FOUND',
          message: 'Target space not found',
        });
      }

      // Validate source space exists
      const sourceSpace = await spaceStore.getSpace(sourceSpaceId);
      if (!sourceSpace) {
        return reply.code(400).send({
          error: 'SOURCE_SPACE_NOT_FOUND',
          message: 'Source space not found',
        });
      }

      if (!mode || !isContextRefMode(mode)) {
        return reply.code(400).send({
          error: 'INVALID_MODE',
          message: `mode must be one of: ${CONTEXT_REF_MODES.join(', ')}`,
        });
      }

      if (!createdBy || typeof createdBy !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_CREATED_BY',
          message: 'A non-empty "createdBy" string is required',
        });
      }

      if (!targetThreadId || typeof targetThreadId !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_TARGET_THREAD_ID',
          message: 'A non-empty "targetThreadId" string is required',
        });
      }

      const ref = await contextBridgeStore.createRef({
        sourceSpaceId,
        sourceThreadId: sourceThreadId ?? null,
        sourceEventId: sourceEventId ?? null,
        targetSpaceId: spaceId,
        targetThreadId,
        mode,
        snapshotPayload: request.body.snapshotPayload ?? null,
        metadata: request.body.metadata ?? {},
        createdBy,
      });

      return reply.code(201).send(ref);
    },
  );

  app.get<{ Params: { spaceId: string } }>(
    '/:spaceId/context-refs',
    { schema: { tags: ['context-bridge'], summary: 'List all context refs for a space' } },
    async (request, reply) => {
      const space = await spaceStore.getSpace(request.params.spaceId);
      if (!space) {
        return reply.code(404).send({
          error: 'SPACE_NOT_FOUND',
          message: 'Space not found',
        });
      }

      return await contextBridgeStore.listRefsByTargetSpace(request.params.spaceId);
    },
  );

  app.get<{
    Params: { spaceId: string };
    Querystring: {
      perSpaceLimit?: string;
      totalLimit?: string;
      overflowStrategy?: string;
    };
  }>(
    '/:spaceId/context-refs/budgeted',
    {
      schema: {
        tags: ['context-bridge'],
        summary: 'List context refs with budget constraints applied',
      },
    },
    async (request, reply) => {
      const space = await spaceStore.getSpace(request.params.spaceId);
      if (!space) {
        return reply.code(404).send({
          error: 'SPACE_NOT_FOUND',
          message: 'Space not found',
        });
      }

      const { perSpaceLimit, totalLimit, overflowStrategy } = request.query;

      if (overflowStrategy !== undefined && !isOverflowStrategy(overflowStrategy)) {
        return reply.code(400).send({
          error: 'INVALID_OVERFLOW_STRATEGY',
          message: 'overflowStrategy must be one of: truncate, prioritize, reject',
        });
      }

      const parsedPerSpace = perSpaceLimit !== undefined ? Number(perSpaceLimit) : undefined;
      const parsedTotal = totalLimit !== undefined ? Number(totalLimit) : undefined;

      if (parsedPerSpace !== undefined && (Number.isNaN(parsedPerSpace) || parsedPerSpace < 0)) {
        return reply.code(400).send({
          error: 'INVALID_PER_SPACE_LIMIT',
          message: 'perSpaceLimit must be a non-negative number',
        });
      }

      if (parsedTotal !== undefined && (Number.isNaN(parsedTotal) || parsedTotal < 0)) {
        return reply.code(400).send({
          error: 'INVALID_TOTAL_LIMIT',
          message: 'totalLimit must be a non-negative number',
        });
      }

      const policy: ContextBudgetPolicy = {
        perSpaceLimit: parsedPerSpace ?? 4000,
        totalLimit: parsedTotal ?? 16000,
        overflowStrategy: (overflowStrategy as OverflowStrategy) ?? 'truncate',
      };

      const refs = await contextBridgeStore.listRefsByTargetSpace(request.params.spaceId);
      const budgetManager = new ContextBudgetManager({
        policy,
        logger: request.log as unknown as Logger,
      });
      const result = budgetManager.applyBudget(refs);

      return {
        refs: result.refs,
        excluded: result.excluded,
        budget: result.summary,
      };
    },
  );

  app.get<{ Params: { spaceId: string; refId: string } }>(
    '/:spaceId/context-refs/:refId/resolve',
    { schema: { tags: ['context-bridge'], summary: 'Resolve a context ref (live or snapshot)' } },
    async (request, reply) => {
      const ref = await contextBridgeStore.getRef(request.params.refId);

      if (!ref || ref.targetSpaceId !== request.params.spaceId) {
        return reply.code(404).send({
          error: 'CONTEXT_REF_NOT_FOUND',
          message: 'Context ref not found',
        });
      }

      // For copy mode, return the frozen snapshot
      if (ref.mode === 'copy') {
        return {
          ref,
          resolved: ref.snapshotPayload,
          resolvedAt: new Date().toISOString(),
        };
      }

      // For reference mode, fetch live events from the source thread
      if (ref.mode === 'reference' && ref.sourceThreadId) {
        try {
          const events = await eventStore.getEvents(ref.sourceThreadId, { limit: 100 });
          return {
            ref,
            resolved: events,
            resolvedAt: new Date().toISOString(),
          };
        } catch {
          return reply.code(502).send({
            error: 'SOURCE_UNAVAILABLE',
            message: 'Unable to resolve live data from source thread',
          });
        }
      }

      // For query / subscription modes, return the ref itself with a hint
      return {
        ref,
        resolved: null,
        resolvedAt: new Date().toISOString(),
        hint:
          ref.mode === 'query'
            ? 'Use cross_space_query MCP tool to query source space on demand'
            : 'Subscription delivers events in real-time; no point-in-time resolution',
      };
    },
  );

  app.delete<{ Params: { spaceId: string; refId: string } }>(
    '/:spaceId/context-refs/:refId',
    { schema: { tags: ['context-bridge'], summary: 'Delete a context ref' } },
    async (request, reply) => {
      const ref = await contextBridgeStore.getRef(request.params.refId);

      if (!ref || ref.targetSpaceId !== request.params.spaceId) {
        return reply.code(404).send({
          error: 'CONTEXT_REF_NOT_FOUND',
          message: 'Context ref not found',
        });
      }

      try {
        await contextBridgeStore.deleteRef(request.params.refId);
        return { ok: true };
      } catch (err) {
        if (err instanceof ControlPlaneError && err.code === 'CONTEXT_REF_NOT_FOUND') {
          return reply.code(404).send({
            error: 'CONTEXT_REF_NOT_FOUND',
            message: 'Context ref not found',
          });
        }
        throw err;
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Cross-Space Subscriptions
  // ---------------------------------------------------------------------------

  app.post<{
    Params: { spaceId: string };
    Body: {
      sourceSpaceId: string;
      filterCriteria?: Record<string, unknown>;
      createdBy: string;
    };
  }>(
    '/:spaceId/subscriptions',
    { schema: { tags: ['context-bridge'], summary: 'Create a cross-space subscription' } },
    async (request, reply) => {
      const { spaceId } = request.params;
      const { sourceSpaceId, filterCriteria, createdBy } = request.body;

      const targetSpace = await spaceStore.getSpace(spaceId);
      if (!targetSpace) {
        return reply.code(404).send({
          error: 'SPACE_NOT_FOUND',
          message: 'Target space not found',
        });
      }

      const sourceSpace = await spaceStore.getSpace(sourceSpaceId);
      if (!sourceSpace) {
        return reply.code(400).send({
          error: 'SOURCE_SPACE_NOT_FOUND',
          message: 'Source space not found',
        });
      }

      if (!createdBy || typeof createdBy !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_CREATED_BY',
          message: 'A non-empty "createdBy" string is required',
        });
      }

      const subscription = await contextBridgeStore.createSubscription({
        sourceSpaceId,
        targetSpaceId: spaceId,
        filterCriteria: filterCriteria ?? {},
        createdBy,
      });

      return reply.code(201).send(subscription);
    },
  );

  app.get<{ Params: { spaceId: string } }>(
    '/:spaceId/subscriptions',
    { schema: { tags: ['context-bridge'], summary: 'List cross-space subscriptions' } },
    async (request, reply) => {
      const space = await spaceStore.getSpace(request.params.spaceId);
      if (!space) {
        return reply.code(404).send({
          error: 'SPACE_NOT_FOUND',
          message: 'Space not found',
        });
      }

      return await contextBridgeStore.listSubscriptionsByTarget(request.params.spaceId);
    },
  );

  app.patch<{
    Params: { spaceId: string; subId: string };
    Body: { active: boolean };
  }>(
    '/:spaceId/subscriptions/:subId',
    { schema: { tags: ['context-bridge'], summary: 'Toggle subscription active state' } },
    async (request, reply) => {
      const { active } = request.body;

      if (typeof active !== 'boolean') {
        return reply.code(400).send({
          error: 'INVALID_ACTIVE',
          message: '"active" must be a boolean',
        });
      }

      const existing = await contextBridgeStore.getSubscription(request.params.subId);
      if (!existing || existing.targetSpaceId !== request.params.spaceId) {
        return reply.code(404).send({
          error: 'SUBSCRIPTION_NOT_FOUND',
          message: 'Subscription not found',
        });
      }

      try {
        return await contextBridgeStore.updateSubscriptionActive(request.params.subId, active);
      } catch (err) {
        if (err instanceof ControlPlaneError && err.code === 'SUBSCRIPTION_NOT_FOUND') {
          return reply.code(404).send({
            error: 'SUBSCRIPTION_NOT_FOUND',
            message: 'Subscription not found',
          });
        }
        throw err;
      }
    },
  );

  app.delete<{ Params: { spaceId: string; subId: string } }>(
    '/:spaceId/subscriptions/:subId',
    { schema: { tags: ['context-bridge'], summary: 'Delete a cross-space subscription' } },
    async (request, reply) => {
      const existing = await contextBridgeStore.getSubscription(request.params.subId);
      if (!existing || existing.targetSpaceId !== request.params.spaceId) {
        return reply.code(404).send({
          error: 'SUBSCRIPTION_NOT_FOUND',
          message: 'Subscription not found',
        });
      }

      try {
        await contextBridgeStore.deleteSubscription(request.params.subId);
        return { ok: true };
      } catch (err) {
        if (err instanceof ControlPlaneError && err.code === 'SUBSCRIPTION_NOT_FOUND') {
          return reply.code(404).send({
            error: 'SUBSCRIPTION_NOT_FOUND',
            message: 'Subscription not found',
          });
        }
        throw err;
      }
    },
  );
};
