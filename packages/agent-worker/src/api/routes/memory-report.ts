// ---------------------------------------------------------------------------
// Worker-side memory_report MCP tool route
//
// Generates a scoped memory report by delegating to the control-plane
// statistics and facts endpoints.
//
// Report types:
//   - health    → memory stats overview (fact counts, strength distribution)
//   - progress  → growth trend + recent activity summary
//   - activity  → recent facts created within the time range
// ---------------------------------------------------------------------------

import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';

const VALID_REPORT_TYPES = ['progress', 'health', 'activity'] as const;
type ReportType = (typeof VALID_REPORT_TYPES)[number];

type MemoryReportRouteOptions = FastifyPluginOptions & {
  controlPlaneUrl: string;
  logger: Logger;
};

type ReportBody = {
  reportType: string;
  scope?: string;
  timeRange?: string;
};

export async function memoryReportRoutes(
  app: FastifyInstance,
  opts: MemoryReportRouteOptions,
): Promise<void> {
  const { controlPlaneUrl, logger } = opts;

  app.post(
    '/memory-report',
    async (request: FastifyRequest<{ Body: ReportBody }>, reply: FastifyReply) => {
      const body = request.body as ReportBody;

      if (
        !body.reportType ||
        !(VALID_REPORT_TYPES as readonly string[]).includes(body.reportType)
      ) {
        return reply.code(400).send({
          error: 'INVALID_REPORT_TYPE',
          message: `reportType must be one of: ${VALID_REPORT_TYPES.join(', ')}`,
        });
      }

      const reportType = body.reportType as ReportType;

      // Fetch stats from control-plane
      let statsResponse: Response;
      try {
        statsResponse = await fetch(`${controlPlaneUrl}/api/memory/stats`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error: unknown) {
        logger.error({ err: error, reportType }, 'Failed to reach control-plane for memory report');
        return reply.code(503).send({
          error: 'MEMORY_REPORT_UNREACHABLE',
          message: 'Control-plane unreachable while generating memory report',
        });
      }

      if (!statsResponse.ok) {
        const responseBody = await statsResponse.json().catch(() => ({}));
        logger.warn(
          { reportType, status: statsResponse.status, body: responseBody },
          'Control-plane returned error for memory stats',
        );
        return reply.code(statsResponse.status).send(responseBody);
      }

      const statsJson = (await statsResponse.json()) as Record<string, unknown>;
      const stats = statsJson.stats as Record<string, unknown> | undefined;

      const now = new Date().toISOString();

      if (reportType === 'health') {
        return {
          ok: true,
          report: {
            type: 'health',
            scope: body.scope ?? 'global',
            generatedAt: now,
            data: {
              totalFacts: stats?.totalFacts ?? 0,
              avgConfidence: stats?.avgConfidence ?? 0,
              strengthDistribution: stats?.strengthDistribution ?? {},
              byScope: stats?.byScope ?? {},
              byEntityType: stats?.byEntityType ?? {},
            },
          },
        };
      }

      if (reportType === 'progress') {
        return {
          ok: true,
          report: {
            type: 'progress',
            scope: body.scope ?? 'global',
            timeRange: body.timeRange ?? '7d',
            generatedAt: now,
            data: {
              newThisWeek: stats?.newThisWeek ?? 0,
              totalFacts: stats?.totalFacts ?? 0,
              growthTrend: stats?.growthTrend ?? [],
              pendingConsolidation: stats?.pendingConsolidation ?? 0,
            },
          },
        };
      }

      // activity: fetch recent facts from the control-plane
      const params = new URLSearchParams({ limit: '50' });
      if (body.scope) {
        params.set('scope', body.scope);
      }

      let factsResponse: Response;
      try {
        factsResponse = await fetch(`${controlPlaneUrl}/api/memory/facts?${params.toString()}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error: unknown) {
        logger.error(
          { err: error, reportType },
          'Failed to fetch recent facts for activity report',
        );
        return reply.code(503).send({
          error: 'MEMORY_REPORT_UNREACHABLE',
          message: 'Control-plane unreachable while fetching activity facts',
        });
      }

      const factsJson = factsResponse.ok
        ? ((await factsResponse.json()) as Record<string, unknown>)
        : { facts: [] };

      return {
        ok: true,
        report: {
          type: 'activity',
          scope: body.scope ?? 'global',
          timeRange: body.timeRange ?? '7d',
          generatedAt: now,
          data: {
            recentFacts: factsJson.facts ?? [],
            total: factsJson.total ?? 0,
          },
        },
      };
    },
  );
}
