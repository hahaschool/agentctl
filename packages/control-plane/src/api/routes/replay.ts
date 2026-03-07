import { ControlPlaneError } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { AuditEntry } from '../../audit/session-replay.js';
import {
  buildTimeline,
  filterEvents,
  findSuspiciousPatterns,
  generateSummary,
} from '../../audit/session-replay.js';
import type { DbAgentRegistry } from '../../registry/db-registry.js';
import { clampLimit, PAGINATION } from '../constants.js';

export type ReplayRoutesOptions = {
  dbRegistry: DbAgentRegistry;
};

type ReplayParams = {
  sessionId: string;
};

type ReplayQuerystring = {
  agentId?: string;
  toolName?: string;
  eventType?: string;
  from?: string;
  to?: string;
  limit?: string;
  offset?: string;
};

export const replayRoutes: FastifyPluginAsync<ReplayRoutesOptions> = async (app, opts) => {
  const { dbRegistry } = opts;

  // ---------------------------------------------------------------------------
  // GET /api/audit/replay/:sessionId — full session timeline
  // ---------------------------------------------------------------------------

  app.get<{ Params: ReplayParams; Querystring: ReplayQuerystring }>(
    '/:sessionId',
    { schema: { tags: ['audit'], summary: 'Get full session replay timeline' } },
    async (request, reply) => {
      const { sessionId } = request.params;
      const { agentId } = request.query;

      if (!sessionId || typeof sessionId !== 'string') {
        return reply
          .code(400)
          .send({ error: 'INVALID_PARAMS', message: 'A valid sessionId parameter is required' });
      }

      try {
        const result = await dbRegistry.queryActions({
          runId: sessionId,
          limit: PAGINATION.replay.maxLimit,
          offset: 0,
        });

        const entries: AuditEntry[] = result.actions.map((action) => ({
          kind: action.actionType,
          timestamp: action.timestamp
            ? action.timestamp instanceof Date
              ? action.timestamp.toISOString()
              : String(action.timestamp)
            : new Date().toISOString(),
          sessionId: action.runId ?? '',
          agentId: action.agentId ?? '',
          tool: action.toolName ?? undefined,
          decision: action.approvedBy ? 'allow' : undefined,
          durationMs: action.durationMs ?? undefined,
          input:
            action.toolInput && typeof action.toolInput === 'object'
              ? (action.toolInput as Record<string, unknown>)
              : undefined,
        }));

        const resolvedAgentId = agentId ?? inferAgentId(entries, sessionId);

        const timeline = buildTimeline(entries, sessionId, resolvedAgentId);

        if (timeline.totalEvents === 0) {
          return reply.code(404).send({
            error: 'SESSION_NOT_FOUND',
            message: `No audit entries found for session '${sessionId}'`,
          });
        }

        // Apply optional event filters
        const filter = parseQueryFilter(request.query);
        if (hasActiveFilter(filter)) {
          const filtered = filterEvents(timeline, filter);
          return { ...timeline, events: filtered, totalEvents: filtered.length };
        }

        return timeline;
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError) {
          return reply.code(502).send({ error: error.code, message: error.message });
        }
        return reply
          .code(500)
          .send({ error: 'REPLAY_FAILED', message: 'Failed to build session replay' });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // GET /api/audit/replay/:sessionId/summary — session summary statistics
  // ---------------------------------------------------------------------------

  app.get<{ Params: ReplayParams; Querystring: ReplayQuerystring }>(
    '/:sessionId/summary',
    { schema: { tags: ['audit'], summary: 'Get session summary statistics' } },
    async (request, reply) => {
      const { sessionId } = request.params;
      const { agentId } = request.query;

      if (!sessionId || typeof sessionId !== 'string') {
        return reply
          .code(400)
          .send({ error: 'INVALID_PARAMS', message: 'A valid sessionId parameter is required' });
      }

      try {
        const result = await dbRegistry.queryActions({
          runId: sessionId,
          limit: PAGINATION.replay.maxLimit,
          offset: 0,
        });

        const entries: AuditEntry[] = result.actions.map((action) => ({
          kind: action.actionType,
          timestamp: action.timestamp
            ? action.timestamp instanceof Date
              ? action.timestamp.toISOString()
              : String(action.timestamp)
            : new Date().toISOString(),
          sessionId: action.runId ?? '',
          agentId: action.agentId ?? '',
          tool: action.toolName ?? undefined,
          decision: action.approvedBy ? 'allow' : undefined,
          durationMs: action.durationMs ?? undefined,
          input:
            action.toolInput && typeof action.toolInput === 'object'
              ? (action.toolInput as Record<string, unknown>)
              : undefined,
        }));

        const resolvedAgentId = agentId ?? inferAgentId(entries, sessionId);

        const timeline = buildTimeline(entries, sessionId, resolvedAgentId);

        if (timeline.totalEvents === 0) {
          return reply.code(404).send({
            error: 'SESSION_NOT_FOUND',
            message: `No audit entries found for session '${sessionId}'`,
          });
        }

        return generateSummary(timeline);
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError) {
          return reply.code(502).send({ error: error.code, message: error.message });
        }
        return reply
          .code(500)
          .send({ error: 'SUMMARY_FAILED', message: 'Failed to generate session summary' });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // GET /api/audit/replay/:sessionId/suspicious — suspicious patterns
  // ---------------------------------------------------------------------------

  app.get<{ Params: ReplayParams; Querystring: ReplayQuerystring }>(
    '/:sessionId/suspicious',
    { schema: { tags: ['audit'], summary: 'Detect suspicious patterns in a session' } },
    async (request, reply) => {
      const { sessionId } = request.params;
      const { agentId } = request.query;

      if (!sessionId || typeof sessionId !== 'string') {
        return reply
          .code(400)
          .send({ error: 'INVALID_PARAMS', message: 'A valid sessionId parameter is required' });
      }

      try {
        const result = await dbRegistry.queryActions({
          runId: sessionId,
          limit: PAGINATION.replay.maxLimit,
          offset: 0,
        });

        const entries: AuditEntry[] = result.actions.map((action) => ({
          kind: action.actionType,
          timestamp: action.timestamp
            ? action.timestamp instanceof Date
              ? action.timestamp.toISOString()
              : String(action.timestamp)
            : new Date().toISOString(),
          sessionId: action.runId ?? '',
          agentId: action.agentId ?? '',
          tool: action.toolName ?? undefined,
          decision: action.approvedBy ? 'allow' : undefined,
          durationMs: action.durationMs ?? undefined,
          input:
            action.toolInput && typeof action.toolInput === 'object'
              ? (action.toolInput as Record<string, unknown>)
              : undefined,
        }));

        const resolvedAgentId = agentId ?? inferAgentId(entries, sessionId);

        const timeline = buildTimeline(entries, sessionId, resolvedAgentId);

        if (timeline.totalEvents === 0) {
          return reply.code(404).send({
            error: 'SESSION_NOT_FOUND',
            message: `No audit entries found for session '${sessionId}'`,
          });
        }

        return findSuspiciousPatterns(timeline);
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError) {
          return reply.code(502).send({ error: error.code, message: error.message });
        }
        return reply.code(500).send({
          error: 'SUSPICIOUS_PATTERNS_FAILED',
          message: 'Failed to detect suspicious patterns',
        });
      }
    },
  );
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inferAgentId(entries: AuditEntry[], sessionId: string): string {
  const match = entries.find((e) => e.sessionId === sessionId && e.agentId);
  return match?.agentId ?? '';
}

function parseQueryFilter(
  qs: ReplayQuerystring,
): Omit<import('@agentctl/shared').ReplayFilter, 'sessionId' | 'agentId'> {
  const filter: Record<string, unknown> = {};

  if (qs.toolName) {
    filter.toolName = qs.toolName;
  }

  if (qs.eventType) {
    filter.eventType = qs.eventType;
  }

  if (qs.from) {
    filter.fromTimestamp = qs.from;
  }

  if (qs.to) {
    filter.toTimestamp = qs.to;
  }

  if (qs.limit) {
    const parsed = Number(qs.limit);
    if (Number.isFinite(parsed) && parsed >= 1) {
      filter.limit = clampLimit(parsed, PAGINATION.replay);
    }
  }

  if (qs.offset) {
    const parsed = Number(qs.offset);
    if (Number.isFinite(parsed) && parsed >= 0) {
      filter.offset = Math.floor(parsed);
    }
  }

  return filter as Omit<import('@agentctl/shared').ReplayFilter, 'sessionId' | 'agentId'>;
}

function hasActiveFilter(filter: Record<string, unknown>): boolean {
  return Object.keys(filter).length > 0;
}
