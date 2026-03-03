import { ControlPlaneError } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { LiteLLMClient } from '../../router/litellm-client.js';

export type RouterRoutesOptions = {
  litellmClient: LiteLLMClient;
};

export const routerRoutes: FastifyPluginAsync<RouterRoutesOptions> = async (app, opts) => {
  const { litellmClient } = opts;

  // ---------------------------------------------------------------------------
  // Health check — is the LiteLLM proxy reachable?
  // ---------------------------------------------------------------------------

  app.get(
    '/health',
    { schema: { tags: ['router'], summary: 'Check LiteLLM proxy health' } },
    async (_request, reply) => {
      try {
        const healthy = await litellmClient.health();
        const status = healthy ? 'ok' : 'degraded';

        return reply.code(healthy ? 200 : 503).send({
          status,
          timestamp: new Date().toISOString(),
        });
      } catch (error: unknown) {
        const message =
          error instanceof ControlPlaneError
            ? error.message
            : 'Unexpected error checking LiteLLM health';
        return reply.code(500).send({
          status: 'error',
          message,
          timestamp: new Date().toISOString(),
        });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // List available model IDs
  // ---------------------------------------------------------------------------

  app.get(
    '/models',
    { schema: { tags: ['router'], summary: 'List available model IDs' } },
    async (_request, reply) => {
      try {
        const models = await litellmClient.listModels();

        return { models };
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError) {
          return reply.code(502).send({ error: error.code, message: error.message });
        }
        return reply
          .code(500)
          .send({ error: 'LIST_MODELS_FAILED', message: 'Failed to list models' });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Get detailed model deployment info (costs, parameters, etc.)
  // ---------------------------------------------------------------------------

  app.get(
    '/models/info',
    { schema: { tags: ['router'], summary: 'Get detailed model deployment info' } },
    async (_request, reply) => {
      try {
        const deployments = await litellmClient.getModelInfo();

        return { deployments };
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError) {
          return reply.code(502).send({ error: error.code, message: error.message });
        }
        return reply
          .code(500)
          .send({ error: 'MODEL_INFO_FAILED', message: 'Failed to fetch model info' });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Get spend logs
  // ---------------------------------------------------------------------------

  app.get(
    '/spend',
    { schema: { tags: ['router'], summary: 'Get spend logs' } },
    async (_request, reply) => {
      try {
        const entries = await litellmClient.getSpend();

        return { entries };
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError) {
          return reply.code(502).send({ error: error.code, message: error.message });
        }
        return reply
          .code(500)
          .send({ error: 'SPEND_LOGS_FAILED', message: 'Failed to fetch spend logs' });
      }
    },
  );

  // ---------------------------------------------------------------------------
  // Test a specific model by sending a tiny completion
  // ---------------------------------------------------------------------------

  app.post<{ Params: { id: string } }>(
    '/models/:id/test',
    { schema: { tags: ['router'], summary: 'Test a specific model with a tiny completion' } },
    async (request, reply) => {
      const modelId = request.params.id;

      try {
        const result = await litellmClient.testModel(modelId);

        return {
          ok: true,
          modelId,
          responseModel: result.model,
          usage: result.usage,
        };
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError) {
          return reply.code(502).send({ error: error.code, message: error.message, modelId });
        }
        return reply
          .code(500)
          .send({ error: 'TEST_MODEL_FAILED', message: 'Failed to test model', modelId });
      }
    },
  );
};
