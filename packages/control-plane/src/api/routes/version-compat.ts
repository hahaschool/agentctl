// ---------------------------------------------------------------------------
// Version compatibility endpoint — roadmap §33.11.
//
// `GET /api/version-compat` returns the information a mobile/web client needs
// to decide whether it can talk to this control plane before attempting the
// authenticated API handshake. The payload mirrors `/health`'s version fields
// (so iOS + web can reuse the same producer resolver) plus two "minimum
// supported build" floors sourced from env vars — `MIN_SUPPORTED_MOBILE_BUILD`
// and `MIN_SUPPORTED_WEB_BUILD`.
//
// No auth is required: this endpoint has to be reachable pre-login. It is
// strictly read-only and IP-rate-limited (60/min) via `@fastify/rate-limit`
// following the same pattern used by `sync-discover.ts`.
// ---------------------------------------------------------------------------

import type { VersionCompatResponse } from '@agentctl/shared';
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import { getAppVersion, getGitSha, getSchemaVersion } from '../../build-info.js';
import { readRateLimitEnv } from '../rate-limit.js';

const VERSION_COMPAT_RATE_LIMIT = { max: 60, timeWindow: 60_000 } as const;

export type VersionCompatRoutesOptions = {
  /**
   * Test-only overrides. In production we read from `build-info` (for version
   * identity) + env (for minimum-build floors) so callers don't need to pass
   * anything.
   */
  appVersion?: string;
  gitSha?: string;
  schemaVersion?: number;
};

function getRateLimitKey(request: {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}): string {
  return (
    request.ip ??
    (typeof request.headers['x-forwarded-for'] === 'string'
      ? request.headers['x-forwarded-for']
      : 'unknown')
  );
}

/**
 * Parse a non-negative integer env var. Falls back to `0` (meaning "no floor
 * enforced") for unset, empty, non-numeric, or negative values so a
 * mis-configured env never locks every client out.
 */
function readBuildFloor(envName: string): number {
  const raw = process.env[envName];
  if (!raw || raw.trim().length === 0) return 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

export const versionCompatRoutes: FastifyPluginAsync<VersionCompatRoutesOptions> = async (
  app,
  opts,
) => {
  const appVersion = opts.appVersion ?? getAppVersion();
  const gitSha = opts.gitSha ?? getGitSha();
  const schemaVersion = opts.schemaVersion ?? getSchemaVersion();

  const rateLimitConfig = {
    max: readRateLimitEnv('VERSION_COMPAT_RATE_LIMIT_MAX', VERSION_COMPAT_RATE_LIMIT.max),
    timeWindow: readRateLimitEnv(
      'VERSION_COMPAT_RATE_LIMIT_WINDOW_MS',
      VERSION_COMPAT_RATE_LIMIT.timeWindow,
    ),
    keyGenerator: getRateLimitKey,
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'RATE_LIMITED',
      message: 'Too many version-compat requests',
    }),
  } as const;

  await app.register(rateLimit, {
    global: false,
    keyGenerator: getRateLimitKey,
    errorResponseBuilder: rateLimitConfig.errorResponseBuilder,
  });

  app.get(
    '/version-compat',
    {
      config: { rateLimit: rateLimitConfig },
      schema: {
        tags: ['system'],
        summary: 'Mobile + web client compatibility surface',
        description:
          'Pre-auth bootstrap payload: version identity (reuses /health fields) plus minimum supported mobile/web build floors. Clients below the floor must update before logging in.',
      },
      preHandler: [app.rateLimit(rateLimitConfig)],
    },
    // @fastify/rate-limit runs before the handler. CodeQL only models the
    // legacy fastify-rate-limit plugin for this rule.
    // codeql[js/missing-rate-limiting]
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const body: VersionCompatResponse = {
        appVersion,
        gitSha,
        schemaVersion,
        minSupportedMobileBuild: readBuildFloor('MIN_SUPPORTED_MOBILE_BUILD'),
        minSupportedWebBuild: readBuildFloor('MIN_SUPPORTED_WEB_BUILD'),
      };
      return reply.code(200).send(body);
    },
  );
};
