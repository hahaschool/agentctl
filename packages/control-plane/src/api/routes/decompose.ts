// ── POST /api/decompose — LLM-based task auto-decomposition (§10.5 Phase 5b) ──

import type { DecompositionConstraints } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { TaskDecomposer } from '../../intelligence/task-decomposer.js';

export type DecomposeRoutesOptions = {
  taskDecomposer: TaskDecomposer;
};

export const decomposeRoutes: FastifyPluginAsync<DecomposeRoutesOptions> = async (app, opts) => {
  const { taskDecomposer } = opts;

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
