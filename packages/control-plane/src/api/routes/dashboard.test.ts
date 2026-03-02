import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbAgentRegistry } from '../../registry/db-registry.js';
import { dashboardRoutes } from './dashboard.js';

// ---------------------------------------------------------------------------
// Drizzle SQL extraction helpers — same pattern as webhooks.test.ts
// ---------------------------------------------------------------------------

function flattenDrizzleSql(chunks: unknown[]): { sql: string; params: unknown[] } {
  let sqlStr = '';
  const params: unknown[] = [];

  for (const chunk of chunks) {
    if (chunk && typeof chunk === 'object' && 'queryChunks' in chunk) {
      const nested = flattenDrizzleSql((chunk as { queryChunks: unknown[] }).queryChunks);
      sqlStr += nested.sql;
      params.push(...nested.params);
    } else if (chunk && typeof chunk === 'object' && 'value' in chunk) {
      sqlStr += (chunk as { value: string[] }).value.join('');
    } else {
      params.push(chunk);
      sqlStr += `$${params.length}`;
    }
  }

  return { sql: sqlStr, params };
}

function extractQuery(query: unknown): { sql: string; params: unknown[] } {
  if (query && typeof query === 'object' && 'queryChunks' in query) {
    return flattenDrizzleSql((query as { queryChunks: unknown[] }).queryChunks);
  }
  if (query && typeof query === 'object' && 'sql' in query) {
    return query as { sql: string; params: unknown[] };
  }
  return { sql: '', params: [] };
}

// ---------------------------------------------------------------------------
// Mock data factories
// ---------------------------------------------------------------------------

function agentCountRows() {
  return [
    { status: 'online', count: 5 },
    { status: 'offline', count: 2 },
    { status: 'running', count: 3 },
  ];
}

function runCountRows() {
  return [
    { status: 'running', count: 3 },
    { status: 'completed', count: 120 },
    { status: 'error', count: 7 },
    { status: 'success', count: 20 },
  ];
}

function runTotalRows() {
  return [{ total: 150 }];
}

function webhookCountRows() {
  return [{ total: 5, active: 4 }];
}

function recentErrorRows() {
  return [
    {
      agent_id: 'agent-1',
      error_message: 'OOM killed',
      finished_at: '2026-03-01T10:00:00Z',
    },
    {
      agent_id: 'agent-2',
      error_message: 'Timeout exceeded',
      finished_at: '2026-03-01T09:30:00Z',
    },
  ];
}

function agentStatRows() {
  return [
    {
      agent_id: 'agent-1',
      agent_name: 'CodeBot',
      status: 'online',
      total_runs: 45,
      successful_runs: 42,
      avg_duration_ms: 12500,
      total_tokens: 250000,
      total_cost_usd: 12.5,
      last_run_at: '2026-03-01T10:00:00Z',
    },
    {
      agent_id: 'agent-2',
      agent_name: 'TestRunner',
      status: 'offline',
      total_runs: 10,
      successful_runs: 8,
      avg_duration_ms: 5000,
      total_tokens: 50000,
      total_cost_usd: 3.25,
      last_run_at: '2026-02-28T15:00:00Z',
    },
  ];
}

function toolUsageRows() {
  return [
    { tool_name: 'Read', count: 5000, avg_duration_ms: 50 },
    { tool_name: 'Write', count: 3000, avg_duration_ms: 120 },
    { tool_name: 'Bash', count: 1500, avg_duration_ms: 2000 },
  ];
}

function topAgentsByToolUseRows() {
  return [
    { agent_id: 'agent-1', total_tool_calls: 7000 },
    { agent_id: 'agent-2', total_tool_calls: 3500 },
  ];
}

function costTotalRows(cost = 125.0) {
  return [{ total_cost_usd: cost }];
}

function costByAgentRows() {
  return [
    { agent_id: 'agent-1', cost_usd: 50.0 },
    { agent_id: 'agent-2', cost_usd: 75.0 },
  ];
}

