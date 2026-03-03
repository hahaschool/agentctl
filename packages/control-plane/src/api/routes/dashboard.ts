import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { type Database, extractRows } from '../../db/index.js';
import type { DbAgentRegistry } from '../../registry/db-registry.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DashboardRoutesOptions = {
  db: Database;
  dbRegistry: DbAgentRegistry;
};

type AgentCountRow = {
  status: string;
  count: number;
};

type RunCountRow = {
  status: string;
  count: number;
};

type RunTotalRow = {
  total: number;
};

type WebhookCountRow = {
  total: number;
  active: number;
};

type RecentErrorRow = {
  agent_id: string;
  error_message: string;
  finished_at: string;
};

type AgentStatRow = {
  agent_id: string;
  agent_name: string;
  status: string;
  total_runs: number;
  successful_runs: number;
  avg_duration_ms: number | null;
  total_tokens: number | null;
  total_cost_usd: number | null;
  last_run_at: string | null;
};

type ToolUsageRow = {
  tool_name: string;
  count: number;
  avg_duration_ms: number | null;
};

type TopAgentByToolUseRow = {
  agent_id: string;
  total_tool_calls: number;
};

type CostByAgentRow = {
  agent_id: string;
  cost_usd: number;
};

type CostByProviderRow = {
  provider: string;
  cost_usd: number;
};

