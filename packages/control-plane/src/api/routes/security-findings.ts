import { ControlPlaneError } from '@agentctl/shared';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import type { Database } from '../../db/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SecurityFindingsRoutesOptions = {
  db: Database;
};

const VALID_SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
type Severity = (typeof VALID_SEVERITIES)[number];

type SecurityFinding = {
  id: string;
  severity: Severity;
  category: string;
  title: string;
  description: string;
  file?: string;
  line?: number;
  recommendation: string;
};

type IngestBody = {
  agentId: string;
  runId: string;
  findings: SecurityFinding[];
};

type FindingsQuerystring = {
  severity?: string;
  category?: string;
  limit?: string;
  offset?: string;
  agentId?: string;
};

type AcknowledgeBody = {
  acknowledgedBy: string;
  reason?: string;
};

type GithubIssuesBody = {
  owner: string;
  repo: string;
  labels?: string[];
};

type SecurityFindingRow = {
  id: string;
  agent_id: string;
  run_id: string;
  severity: string;
  category: string;
  title: string;
  description: string;
  file: string | null;
  line: number | null;
  recommendation: string;
  acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledge_reason: string | null;
  issue_created: boolean;
  created_at: string;
};

type CountRow = {
  count: number;
};

type SeverityCountRow = {
  severity: string;
  count: number;
};

