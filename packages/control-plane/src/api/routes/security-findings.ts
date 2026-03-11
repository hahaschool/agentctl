import { ControlPlaneError } from '@agentctl/shared';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { type Database, extractRows } from '../../db/index.js';
import { BATCH_LIMITS, clampLimit, PAGINATION } from '../constants.js';

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

  app.post<{ Body: IngestBody }>(
    '/findings',
    { schema: { tags: ['audit'], summary: 'Ingest security findings from agent scans' } },
    async (request, reply) => {
      const { agentId, runId, findings } = request.body;

      if (!agentId || typeof agentId !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_AGENT_ID',
          message: 'A non-empty "agentId" string is required',
        });
      }

      if (!runId || typeof runId !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_RUN_ID',
          message: 'A non-empty "runId" string is required',
        });
      }

      if (!Array.isArray(findings) || findings.length === 0) {
        return reply.code(400).send({
          error: 'INVALID_FINDINGS',
          message: 'A non-empty "findings" array is required',
        });
      }

      if (findings.length > BATCH_LIMITS.securityFindings) {
        return reply.code(400).send({
          error: 'BATCH_SIZE_EXCEEDED',
          message: `Batch size ${findings.length} exceeds maximum of ${BATCH_LIMITS.securityFindings}`,
        });
      }

      // Validate each finding
      for (const finding of findings) {
        if (!finding.id || typeof finding.id !== 'string') {
          return reply.code(400).send({
            error: 'INVALID_FINDING_ID',
            message: 'Each finding must have a non-empty "id" string',
          });
        }

        if (!finding.severity || !isValidSeverity(finding.severity)) {
          return reply.code(400).send({
            error: 'INVALID_SEVERITY',
            message: `Invalid severity "${finding.severity}". Must be one of: ${VALID_SEVERITIES.join(', ')}`,
          });
        }

        if (!finding.category || typeof finding.category !== 'string') {
          return reply.code(400).send({
            error: 'INVALID_CATEGORY',
            message: 'Each finding must have a non-empty "category" string',
          });
        }

        if (!finding.title || typeof finding.title !== 'string') {
          return reply.code(400).send({
            error: 'INVALID_TITLE',
            message: 'Each finding must have a non-empty "title" string',
          });
        }

        if (!finding.description || typeof finding.description !== 'string') {
          return reply.code(400).send({
            error: 'INVALID_DESCRIPTION',
            message: 'Each finding must have a non-empty "description" string',
          });
        }

        if (!finding.recommendation || typeof finding.recommendation !== 'string') {
          return reply.code(400).send({
            error: 'INVALID_RECOMMENDATION',
            message: 'Each finding must have a non-empty "recommendation" string',
          });
        }

        if (finding.title.length > 500) {
          return reply.code(400).send({
            error: 'TITLE_TOO_LONG',
            message: `Finding "${finding.id}": title must be under 500 characters`,
          });
        }

        if (finding.description.length > 10_000) {
          return reply.code(400).send({
            error: 'DESCRIPTION_TOO_LONG',
            message: `Finding "${finding.id}": description must be under 10,000 characters`,
          });
        }

        if (finding.recommendation.length > 5_000) {
          return reply.code(400).send({
            error: 'RECOMMENDATION_TOO_LONG',
            message: `Finding "${finding.id}": recommendation must be under 5,000 characters`,
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
          return reply.code(502).send({ error: error.code, message: error.message });
        }
        return reply.code(500).send({
          error: 'FINDINGS_INGEST_FAILED',
          message: 'Failed to ingest security findings',
        });
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /findings — List security findings with filters
  // -------------------------------------------------------------------------

  app.get<{ Querystring: FindingsQuerystring }>(
    '/findings',
    { schema: { tags: ['audit'], summary: 'List security findings with filters' } },
    async (request, reply) => {
      const { severity, category, limit: limitStr, offset: offsetStr, agentId } = request.query;

      // Validate severity filter
      if (severity !== undefined && !isValidSeverity(severity)) {
        return reply.code(400).send({
          error: 'INVALID_SEVERITY',
          message: `Invalid severity "${severity}". Must be one of: ${VALID_SEVERITIES.join(', ')}`,
        });
      }

      // Validate limit
      let limit = PAGINATION.securityFindings.defaultLimit;
      if (limitStr !== undefined) {
        const parsed = Number(limitStr);
        if (!Number.isFinite(parsed) || parsed < 1) {
          return reply.code(400).send({
            error: 'INVALID_LIMIT',
            message: '"limit" must be a positive integer',
          });
        }
        limit = clampLimit(parsed, PAGINATION.securityFindings);
      }

      // Validate offset
      let offset = 0;
      if (offsetStr !== undefined) {
        const parsed = Number(offsetStr);
        if (!Number.isFinite(parsed) || parsed < 0) {
          return reply.code(400).send({
            error: 'INVALID_OFFSET',
            message: '"offset" must be a non-negative integer',
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

        const rows = extractRows<SecurityFindingRow>(findingsResult);
        const total = extractRows<CountRow>(countResult)[0]?.count ?? 0;

        return {
          findings: rows.map(formatFinding),
          total,
        };
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError) {
          return reply.code(502).send({ error: error.code, message: error.message });
        }
        return reply.code(500).send({
          error: 'FINDINGS_QUERY_FAILED',
          message: 'Failed to query security findings',
        });
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /findings/summary — Severity summary
  // -------------------------------------------------------------------------

  app.get(
    '/findings/summary',
    { schema: { tags: ['audit'], summary: 'Get security findings severity summary' } },
    async (_request, reply) => {
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

        const total = extractRows<CountRow>(totalResult)[0]?.count ?? 0;
        const severityCounts = extractRows<SeverityCountRow>(severityResult);
        const categoryCounts = extractRows<CategoryCountRow>(categoryResult);

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
          return reply.code(502).send({ error: error.code, message: error.message });
        }
        return reply.code(500).send({
          error: 'FINDINGS_SUMMARY_FAILED',
          message: 'Failed to get findings summary',
        });
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /findings/:id/acknowledge — Acknowledge a finding
  // -------------------------------------------------------------------------

  app.post<{ Params: { id: string }; Body: AcknowledgeBody }>(
    '/findings/:id/acknowledge',
    { schema: { tags: ['audit'], summary: 'Acknowledge a security finding' } },
    async (request, reply) => {
      const { id } = request.params;
      const { acknowledgedBy, reason } = request.body;

      if (!acknowledgedBy || typeof acknowledgedBy !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_ACKNOWLEDGED_BY',
          message: 'A non-empty "acknowledgedBy" string is required',
        });
      }

      try {
        const existing = await db.execute(sql`SELECT id FROM security_findings WHERE id = ${id}`);

        if (existing.rows.length === 0) {
          return reply.code(404).send({
            error: 'FINDING_NOT_FOUND',
            message: `Security finding '${id}' not found`,
          });
        }

        await db.execute(
          sql`UPDATE security_findings SET acknowledged = ${true}, acknowledged_by = ${acknowledgedBy}, acknowledge_reason = ${reason ?? null} WHERE id = ${id}`,
        );

        return { ok: true };
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError) {
          return reply.code(502).send({ error: error.code, message: error.message });
        }
        return reply.code(500).send({
          error: 'FINDING_ACKNOWLEDGE_FAILED',
          message: 'Failed to acknowledge finding',
        });
      }
    },
  );

  // -------------------------------------------------------------------------
  // DELETE /findings/:id — Delete a security finding
  // -------------------------------------------------------------------------

  app.delete<{ Params: { id: string } }>(
    '/findings/:id',
    { schema: { tags: ['audit'], summary: 'Delete a security finding' } },
    async (request, reply) => {
      const { id } = request.params;

      try {
        const existing = await db.execute(sql`SELECT id FROM security_findings WHERE id = ${id}`);

        if (existing.rows.length === 0) {
          return reply.code(404).send({
            error: 'FINDING_NOT_FOUND',
            message: `Security finding '${id}' not found`,
          });
        }

        await db.execute(sql`DELETE FROM security_findings WHERE id = ${id}`);

        return { ok: true };
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError) {
          return reply.code(502).send({ error: error.code, message: error.message });
        }
        return reply.code(500).send({
          error: 'FINDING_DELETE_FAILED',
          message: 'Failed to delete finding',
        });
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /findings/github-issues — Create GitHub issues for critical/high
  // -------------------------------------------------------------------------

  app.post<{ Body: GithubIssuesBody }>(
    '/findings/github-issues',
    { schema: { tags: ['audit'], summary: 'Create GitHub issues for critical/high findings' } },
    async (request, reply) => {
      const { owner, repo, labels } = request.body;

      if (!owner || typeof owner !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_OWNER',
          message: 'A non-empty "owner" string is required',
        });
      }

      if (!repo || typeof repo !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_REPO',
          message: 'A non-empty "repo" string is required',
        });
      }

      // Security: validate owner and repo to prevent SSRF (js/request-forgery).
      // Only allow valid GitHub identifiers (alphanumeric, hyphens, underscores, dots).
      const githubIdentifierPattern = /^[A-Za-z0-9._-]+$/;
      if (!githubIdentifierPattern.test(owner)) {
        return reply.code(400).send({
          error: 'INVALID_OWNER',
          message: 'Owner contains invalid characters',
        });
      }
      if (!githubIdentifierPattern.test(repo)) {
        return reply.code(400).send({
          error: 'INVALID_REPO',
          message: 'Repo contains invalid characters',
        });
      }

      if (labels !== undefined && !Array.isArray(labels)) {
        return reply.code(400).send({
          error: 'INVALID_LABELS',
          message: '"labels" must be an array of strings',
        });
      }

      try {
        const result = await db.execute(
          sql`SELECT * FROM security_findings WHERE acknowledged = ${false} AND issue_created = ${false} AND severity IN ('critical', 'high') ORDER BY created_at ASC`,
        );

        const rows = extractRows<SecurityFindingRow>(result);

        if (rows.length === 0) {
          return { ok: true, issuesCreated: 0 };
        }

        const githubToken = process.env.GITHUB_TOKEN;
        if (!githubToken) {
          return reply.code(500).send({
            error: 'GITHUB_TOKEN_MISSING',
            message: 'GITHUB_TOKEN environment variable is not set',
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
          return reply.code(502).send({ error: error.code, message: error.message });
        }
        return reply.code(500).send({
          error: 'GITHUB_ISSUES_FAILED',
          message: 'Failed to create GitHub issues',
        });
      }
    },
  );
};