function costByProviderRows() {
  return [
    { provider: 'anthropic', cost_usd: 100.0 },
    { provider: 'bedrock', cost_usd: 25.0 },
  ];
}

// ---------------------------------------------------------------------------
// Mock database — routes through SQL pattern matching
// ---------------------------------------------------------------------------

function createMockDb() {
  const db = {
    execute: vi.fn(async (query: unknown) => {
      const { sql: sqlStr } = extractQuery(query);
      const normalised = sqlStr.replace(/\s+/g, ' ').trim();

      // --- Overview queries ---
      if (normalised.includes('FROM agents GROUP BY status')) {
        return { rows: agentCountRows() };
      }
      if (
        normalised.includes('COUNT(*)::int AS total FROM agent_runs') &&
        !normalised.includes('GROUP BY')
      ) {
        return { rows: runTotalRows() };
      }
      if (normalised.includes('FROM agent_runs GROUP BY status')) {
        return { rows: runCountRows() };
      }
      if (normalised.includes('FROM webhook_subscriptions')) {
        return { rows: webhookCountRows() };
      }
      if (normalised.includes("status = 'error'") && normalised.includes('ORDER BY finished_at')) {
        return { rows: recentErrorRows() };
      }

      // --- Agent stats ---
      if (normalised.includes('FROM agents a') && normalised.includes('LEFT JOIN agent_runs')) {
        return { rows: agentStatRows() };
      }

      // --- Tool usage ---
      if (normalised.includes('FROM agent_actions') && normalised.includes('GROUP BY tool_name')) {
        return { rows: toolUsageRows() };
      }
      if (normalised.includes('FROM agent_actions') && normalised.includes('GROUP BY agent_id')) {
        return { rows: topAgentsByToolUseRows() };
      }

      // --- Cost summary ---
      if (
        normalised.includes('SUM(cost_usd)') &&
        normalised.includes('AS total_cost_usd') &&
        !normalised.includes('GROUP BY')
      ) {
        return { rows: costTotalRows() };
      }
      if (normalised.includes('SUM(cost_usd)') && normalised.includes('GROUP BY agent_id')) {
        return { rows: costByAgentRows() };
      }
      if (normalised.includes('SUM(cost_usd)') && normalised.includes('GROUP BY provider')) {
        return { rows: costByProviderRows() };
      }

      return { rows: [] };
    }),
  };

  return db;
}

// ---------------------------------------------------------------------------
// Mock DbAgentRegistry (unused by dashboard routes but required by type)
// ---------------------------------------------------------------------------

const mockDbRegistry = {} as unknown as DbAgentRegistry;

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------

async function buildApp(mockDb: ReturnType<typeof createMockDb>): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(dashboardRoutes, {
    prefix: '/api/dashboard',
    db: mockDb as never,
    dbRegistry: mockDbRegistry,
  });
  await app.ready();
  return app;
}

// =============================================================================
// GET /api/dashboard/overview
// =============================================================================

