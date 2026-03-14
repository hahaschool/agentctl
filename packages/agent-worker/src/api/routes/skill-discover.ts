import { homedir } from 'node:os';

import type { ManagedRuntime } from '@agentctl/shared';
import { isManagedRuntime, MANAGED_RUNTIMES } from '@agentctl/shared';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { Logger } from 'pino';

import type { DiscoveredSkill } from '../../runtime/discovery/_type-stubs.js';
import { DiscoveryCache } from '../../runtime/discovery/discovery-cache.js';
import { discoverSkills } from '../../runtime/discovery/skill-discovery.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SkillDiscoverRouteOptions = FastifyPluginOptions & {
  logger: Logger;
};

type SkillDiscoverQuerystring = {
  runtime?: string;
  projectPath?: string;
};

// ---------------------------------------------------------------------------
// Cache (exported so sync-capabilities can call invalidateAll())
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 60_000;

export const skillDiscoverCache = new DiscoveryCache<DiscoveredSkill[]>(CACHE_TTL_MS);

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function skillDiscoverRoutes(
  app: FastifyInstance,
  options: SkillDiscoverRouteOptions,
): Promise<void> {
  const { logger } = options;

  // GET /api/skills/discover?runtime=...&projectPath=...
  app.get<{ Querystring: SkillDiscoverQuerystring }>('/discover', async (request, reply) => {
    const runtime = (request.query.runtime ?? 'claude-code') as string;

    // Validate runtime
    if (!isManagedRuntime(runtime)) {
      return reply.status(400).send({
        ok: false,
        error: `Invalid runtime: ${runtime}. Must be one of: ${MANAGED_RUNTIMES.join(', ')}`,
      });
    }

    const projectPath = request.query.projectPath;
    const cacheKey = `skills:${runtime}:${projectPath ?? 'global'}`;

    // Check cache
    const cached = skillDiscoverCache.get(cacheKey);
    if (cached) {
      return reply.send({ ok: true, discovered: cached, cached: true });
    }

    try {
      const discovered = await discoverSkills(runtime as ManagedRuntime, homedir(), projectPath);

      skillDiscoverCache.set(cacheKey, discovered);

      logger.info({ runtime, projectPath, count: discovered.length }, 'Skills discovered');

      return reply.send({ ok: true, discovered, cached: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, runtime, projectPath }, 'Skill discovery failed');
      return reply.status(500).send({
        ok: false,
        error: `Failed to discover skills: ${message}`,
      });
    }
  });
}
