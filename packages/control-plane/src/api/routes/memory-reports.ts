// ---------------------------------------------------------------------------
// GET  /api/memory/reports            — list previously generated reports
// POST /api/memory/reports/generate   — generate a new memory report
//
// Reports are generated using SQL aggregation against memory_facts and
// memory_edges. No LLM calls — fast and deterministic.
//
// Generated reports are stored in an in-memory Map with LRU-style eviction
// (max 100 entries). Reports are ephemeral — no DB table needed.
// ---------------------------------------------------------------------------

import * as crypto from 'node:crypto';

import type { FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';
import type { Logger } from 'pino';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MemoryReportType = 'project-progress' | 'knowledge-health' | 'activity-digest';
type MemoryReportTimeRange = 'last-7d' | 'last-30d' | 'last-90d' | 'all-time';

type GeneratedMemoryReport = {
  id: string;
  reportType: MemoryReportType;
  scope: string | null;
  timeRange: MemoryReportTimeRange;
  markdown: string;
  generatedAt: string;
};

export type MemoryReportsRoutesOptions = {
  pool: Pool;
  logger: Logger;
};

const VALID_REPORT_TYPES: ReadonlySet<string> = new Set([
  'project-progress',
  'knowledge-health',
  'activity-digest',
]);

const VALID_TIME_RANGES: ReadonlySet<string> = new Set([
  'last-7d',
  'last-30d',
  'last-90d',
  'all-time',
]);

const MAX_STORED_REPORTS = 100;

// ---------------------------------------------------------------------------
// In-memory report cache (module-level, LRU-style eviction)
// ---------------------------------------------------------------------------

const reportCache = new Map<string, GeneratedMemoryReport>();

/** Ordered list of report IDs, newest first. Used for LRU eviction and listing. */
let reportOrder: readonly string[] = [];

function storeReport(report: GeneratedMemoryReport): void {
  // Evict oldest entries if at capacity
  if (reportCache.size >= MAX_STORED_REPORTS && !reportCache.has(report.id)) {
    const oldest = reportOrder[reportOrder.length - 1];
    if (oldest) {
      reportCache.delete(oldest);
      reportOrder = reportOrder.filter((id) => id !== oldest);
    }
  }

  reportCache.set(report.id, report);
  // Prepend new report to the front (newest first)
  reportOrder = [report.id, ...reportOrder.filter((id) => id !== report.id)];
}

/** Reset cache — exported for test isolation only. */
export function resetReportCacheForTest(): void {
  reportCache.clear();
  reportOrder = [];
}

// ---------------------------------------------------------------------------
// Time range helpers
// ---------------------------------------------------------------------------

function timeRangeToInterval(range: MemoryReportTimeRange): string | null {
  switch (range) {
    case 'last-7d':
      return '7 days';
    case 'last-30d':
      return '30 days';
    case 'last-90d':
      return '90 days';
    case 'all-time':
      return null;
  }
}

// ---------------------------------------------------------------------------
// Report generators
// ---------------------------------------------------------------------------

async function generateProjectProgress(
  pool: Pool,
  scope: string | null,
  timeRange: MemoryReportTimeRange,
): Promise<string> {
  const interval = timeRangeToInterval(timeRange);
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (scope) {
    conditions.push(`scope = $${paramIdx}`);
    params.push(scope);
    paramIdx++;
  }
  if (interval) {
    conditions.push(`created_at >= NOW() - $${paramIdx}::interval`);
    params.push(interval);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await pool.query<{
    entity_type: string;
    fact_count: string;
    earliest: string | null;
    latest: string | null;
  }>(
    `SELECT entity_type,
            COUNT(*)::text AS fact_count,
            MIN(created_at)::text AS earliest,
            MAX(created_at)::text AS latest
     FROM memory_facts
     ${whereClause}
     GROUP BY entity_type
     ORDER BY COUNT(*) DESC`,
    params,
  );

  const totalFacts = result.rows.reduce((sum, row) => sum + Number(row.fact_count), 0);
  const scopeLabel = scope ?? 'all scopes';
  const lines: string[] = [
    `# Project Progress Report`,
    ``,
    `**Scope:** ${scopeLabel}  `,
    `**Time range:** ${timeRange}  `,
    `**Total facts:** ${totalFacts}`,
    ``,
    `## Facts by Entity Type`,
    ``,
    `| Entity Type | Count | Earliest | Latest |`,
    `|-------------|-------|----------|--------|`,
  ];

  for (const row of result.rows) {
    const earliest = row.earliest ? row.earliest.slice(0, 10) : '-';
    const latest = row.latest ? row.latest.slice(0, 10) : '-';
    lines.push(`| ${row.entity_type} | ${row.fact_count} | ${earliest} | ${latest} |`);
  }

  if (result.rows.length === 0) {
    lines.push(`| _(no facts found)_ | - | - | - |`);
  }

  return lines.join('\n');
}

async function generateKnowledgeHealth(
  pool: Pool,
  scope: string | null,
  timeRange: MemoryReportTimeRange,
): Promise<string> {
  const interval = timeRangeToInterval(timeRange);
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (scope) {
    conditions.push(`f.scope = $${paramIdx}`);
    params.push(scope);
    paramIdx++;
  }
  if (interval) {
    conditions.push(`f.created_at >= NOW() - $${paramIdx}::interval`);
    params.push(interval);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Total facts + average confidence
  const statsResult = await pool.query<{
    total_facts: string;
    avg_confidence: string | null;
  }>(
    `SELECT COUNT(*)::text AS total_facts,
            ROUND(AVG(f.confidence::numeric), 3)::text AS avg_confidence
     FROM memory_facts f
     ${whereClause}`,
    params,
  );

  const totalFacts = Number(statsResult.rows[0]?.total_facts ?? 0);
  const avgConfidence = statsResult.rows[0]?.avg_confidence ?? 'N/A';

  // Stale facts (not accessed in 30+ days)
  const staleConditions = [...conditions, `f.accessed_at < NOW() - INTERVAL '30 days'`];
  const staleWhere = staleConditions.length > 0 ? `WHERE ${staleConditions.join(' AND ')}` : '';

  const staleResult = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM memory_facts f ${staleWhere}`,
    params,
  );
  const staleCount = Number(staleResult.rows[0]?.cnt ?? 0);

  // Orphan facts (no edges)
  const orphanConditions = [...conditions];
  const orphanWhere = orphanConditions.length > 0 ? `WHERE ${orphanConditions.join(' AND ')}` : '';

  const orphanResult = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
     FROM memory_facts f
     ${orphanWhere ? `${orphanWhere} AND` : 'WHERE'}
       f.id NOT IN (SELECT source_fact_id FROM memory_edges)
       AND f.id NOT IN (SELECT target_fact_id FROM memory_edges)`,
    params,
  );
  const orphanCount = Number(orphanResult.rows[0]?.cnt ?? 0);

  // Total edges
  const edgeResult = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM memory_edges`,
  );
  const totalEdges = Number(edgeResult.rows[0]?.cnt ?? 0);

  const scopeLabel = scope ?? 'all scopes';
  const lines: string[] = [
    `# Knowledge Health Report`,
    ``,
    `**Scope:** ${scopeLabel}  `,
    `**Time range:** ${timeRange}`,
    ``,
    `## Summary`,
    ``,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total facts | ${totalFacts} |`,
    `| Avg confidence | ${avgConfidence} |`,
    `| Stale facts (>30d unaccessed) | ${staleCount} |`,
    `| Orphan facts (no edges) | ${orphanCount} |`,
    `| Total edges | ${totalEdges} |`,
    ``,
    `## Health Score`,
    ``,
  ];

  if (totalFacts > 0) {
    const staleRatio = staleCount / totalFacts;
    const orphanRatio = orphanCount / totalFacts;
    const healthScore = Math.max(0, Math.round((1 - staleRatio * 0.5 - orphanRatio * 0.5) * 100));
    lines.push(`**Score: ${healthScore}/100**`);
    if (staleRatio > 0.3) {
      lines.push(`- Warning: ${(staleRatio * 100).toFixed(0)}% of facts are stale`);
    }
    if (orphanRatio > 0.5) {
      lines.push(`- Warning: ${(orphanRatio * 100).toFixed(0)}% of facts have no edges`);
    }
  } else {
    lines.push(`_No facts found in the selected scope/time range._`);
  }

  return lines.join('\n');
}

async function generateActivityDigest(
  pool: Pool,
  scope: string | null,
  timeRange: MemoryReportTimeRange,
): Promise<string> {
  const interval = timeRangeToInterval(timeRange);
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (scope) {
    conditions.push(`scope = $${paramIdx}`);
    params.push(scope);
    paramIdx++;
  }
  if (interval) {
    conditions.push(`created_at >= NOW() - $${paramIdx}::interval`);
    params.push(interval);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Recent facts
  const recentResult = await pool.query<{
    id: string;
    scope: string;
    entity_type: string;
    content: string;
    created_at: string;
  }>(
    `SELECT id, scope, entity_type, content, created_at::text
     FROM memory_facts
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT 50`,
    params,
  );

  // Daily counts
  const dailyResult = await pool.query<{
    day: string;
    cnt: string;
  }>(
    `SELECT created_at::date::text AS day, COUNT(*)::text AS cnt
     FROM memory_facts
     ${whereClause}
     GROUP BY created_at::date
     ORDER BY created_at::date DESC
     LIMIT 30`,
    params,
  );

  const scopeLabel = scope ?? 'all scopes';
  const lines: string[] = [
    `# Activity Digest`,
    ``,
    `**Scope:** ${scopeLabel}  `,
    `**Time range:** ${timeRange}`,
    ``,
    `## Daily Activity`,
    ``,
    `| Date | Facts Created |`,
    `|------|---------------|`,
  ];

  for (const row of dailyResult.rows) {
    lines.push(`| ${row.day} | ${row.cnt} |`);
  }

  if (dailyResult.rows.length === 0) {
    lines.push(`| _(no activity)_ | - |`);
  }

  lines.push(``, `## Recent Facts (up to 50)`, ``);

  for (const row of recentResult.rows) {
    const date = row.created_at ? row.created_at.slice(0, 10) : 'unknown';
    const truncated = row.content.length > 120 ? `${row.content.slice(0, 120)}...` : row.content;
    lines.push(`- **[${row.entity_type}]** ${truncated} _(${date}, ${row.scope})_`);
  }

  if (recentResult.rows.length === 0) {
    lines.push(`_No recent facts found._`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const memoryReportsRoutes: FastifyPluginAsync<MemoryReportsRoutesOptions> = async (
  app,
  opts,
) => {
  const { pool, logger } = opts;

  // GET / — list previously generated reports
  app.get<{
    Querystring: { reportType?: string; scope?: string; limit?: string };
  }>(
    '/',
    {
      schema: {
        tags: ['memory'],
        summary: 'List previously generated memory reports',
        querystring: {
          type: 'object',
          properties: {
            reportType: { type: 'string' },
            scope: { type: 'string' },
            limit: { type: 'string' },
          },
        },
      },
    },
    async (request) => {
      const { reportType, scope, limit: limitStr } = request.query;
      const limit = limitStr ? Math.min(Math.max(Number(limitStr), 1), 100) : 20;

      let reports = reportOrder
        .map((id) => reportCache.get(id))
        .filter((r): r is GeneratedMemoryReport => r !== undefined);

      if (reportType && VALID_REPORT_TYPES.has(reportType)) {
        reports = reports.filter((r) => r.reportType === reportType);
      }
      if (scope) {
        reports = reports.filter((r) => r.scope === scope);
      }

      const total = reports.length;
      const sliced = reports.slice(0, limit);

      return { ok: true, reports: sliced, total };
    },
  );

  // POST /generate — generate a new memory report
  app.post<{
    Body: { reportType?: string; scope?: string; timeRange?: string };
  }>(
    '/generate',
    {
      schema: {
        tags: ['memory'],
        summary: 'Generate a memory report from facts and edges',
        body: {
          type: 'object',
          properties: {
            reportType: { type: 'string' },
            scope: { type: 'string' },
            timeRange: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { reportType, scope, timeRange: rawTimeRange } = request.body ?? {};

      // Validate reportType
      if (!reportType || !VALID_REPORT_TYPES.has(reportType)) {
        return reply.status(400).send({
          ok: false,
          error: 'INVALID_REPORT_TYPE',
          message: `reportType must be one of: ${[...VALID_REPORT_TYPES].join(', ')}`,
        });
      }

      // Default timeRange to 'last-30d'
      const timeRange: MemoryReportTimeRange =
        rawTimeRange && VALID_TIME_RANGES.has(rawTimeRange)
          ? (rawTimeRange as MemoryReportTimeRange)
          : 'last-30d';

      const resolvedScope = typeof scope === 'string' && scope.length > 0 ? scope : null;

      logger.info({ reportType, scope: resolvedScope, timeRange }, 'generating memory report');

      let markdown: string;
      try {
        switch (reportType as MemoryReportType) {
          case 'project-progress':
            markdown = await generateProjectProgress(pool, resolvedScope, timeRange);
            break;
          case 'knowledge-health':
            markdown = await generateKnowledgeHealth(pool, resolvedScope, timeRange);
            break;
          case 'activity-digest':
            markdown = await generateActivityDigest(pool, resolvedScope, timeRange);
            break;
        }
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : 'Unknown error during report generation';
        logger.error(
          { err, reportType, scope: resolvedScope, timeRange },
          'report generation failed',
        );
        return reply.status(500).send({
          ok: false,
          error: 'REPORT_GENERATION_FAILED',
          message,
        });
      }

      const report: GeneratedMemoryReport = {
        id: crypto.randomUUID(),
        reportType: reportType as MemoryReportType,
        scope: resolvedScope,
        timeRange,
        markdown,
        generatedAt: new Date().toISOString(),
      };

      storeReport(report);

      logger.info(
        { reportId: report.id, reportType, scope: resolvedScope },
        'memory report generated',
      );

      return { ok: true, report };
    },
  );
};