describe('Dashboard routes — /api/dashboard', () => {
  let app: FastifyInstance;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeAll(async () => {
    mockDb = createMockDb();
    app = await buildApp(mockDb);
  });

  afterAll(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // GET /api/dashboard/overview
  // -------------------------------------------------------------------------

  describe('GET /api/dashboard/overview', () => {
    it('returns 200 with agent counts', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/dashboard/overview',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.agents).toBeDefined();
      expect(body.agents.total).toBe(10);
      expect(body.agents.online).toBe(8);
      expect(body.agents.offline).toBe(2);
    });

    it('returns run counts including active, completed, and failed', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/dashboard/overview',
      });

      const body = response.json();
      expect(body.runs).toBeDefined();
      expect(body.runs.total).toBe(150);
      expect(body.runs.active).toBe(3);
      expect(body.runs.completed).toBe(140);
      expect(body.runs.failed).toBe(7);
    });

    it('returns webhook counts', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/dashboard/overview',
      });

      const body = response.json();
      expect(body.webhooks).toBeDefined();
      expect(body.webhooks.total).toBe(5);
      expect(body.webhooks.active).toBe(4);
    });

    it('returns recent errors with agentId, error, and timestamp', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/dashboard/overview',
      });

      const body = response.json();
      expect(body.recentErrors).toBeDefined();
      expect(body.recentErrors).toHaveLength(2);
      expect(body.recentErrors[0]).toEqual({
        agentId: 'agent-1',
        error: 'OOM killed',
        timestamp: '2026-03-01T10:00:00Z',
      });
      expect(body.recentErrors[1]).toEqual({
        agentId: 'agent-2',
        error: 'Timeout exceeded',
        timestamp: '2026-03-01T09:30:00Z',
      });
    });

    it('returns 500 when database query fails', async () => {
      mockDb.execute.mockRejectedValueOnce(new Error('connection lost'));

      const response = await app.inject({
        method: 'GET',
        url: '/api/dashboard/overview',
      });

      expect(response.statusCode).toBe(500);

      const body = response.json();
      expect(body.code).toBe('DASHBOARD_OVERVIEW_ERROR');
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/dashboard/agent-stats
  // -------------------------------------------------------------------------

  describe('GET /api/dashboard/agent-stats', () => {
    it('returns 200 with per-agent statistics', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/dashboard/agent-stats',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.stats).toBeDefined();
      expect(Array.isArray(body.stats)).toBe(true);
    });

    it('returns correct fields for each agent', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/dashboard/agent-stats',
      });

      const body = response.json();
      const first = body.stats[0];

      expect(first.agentId).toBe('agent-1');
      expect(first.agentName).toBe('CodeBot');
      expect(first.status).toBe('online');
      expect(first.totalRuns).toBe(45);
      expect(first.avgDurationMs).toBe(12500);
      expect(first.totalTokens).toBe(250000);
      expect(first.totalCostUsd).toBe(12.5);
      expect(first.lastRunAt).toBe('2026-03-01T10:00:00Z');
    });

    it('calculates success rate correctly', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/dashboard/agent-stats',
      });

      const body = response.json();
      const first = body.stats[0];

      // 42 / 45 = 0.9333...
      expect(first.successRate).toBeCloseTo(0.9333, 2);
    });

    it('returns success rate as 0 for agents with no runs', async () => {
      mockDb.execute.mockResolvedValueOnce({
        rows: [
          {
            agent_id: 'agent-idle',
            agent_name: 'IdleBot',
            status: 'registered',
            total_runs: 0,
            successful_runs: 0,
            avg_duration_ms: null,
            total_tokens: null,
            total_cost_usd: null,
            last_run_at: null,
          },
        ],
      } as never);

      const response = await app.inject({
        method: 'GET',
        url: '/api/dashboard/agent-stats',
      });

      const body = response.json();
      expect(body.stats[0].successRate).toBe(0);
      expect(body.stats[0].totalTokens).toBe(0);
      expect(body.stats[0].totalCostUsd).toBe(0);
      expect(body.stats[0].avgDurationMs).toBe(0);
      expect(body.stats[0].lastRunAt).toBeNull();
    });

    it('returns multiple agent stats sorted by total runs', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/dashboard/agent-stats',
      });

      const body = response.json();
      expect(body.stats).toHaveLength(2);
      expect(body.stats[0].totalRuns).toBeGreaterThanOrEqual(body.stats[1].totalRuns);
    });

    it('returns 500 when database query fails', async () => {
      mockDb.execute.mockRejectedValueOnce(new Error('query timeout'));

      const response = await app.inject({
        method: 'GET',
        url: '/api/dashboard/agent-stats',
      });

      expect(response.statusCode).toBe(500);

      const body = response.json();
      expect(body.code).toBe('DASHBOARD_AGENT_STATS_ERROR');
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/dashboard/tool-usage
  // -------------------------------------------------------------------------

  describe('GET /api/dashboard/tool-usage', () => {
    it('returns 200 with tool usage data', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/dashboard/tool-usage',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.tools).toBeDefined();
      expect(Array.isArray(body.tools)).toBe(true);
    });

    it('returns tool name, count, and avgDurationMs', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/dashboard/tool-usage',
      });

      const body = response.json();
      expect(body.tools).toHaveLength(3);
      expect(body.tools[0]).toEqual({ tool: 'Read', count: 5000, avgDurationMs: 50 });
      expect(body.tools[1]).toEqual({ tool: 'Write', count: 3000, avgDurationMs: 120 });
      expect(body.tools[2]).toEqual({ tool: 'Bash', count: 1500, avgDurationMs: 2000 });
    });

    it('returns top agents by tool use', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/dashboard/tool-usage',
      });

      const body = response.json();
      expect(body.topAgentsByToolUse).toBeDefined();
      expect(body.topAgentsByToolUse).toHaveLength(2);
      expect(body.topAgentsByToolUse[0]).toEqual({
        agentId: 'agent-1',
        totalToolCalls: 7000,
      });
    });

    it('returns 500 when database query fails', async () => {
      mockDb.execute.mockRejectedValueOnce(new Error('connection refused'));

      const response = await app.inject({
        method: 'GET',
        url: '/api/dashboard/tool-usage',
      });

      expect(response.statusCode).toBe(500);

      const body = response.json();
      expect(body.code).toBe('DASHBOARD_TOOL_USAGE_ERROR');
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/dashboard/cost-summary
  // -------------------------------------------------------------------------

  describe('GET /api/dashboard/cost-summary', () => {
    it('returns 200 with cost summary for default 7d period', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/dashboard/cost-summary',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.period).toBe('7d');
      expect(body.totalCostUsd).toBe(125.0);
    });

    it('returns cost breakdown by agent', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/dashboard/cost-summary',
      });

      const body = response.json();
      expect(body.byAgent).toBeDefined();
      expect(body.byAgent).toHaveLength(2);
      expect(body.byAgent[0]).toEqual({ agentId: 'agent-1', costUsd: 50.0 });
      expect(body.byAgent[1]).toEqual({ agentId: 'agent-2', costUsd: 75.0 });
    });

    it('returns cost breakdown by provider', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/dashboard/cost-summary',
      });

      const body = response.json();
      expect(body.byProvider).toBeDefined();
      expect(body.byProvider).toHaveLength(2);
      expect(body.byProvider[0]).toEqual({ provider: 'anthropic', costUsd: 100.0 });
      expect(body.byProvider[1]).toEqual({ provider: 'bedrock', costUsd: 25.0 });
    });

    it('accepts period=1d query parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/dashboard/cost-summary?period=1d',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.period).toBe('1d');
    });

    it('accepts period=30d query parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/dashboard/cost-summary?period=30d',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.period).toBe('30d');
    });

    it('accepts period=90d query parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/dashboard/cost-summary?period=90d',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.period).toBe('90d');
    });

    it('returns 400 for invalid period', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/dashboard/cost-summary?period=2w',
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.code).toBe('INVALID_PERIOD');
      expect(body.error).toContain('2w');
    });

    it('returns 400 for another invalid period value', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/dashboard/cost-summary?period=365d',
      });

      expect(response.statusCode).toBe(400);

      const body = response.json();
      expect(body.code).toBe('INVALID_PERIOD');
    });

    it('returns 500 when database query fails', async () => {
      mockDb.execute.mockRejectedValueOnce(new Error('disk full'));

      const response = await app.inject({
        method: 'GET',
        url: '/api/dashboard/cost-summary',
      });

      expect(response.statusCode).toBe(500);

      const body = response.json();
      expect(body.code).toBe('DASHBOARD_COST_SUMMARY_ERROR');
    });
  });
});