type TotalCostRow = {
  total_cost_usd: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_PERIODS = ['1d', '7d', '30d', '90d'] as const;
type Period = (typeof VALID_PERIODS)[number];

function periodToInterval(period: Period): string {
  const map: Record<Period, string> = {
    '1d': '1 day',
    '7d': '7 days',
    '30d': '30 days',
    '90d': '90 days',
  };
  return map[period];
}

function isValidPeriod(value: string): value is Period {
  return (VALID_PERIODS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const dashboardRoutes: FastifyPluginAsync<DashboardRoutesOptions> = async (app, opts) => {
  const { db } = opts;

  // -------------------------------------------------------------------------
  // GET /overview — System summary
  // -------------------------------------------------------------------------

  app.get(
    '/overview',
    {
      schema: {
        tags: ['dashboard'],
        summary: 'Get system overview with agent, run, and webhook counts',
      },
    },
    async (_request, reply) => {
      try {
        const [
          agentCountsResult,
          runTotalResult,
          runCountsResult,
          webhookResult,
          recentErrorsResult,
        ] = await Promise.all([
          db.execute(sql`SELECT status, COUNT(*)::int AS count FROM agents GROUP BY status`),
          db.execute(sql`SELECT COUNT(*)::int AS total FROM agent_runs`),
          db.execute(sql`SELECT status, COUNT(*)::int AS count FROM agent_runs GROUP BY status`),
          db.execute(
            sql`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE active = true)::int AS active FROM webhook_subscriptions`,
          ),
          db.execute(
            sql`SELECT agent_id, error_message, finished_at FROM agent_runs WHERE status = 'error' ORDER BY finished_at DESC LIMIT 10`,
          ),
        ]);

        const agentCounts = extractRows<AgentCountRow>(agentCountsResult);
        const runTotal = extractRows<RunTotalRow>(runTotalResult)[0]?.total ?? 0;
        const runCounts = extractRows<RunCountRow>(runCountsResult);
        const webhook = extractRows<WebhookCountRow>(webhookResult)[0] ?? {
          total: 0,
          active: 0,
        };
        const recentErrors = extractRows<RecentErrorRow>(recentErrorsResult);

        let totalAgents = 0;
        let onlineAgents = 0;
        let offlineAgents = 0;

        for (const row of agentCounts) {
          totalAgents += row.count;
          if (row.status === 'online' || row.status === 'running') {
            onlineAgents += row.count;
          } else if (row.status === 'offline') {
            offlineAgents += row.count;
          }
        }

        let activeRuns = 0;
        let completedRuns = 0;
        let failedRuns = 0;

        for (const row of runCounts) {
          if (row.status === 'running' || row.status === 'active') {
            activeRuns += row.count;
          } else if (row.status === 'completed' || row.status === 'success') {
            completedRuns += row.count;
          } else if (row.status === 'error' || row.status === 'failed') {
            failedRuns += row.count;
          }
        }

        return {
          agents: {
            total: totalAgents,
            online: onlineAgents,
            offline: offlineAgents,
          },
          runs: {
            total: runTotal,
            active: activeRuns,
            completed: completedRuns,
            failed: failedRuns,
          },
          webhooks: {
            total: webhook.total,
            active: webhook.active,
          },
          recentErrors: recentErrors.map((row) => ({
            agentId: row.agent_id,
            error: row.error_message,
            timestamp: row.finished_at,
          })),
        };
      } catch {
        return reply.code(500).send({
          error: 'DASHBOARD_OVERVIEW_ERROR',
          message: 'Failed to fetch dashboard overview',
        });
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /agent-stats — Per-agent statistics
  // -------------------------------------------------------------------------

  app.get(
    '/agent-stats',
    { schema: { tags: ['dashboard'], summary: 'Get per-agent statistics and success rates' } },
    async (_request, reply) => {
      try {
        const result = await db.execute(
          sql`SELECT
            a.id AS agent_id,
            a.name AS agent_name,
            a.status,
            COUNT(r.id)::int AS total_runs,
            COUNT(r.id) FILTER (WHERE r.status IN ('completed', 'success'))::int AS successful_runs,
            AVG(EXTRACT(EPOCH FROM (r.finished_at - r.started_at)) * 1000)::int AS avg_duration_ms,
            SUM(COALESCE(r.tokens_in, 0) + COALESCE(r.tokens_out, 0))::bigint AS total_tokens,
            SUM(COALESCE(r.cost_usd, 0))::numeric AS total_cost_usd,
            MAX(r.started_at) AS last_run_at
          FROM agents a
          LEFT JOIN agent_runs r ON r.agent_id = a.id
          GROUP BY a.id, a.name, a.status
          ORDER BY total_runs DESC`,
        );

        const rows = extractRows<AgentStatRow>(result);

        const stats = rows.map((row) => {
          const totalRuns = row.total_runs;
          const successfulRuns = row.successful_runs;
          const successRate = totalRuns > 0 ? Number((successfulRuns / totalRuns).toFixed(4)) : 0;

          return {
            agentId: row.agent_id,
            agentName: row.agent_name,
            status: row.status,
            totalRuns,
            successRate,
            avgDurationMs: row.avg_duration_ms ?? 0,
            totalTokens: row.total_tokens != null ? Number(row.total_tokens) : 0,
            totalCostUsd: row.total_cost_usd != null ? Number(row.total_cost_usd) : 0,
            lastRunAt: row.last_run_at,
          };
        });

        return { stats };
      } catch {
        return reply.code(500).send({
          error: 'DASHBOARD_AGENT_STATS_ERROR',
          message: 'Failed to fetch agent stats',
        });
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /tool-usage — Tool analytics
  // -------------------------------------------------------------------------

  app.get(
    '/tool-usage',
    { schema: { tags: ['dashboard'], summary: 'Get tool usage analytics and top agents' } },
    async (_request, reply) => {
      try {
        const [toolResult, topAgentsResult] = await Promise.all([
          db.execute(
            sql`SELECT
              tool_name,
              COUNT(*)::int AS count,
              AVG(duration_ms)::int AS avg_duration_ms
            FROM agent_actions
            WHERE tool_name IS NOT NULL
            GROUP BY tool_name
            ORDER BY count DESC`,
          ),
          db.execute(
            sql`SELECT
              agent_id,
              COUNT(*)::int AS total_tool_calls
            FROM agent_actions
            JOIN agent_runs ON agent_actions.run_id = agent_runs.id
            GROUP BY agent_id
            ORDER BY total_tool_calls DESC
            LIMIT 10`,
          ),
        ]);

        const tools = extractRows<ToolUsageRow>(toolResult).map((row) => ({
          tool: row.tool_name,
          count: row.count,
          avgDurationMs: row.avg_duration_ms ?? 0,
        }));

        const topAgentsByToolUse = extractRows<TopAgentByToolUseRow>(topAgentsResult).map(
          (row) => ({
            agentId: row.agent_id,
            totalToolCalls: row.total_tool_calls,
          }),
        );

        return { tools, topAgentsByToolUse };
      } catch {
        return reply.code(500).send({
          error: 'DASHBOARD_TOOL_USAGE_ERROR',
          message: 'Failed to fetch tool usage',
        });
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /cost-summary?period=7d — Cost breakdown
  // -------------------------------------------------------------------------

  app.get<{ Querystring: { period?: string } }>(
    '/cost-summary',
    {
      schema: {
        tags: ['dashboard'],
        summary: 'Get cost breakdown by agent and provider for a period',
      },
    },
    async (request, reply) => {
      const rawPeriod = request.query.period ?? '7d';

      if (!isValidPeriod(rawPeriod)) {
        return reply.code(400).send({
          error: 'INVALID_PERIOD',
          message: `Invalid period "${rawPeriod}". Must be one of: ${VALID_PERIODS.join(', ')}`,
        });
      }

      const interval = periodToInterval(rawPeriod);

      try {
        const [totalResult, byAgentResult, byProviderResult] = await Promise.all([
          db.execute(
            sql`SELECT COALESCE(SUM(cost_usd), 0)::numeric AS total_cost_usd
            FROM agent_runs
            WHERE started_at >= NOW() - ${sql.raw(`INTERVAL '${interval}'`)}`,
          ),
          db.execute(
            sql`SELECT
              agent_id,
              COALESCE(SUM(cost_usd), 0)::numeric AS cost_usd
            FROM agent_runs
            WHERE started_at >= NOW() - ${sql.raw(`INTERVAL '${interval}'`)}
            GROUP BY agent_id
            ORDER BY cost_usd DESC`,
          ),
          db.execute(
            sql`SELECT
              COALESCE(provider, 'unknown') AS provider,
              COALESCE(SUM(cost_usd), 0)::numeric AS cost_usd
            FROM agent_runs
            WHERE started_at >= NOW() - ${sql.raw(`INTERVAL '${interval}'`)}
            GROUP BY provider
            ORDER BY cost_usd DESC`,
          ),
        ]);

        const totalRow = extractRows<TotalCostRow>(totalResult)[0];
        const totalCostUsd = totalRow ? Number(totalRow.total_cost_usd) : 0;

        const byAgent = extractRows<CostByAgentRow>(byAgentResult).map((row) => ({
          agentId: row.agent_id,
          costUsd: Number(row.cost_usd),
        }));

        const byProvider = extractRows<CostByProviderRow>(byProviderResult).map((row) => ({
          provider: row.provider,
          costUsd: Number(row.cost_usd),
        }));

        return {
          period: rawPeriod,
          totalCostUsd,
          byAgent,
          byProvider,
        };
      } catch {
        return reply.code(500).send({
          error: 'DASHBOARD_COST_SUMMARY_ERROR',
          message: 'Failed to fetch cost summary',
        });
      }
    },
  );
};
