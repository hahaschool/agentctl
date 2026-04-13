// ── POST /api/decompose — LLM-based task auto-decomposition (§10.5 Phase 5b) ──

import type { DecompositionConstraints } from '@agentctl/shared';
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';

import type { TaskDecomposer } from '../../intelligence/task-decomposer.js';
import { readRateLimitEnv } from '../rate-limit.js';

export type DecomposeRoutesOptions = {
  taskDecomposer: TaskDecomposer;
};

// Rate-limit both decompose paths: each request triggers an LLM call (high
// token cost + outbound traffic to the provider), and the non-preview path
// additionally creates a TaskGraph on success. A flood is a direct cost-abuse
// vector against the connected provider account.
const DECOMPOSE_RATE_LIMIT = {
  max: 20,
  timeWindow: 60_000,
} as const;

export const decomposeRoutes: FastifyPluginAsync<DecomposeRoutesOptions> = async (app, opts) => {
  const { taskDecomposer } = opts;

  const decomposeRateLimitMax = readRateLimitEnv(
    'DECOMPOSE_RATE_LIMIT_MAX',
    DECOMPOSE_RATE_LIMIT.max,
  );
  const decomposeRateLimitWindowMs = readRateLimitEnv(
    'DECOMPOSE_RATE_LIMIT_WINDOW_MS',
    DECOMPOSE_RATE_LIMIT.timeWindow,
  );
  const decomposeRateLimitError = () => ({
    statusCode: 429,
    error: 'RATE_LIMITED',
    message: 'Too many decompose requests',
  });
  const decomposeFastifyRateLimit = {
    max: decomposeRateLimitMax,
    timeWindow: decomposeRateLimitWindowMs,
    errorResponseBuilder: decomposeRateLimitError,
  } as const;

  await app.register(rateLimit, {
    global: false,
    keyGenerator: (request) =>
      request.ip ??
      (typeof request.headers['x-forwarded-for'] === 'string'
        ? request.headers['x-forwarded-for']
        : 'unknown'),
    errorResponseBuilder: decomposeRateLimitError,
  });

  // ── POST / — full decompose (creates TaskGraph) ──────────────
  app.post<{
    Body: {
      description: string;
      spaceId?: string;
      constraints?: DecompositionConstraints;
    };
  }>(
    '/',
    {
      schema: {
        tags: ['intelligence'],
        summary: 'Decompose a task description into a TaskGraph via LLM',
      },
      config: { rateLimit: decomposeFastifyRateLimit },
      preHandler: [app.rateLimit(decomposeFastifyRateLimit)],
    },
    async (request, reply) => {
      const { description, spaceId, constraints } = request.body;

      if (!description || typeof description !== 'string' || description.trim().length === 0) {
        return reply.code(400).send({
          error: 'INVALID_DESCRIPTION',
          message: 'A non-empty "description" string is required',
        });
      }

      const response = await taskDecomposer.decompose({
        description: description.trim(),
        spaceId,
        constraints,
      });

      return reply.code(201).send(response);
    },
  );

  // ── POST /preview — dry run (LLM + validation only, no persistence) ──
  app.post<{
    Body: {
      description: string;
      constraints?: DecompositionConstraints;
    };
  }>(
    '/preview',
    {
      schema: {
        tags: ['intelligence'],
        summary: 'Preview task decomposition without creating a graph (dry run)',
      },
      config: { rateLimit: decomposeFastifyRateLimit },
      preHandler: [app.rateLimit(decomposeFastifyRateLimit)],
    },
    async (request, reply) => {
      const { description, constraints } = request.body;

      if (!description || typeof description !== 'string' || description.trim().length === 0) {
        return reply.code(400).send({
          error: 'INVALID_DESCRIPTION',
          message: 'A non-empty "description" string is required',
        });
      }

      const preview = await taskDecomposer.preview({
        description: description.trim(),
        constraints,
      });

      return reply.code(200).send(preview);
    },
  );
};
