import {
  ControlPlaneError,
  toExecutionSummary,
  type ExecutionSummary,
  type ExecutionSummaryStatus,
} from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { AuditEntry, SessionSummary } from '../../audit/session-replay.js';
import { buildTimeline, generateSummary } from '../../audit/session-replay.js';
import type { DbAgentRegistry } from '../../registry/db-registry.js';
import { PAGINATION } from '../constants.js';

export type RunSummaryRoutesOptions = {
  dbRegistry: DbAgentRegistry;
};

type RunSummaryParams = {
  runId: string;
};

export const runSummaryRoutes: FastifyPluginAsync<RunSummaryRoutesOptions> = async (app, opts) => {
  const { dbRegistry } = opts;

  app.get<{ Params: RunSummaryParams }>(
    '/:runId/summary',
    { schema: { tags: ['audit'], summary: 'Get a structured summary for a run' } },
    async (request, reply) => {
      const { runId } = request.params;

      if (!runId || typeof runId !== 'string') {
        return reply
          .code(400)
          .send({ error: 'INVALID_RUN_ID', message: 'A valid runId parameter is required' });
      }

      const run = await dbRegistry.getRun(runId);
      if (!run) {
        return reply
          .code(404)
          .send({ error: 'RUN_NOT_FOUND', message: `Run '${runId}' was not found` });
      }

      const storedSummary = toExecutionSummary(run.resultSummary, run);
      if (storedSummary) {
        return {
          runId,
          source: 'stored' as const,
          summary: storedSummary,
        };
      }

      try {
        const result = await dbRegistry.queryActions({
          runId,
          limit: PAGINATION.replay.maxLimit,
          offset: 0,
        });
        const entries = result.actions.map(toAuditEntry);
        const agentId = run.agentId || inferAgentId(entries);
        const timeline = buildTimeline(entries, runId, agentId);

        if (timeline.totalEvents === 0) {
          return reply.code(404).send({
            error: 'RUN_SUMMARY_NOT_FOUND',
            message: `Run '${runId}' does not have a stored or replay-derived summary`,
          });
        }

        return {
          runId,
          source: 'fallback' as const,
          summary: toExecutionSummaryFromReplay(generateSummary(timeline), run),
        };
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError) {
          return reply.code(502).send({ error: error.code, message: error.message });
        }

        return reply.code(500).send({
          error: 'RUN_SUMMARY_FAILED',
          message: 'Failed to derive a run summary',
        });
      }
    },
  );
};

function toAuditEntry(action: Awaited<ReturnType<DbAgentRegistry['queryActions']>>['actions'][number]): AuditEntry {
  return {
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
  };
}

function inferAgentId(entries: AuditEntry[]): string {
  for (const entry of entries) {
    if (entry.agentId) {
      return entry.agentId;
    }
  }
  return '';
}

function toExecutionSummaryFromReplay(summary: SessionSummary, run: {
  status: string;
  costUsd: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
}): ExecutionSummary {
  const toolUsageBreakdown: Record<string, number> = {};
  for (const tool of summary.uniqueTools) {
    toolUsageBreakdown[tool] = 1;
  }

  const keyFindings: string[] = [];
  if (summary.uniqueTools.length > 0) {
    keyFindings.push(`Tools used: ${summary.uniqueTools.join(', ')}`);
  }
  if (summary.deniedCalls > 0) {
    keyFindings.push(`${summary.deniedCalls} tool calls were denied during execution.`);
  }

  return {
    status: mapRunStatus(run.status),
    workCompleted: `Replay-derived summary from ${summary.totalToolCalls} tool calls.`,
    executiveSummary: `Run completed with ${summary.totalToolCalls} tool calls across ${summary.uniqueTools.length} tools.`,
    keyFindings,
    filesChanged: [],
    commandsRun: summary.totalToolCalls,
    toolUsageBreakdown,
    followUps: [],
    branchName: null,
    prUrl: null,
    tokensUsed: {
      input: run.tokensIn ?? 0,
      output: run.tokensOut ?? 0,
    },
    costUsd: run.costUsd ?? summary.totalCostUsd,
    durationMs: summary.duration,
  };
}

function mapRunStatus(status: string): ExecutionSummaryStatus {
  switch (status) {
    case 'success':
      return 'success';
    case 'failure':
    case 'cancelled':
    case 'timeout':
    case 'error':
      return 'failure';
    default:
      return 'partial';
  }
}