// =============================================================================
// Empty data scenarios
// =============================================================================

describe('Dashboard routes — empty data', () => {
  let app: FastifyInstance;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeAll(async () => {
    mockDb = createMockDb();
    app = await buildApp(mockDb);
  });

  beforeEach(() => {
    // Override all queries to return empty rows
    mockDb.execute.mockImplementation(async () => ({ rows: [] }));
  });

  afterAll(async () => {
    await app.close();
  });

  it('overview returns zeroed counts when no data exists', async () => {
    // The overview runs 5 parallel queries. We need to return empty/default for each.
    mockDb.execute
      .mockResolvedValueOnce({ rows: [] } as never) // agent counts
      .mockResolvedValueOnce({ rows: [{ total: 0 }] } as never) // run total
      .mockResolvedValueOnce({ rows: [] } as never) // run counts
      .mockResolvedValueOnce({ rows: [{ total: 0, active: 0 }] } as never) // webhook counts
      .mockResolvedValueOnce({ rows: [] } as never); // recent errors

    const response = await app.inject({
      method: 'GET',
      url: '/api/dashboard/overview',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.agents.total).toBe(0);
    expect(body.agents.online).toBe(0);
    expect(body.agents.offline).toBe(0);
    expect(body.runs.total).toBe(0);
    expect(body.runs.active).toBe(0);
    expect(body.runs.completed).toBe(0);
    expect(body.runs.failed).toBe(0);
    expect(body.webhooks.total).toBe(0);
    expect(body.webhooks.active).toBe(0);
    expect(body.recentErrors).toEqual([]);
  });

  it('agent-stats returns empty array when no agents exist', async () => {
    mockDb.execute.mockResolvedValueOnce({ rows: [] });

    const response = await app.inject({
      method: 'GET',
      url: '/api/dashboard/agent-stats',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.stats).toEqual([]);
  });

  it('tool-usage returns empty arrays when no actions exist', async () => {
    mockDb.execute
      .mockResolvedValueOnce({ rows: [] }) // tool usage
      .mockResolvedValueOnce({ rows: [] }); // top agents

    const response = await app.inject({
      method: 'GET',
      url: '/api/dashboard/tool-usage',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.tools).toEqual([]);
    expect(body.topAgentsByToolUse).toEqual([]);
  });

  it('cost-summary returns zero cost when no runs exist', async () => {
    mockDb.execute
      .mockResolvedValueOnce({ rows: [{ total_cost_usd: 0 }] }) // total
      .mockResolvedValueOnce({ rows: [] }) // by agent
      .mockResolvedValueOnce({ rows: [] }); // by provider

    const response = await app.inject({
      method: 'GET',
      url: '/api/dashboard/cost-summary',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.totalCostUsd).toBe(0);
    expect(body.byAgent).toEqual([]);
    expect(body.byProvider).toEqual([]);
  });

  it('cost-summary returns 0 when total row is missing', async () => {
    mockDb.execute
      .mockResolvedValueOnce({ rows: [] }) // total — empty
      .mockResolvedValueOnce({ rows: [] }) // by agent
      .mockResolvedValueOnce({ rows: [] }); // by provider

    const response = await app.inject({
      method: 'GET',
      url: '/api/dashboard/cost-summary',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.totalCostUsd).toBe(0);
  });
});

// =============================================================================
// Nonexistent routes
// =============================================================================

describe('Dashboard routes — nonexistent endpoints', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const mockDb = createMockDb();
    app = await buildApp(mockDb);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 404 for unknown dashboard sub-path', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/dashboard/nonexistent',
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns 404 for POST to overview (method not allowed)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/dashboard/overview',
      payload: {},
    });

    expect(response.statusCode).toBe(404);
  });
});
