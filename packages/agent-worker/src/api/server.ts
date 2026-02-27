import Fastify, { type FastifyInstance } from 'fastify';
import type { Logger } from 'pino';

type CreateWorkerServerOptions = {
  logger: Logger;
};

export async function createWorkerServer({
  logger,
}: CreateWorkerServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // TODO: agent lifecycle endpoints (start, stop, status, stream)
  app.get('/api/agents', async () => {
    return { agents: [] };
  });

  app.addHook('onRequest', async (request) => {
    logger.debug({ method: request.method, url: request.url }, 'incoming request');
  });

  return app;
}