type CategoryCountRow = {
  category: string;
  count: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidSeverity(value: string): value is Severity {
  return (VALID_SEVERITIES as readonly string[]).includes(value);
}

const MAX_BATCH_SIZE = 500;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

function formatFinding(row: SecurityFindingRow): Record<string, unknown> {
  return {
    id: row.id,
    agentId: row.agent_id,
    runId: row.run_id,
    severity: row.severity,
    category: row.category,
    title: row.title,
    description: row.description,
    file: row.file,
    line: row.line,
    recommendation: row.recommendation,
    acknowledged: row.acknowledged,
    acknowledgedBy: row.acknowledged_by,
    acknowledgeReason: row.acknowledge_reason,
    issueCreated: row.issue_created,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const securityFindingsRoutes: FastifyPluginAsync<SecurityFindingsRoutesOptions> = async (
  app,
  opts,
) => {
  const { db } = opts;

  // -------------------------------------------------------------------------
  // POST /findings — Ingest security findings
  // -------------------------------------------------------------------------

  app.post<{ Body: IngestBody }>('/findings', async (request, reply) => {
    const { agentId, runId, findings } = request.body;

    if (!agentId || typeof agentId !== 'string') {
      return reply.code(400).send({
        error: 'A non-empty "agentId" string is required',
        code: 'INVALID_AGENT_ID',
      });
    }

    if (!runId || typeof runId !== 'string') {
      return reply.code(400).send({
        error: 'A non-empty "runId" string is required',
        code: 'INVALID_RUN_ID',
      });
    }

    if (!Array.isArray(findings) || findings.length === 0) {
      return reply.code(400).send({
        error: 'A non-empty "findings" array is required',
        code: 'INVALID_FINDINGS',
      });
    }

    if (findings.length > MAX_BATCH_SIZE) {
      return reply.code(400).send({
        error: `Batch size ${findings.length} exceeds maximum of ${MAX_BATCH_SIZE}`,
        code: 'BATCH_SIZE_EXCEEDED',
      });
    }

    // Validate each finding
    for (const finding of findings) {
      if (!finding.id || typeof finding.id !== 'string') {
        return reply.code(400).send({
          error: 'Each finding must have a non-empty "id" string',
          code: 'INVALID_FINDING_ID',
        });
      }

      if (!finding.severity || !isValidSeverity(finding.severity)) {
        return reply.code(400).send({
          error: `Invalid severity "${finding.severity}". Must be one of: ${VALID_SEVERITIES.join(', ')}`,
          code: 'INVALID_SEVERITY',
        });
      }

      if (!finding.category || typeof finding.category !== 'string') {
        return reply.code(400).send({
          error: 'Each finding must have a non-empty "category" string',
          code: 'INVALID_CATEGORY',
        });
      }

      if (!finding.title || typeof finding.title !== 'string') {
        return reply.code(400).send({
          error: 'Each finding must have a non-empty "title" string',
          code: 'INVALID_TITLE',
        });
      }

      if (!finding.description || typeof finding.description !== 'string') {
        return reply.code(400).send({
          error: 'Each finding must have a non-empty "description" string',
          code: 'INVALID_DESCRIPTION',
        });
      }

      if (!finding.recommendation || typeof finding.recommendation !== 'string') {
        return reply.code(400).send({
          error: 'Each finding must have a non-empty "recommendation" string',
          code: 'INVALID_RECOMMENDATION',
        });
      }
    }

    try {
      let criticalCount = 0;
      let highCount = 0;

      for (const finding of findings) {
        const now = new Date();
        await db.execute(
          sql`INSERT INTO security_findings (id, agent_id, run_id, severity, category, title, description, file, line, recommendation, acknowledged, acknowledged_by, acknowledge_reason, issue_created, created_at)
              VALUES (${finding.id}, ${agentId}, ${runId}, ${finding.severity}, ${finding.category}, ${finding.title}, ${finding.description}, ${finding.file ?? null}, ${finding.line ?? null}, ${finding.recommendation}, ${false}, ${null}, ${null}, ${false}, ${now})`,
        );

        if (finding.severity === 'critical') {
          criticalCount++;
        }
        if (finding.severity === 'high') {
          highCount++;
        }
      }

      return {
        ok: true,
        ingested: findings.length,
        criticalCount,
        highCount,
      };
    } catch (error: unknown) {
      if (error instanceof ControlPlaneError) {
        return reply.code(502).send({ error: error.message, code: error.code });
      }
      return reply.code(500).send({
        error: 'Failed to ingest security findings',
        code: 'FINDINGS_INGEST_FAILED',
      });
    }
  });

  // -------------------------------------------------------------------------
  // GET /findings — List security findings with filters
  // -------------------------------------------------------------------------

  app.get<{ Querystring: FindingsQuerystring }>('/findings', async (request, reply) => {
    const { severity, category, limit: limitStr, offset: offsetStr, agentId } = request.query;

    // Validate severity filter
    if (severity !== undefined && !isValidSeverity(severity)) {
      return reply.code(400).send({
        error: `Invalid severity "${severity}". Must be one of: ${VALID_SEVERITIES.join(', ')}`,
        code: 'INVALID_SEVERITY',
      });
    }

    // Validate limit
    let limit = DEFAULT_LIMIT;
    if (limitStr !== undefined) {
      const parsed = Number(limitStr);
      if (!Number.isFinite(parsed) || parsed < 1) {
        return reply.code(400).send({
          error: '"limit" must be a positive integer',
          code: 'INVALID_LIMIT',
        });
      }
      limit = Math.min(Math.floor(parsed), MAX_LIMIT);
    }

    // Validate offset
    let offset = 0;
    if (offsetStr !== undefined) {
      const parsed = Number(offsetStr);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return reply.code(400).send({
          error: '"offset" must be a non-negative integer',
          code: 'INVALID_OFFSET',
        });
      }
      offset = Math.floor(parsed);
    }

    try {
      // Build WHERE clauses
      const conditions: ReturnType<typeof sql>[] = [];

      if (severity !== undefined) {
        conditions.push(sql`severity = ${severity}`);
      }
      if (category !== undefined) {
        conditions.push(sql`category = ${category}`);
      }
      if (agentId !== undefined) {
        conditions.push(sql`agent_id = ${agentId}`);
      }

      let whereClause: ReturnType<typeof sql>;
      if (conditions.length > 0) {
        whereClause = sql`WHERE ${sql.join(conditions, sql` AND `)}`;
      } else {
        whereClause = sql``;
      }

      const [findingsResult, countResult] = await Promise.all([
        db.execute(
          sql`SELECT * FROM security_findings ${whereClause} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
        ),
        db.execute(sql`SELECT COUNT(*)::int AS count FROM security_findings ${whereClause}`),
      ]);

      const rows = findingsResult.rows as unknown as SecurityFindingRow[];
      const total = (countResult.rows as unknown as CountRow[])[0]?.count ?? 0;

      return {
        findings: rows.map(formatFinding),
        total,
      };
    } catch (error: unknown) {
      if (error instanceof ControlPlaneError) {
        return reply.code(502).send({ error: error.message, code: error.code });
      }
      return reply.code(500).send({
        error: 'Failed to query security findings',
        code: 'FINDINGS_QUERY_FAILED',
      });
    }
  });

  // -------------------------------------------------------------------------
  // GET /findings/summary — Severity summary
  // -------------------------------------------------------------------------

  app.get('/findings/summary', async (_request, reply) => {
    try {
      const [totalResult, severityResult, categoryResult] = await Promise.all([
        db.execute(sql`SELECT COUNT(*)::int AS count FROM security_findings`),
        db.execute(
          sql`SELECT severity, COUNT(*)::int AS count FROM security_findings GROUP BY severity`,
        ),
        db.execute(
          sql`SELECT category, COUNT(*)::int AS count FROM security_findings GROUP BY category`,
        ),
      ]);

      const total = (totalResult.rows as unknown as CountRow[])[0]?.count ?? 0;
      const severityCounts = severityResult.rows as unknown as SeverityCountRow[];
      const categoryCounts = categoryResult.rows as unknown as CategoryCountRow[];

      const severityMap: Record<string, number> = {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
      };

      for (const row of severityCounts) {
        severityMap[row.severity] = row.count;
      }

      const byCategory: Record<string, number> = {};
      for (const row of categoryCounts) {
        byCategory[row.category] = row.count;
      }

      return {
        total,
        critical: severityMap.critical,
        high: severityMap.high,
        medium: severityMap.medium,
        low: severityMap.low,
        info: severityMap.info,
        byCategory,
      };
    } catch (error: unknown) {
      if (error instanceof ControlPlaneError) {
        return reply.code(502).send({ error: error.message, code: error.code });
      }
      return reply.code(500).send({
        error: 'Failed to get findings summary',
        code: 'FINDINGS_SUMMARY_FAILED',
      });
    }
  });

  // -------------------------------------------------------------------------
  // POST /findings/:id/acknowledge — Acknowledge a finding
  // -------------------------------------------------------------------------

  app.post<{ Params: { id: string }; Body: AcknowledgeBody }>(
    '/findings/:id/acknowledge',
    async (request, reply) => {
      const { id } = request.params;
      const { acknowledgedBy, reason } = request.body;

      if (!acknowledgedBy || typeof acknowledgedBy !== 'string') {
        return reply.code(400).send({
          error: 'A non-empty "acknowledgedBy" string is required',
          code: 'INVALID_ACKNOWLEDGED_BY',
        });
      }

      try {
        const existing = await db.execute(sql`SELECT id FROM security_findings WHERE id = ${id}`);

        if (existing.rows.length === 0) {
          return reply.code(404).send({
            error: `Security finding '${id}' not found`,
            code: 'FINDING_NOT_FOUND',
          });
        }

        await db.execute(
          sql`UPDATE security_findings SET acknowledged = ${true}, acknowledged_by = ${acknowledgedBy}, acknowledge_reason = ${reason ?? null} WHERE id = ${id}`,
        );

        return { ok: true };
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError) {
          return reply.code(502).send({ error: error.message, code: error.code });
        }
        return reply.code(500).send({
          error: 'Failed to acknowledge finding',
          code: 'FINDING_ACKNOWLEDGE_FAILED',
        });
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /findings/github-issues — Create GitHub issues for critical/high
  // -------------------------------------------------------------------------

  app.post<{ Body: GithubIssuesBody }>('/findings/github-issues', async (request, reply) => {
    const { owner, repo, labels } = request.body;

    if (!owner || typeof owner !== 'string') {
      return reply.code(400).send({
        error: 'A non-empty "owner" string is required',
        code: 'INVALID_OWNER',
      });
    }

    if (!repo || typeof repo !== 'string') {
      return reply.code(400).send({
        error: 'A non-empty "repo" string is required',
        code: 'INVALID_REPO',
      });
    }

    if (labels !== undefined && !Array.isArray(labels)) {
      return reply.code(400).send({
        error: '"labels" must be an array of strings',
        code: 'INVALID_LABELS',
      });
    }

    try {
      const result = await db.execute(
        sql`SELECT * FROM security_findings WHERE acknowledged = ${false} AND issue_created = ${false} AND severity IN ('critical', 'high') ORDER BY created_at ASC`,
      );

      const rows = result.rows as unknown as SecurityFindingRow[];

      if (rows.length === 0) {
        return { ok: true, issuesCreated: 0 };
      }

      const githubToken = process.env.GITHUB_TOKEN;
      if (!githubToken) {
        return reply.code(500).send({
          error: 'GITHUB_TOKEN environment variable is not set',
          code: 'GITHUB_TOKEN_MISSING',
        });
      }

      let issuesCreated = 0;

      for (const row of rows) {
        const issueTitle = `[Security] ${row.severity.toUpperCase()}: ${row.title}`;
        const issueBody = [
          `## Security Finding`,
          '',
          `**Severity**: ${row.severity}`,
          `**Category**: ${row.category}`,
          `**Agent**: ${row.agent_id}`,
          `**Run**: ${row.run_id}`,
          row.file ? `**File**: ${row.file}${row.line ? `:${row.line}` : ''}` : '',
          '',
          `### Description`,
          '',
          row.description,
          '',
          `### Recommendation`,
          '',
          row.recommendation,
          '',
          `---`,
          `*Automatically created by AgentCTL Security Audit*`,
        ]
          .filter(Boolean)
          .join('\n');

        const issuePayload: Record<string, unknown> = {
          title: issueTitle,
          body: issueBody,
        };

        if (labels && labels.length > 0) {
          issuePayload.labels = labels;
        }

        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${githubToken}`,
            Accept: 'application/vnd.github+json',
          },
          body: JSON.stringify(issuePayload),
          signal: AbortSignal.timeout(15_000),
        });

        if (response.ok) {
          await db.execute(
            sql`UPDATE security_findings SET issue_created = ${true} WHERE id = ${row.id}`,
          );
          issuesCreated++;
        }
      }

      return { ok: true, issuesCreated };
    } catch (error: unknown) {
      if (error instanceof ControlPlaneError) {
        return reply.code(502).send({ error: error.message, code: error.code });
      }
      return reply.code(500).send({
        error: 'Failed to create GitHub issues',
        code: 'GITHUB_ISSUES_FAILED',
      });
    }
  });
};
