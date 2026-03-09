import { WorkerError, type ManagedRuntime } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { Logger } from 'pino';

import type {
  ForkManagedSessionInput,
  ResumeManagedSessionInput,
  RuntimeAdapter,
  StartManagedSessionInput,
} from '../../runtime/runtime-adapter.js';
import { RuntimeRegistry } from '../../runtime/runtime-registry.js';

export type RuntimeSessionsRoutesOptions = {
  machineId: string;
  runtimeRegistry: RuntimeRegistry;
  logger: Logger;
};

type RuntimeSessionBody = {
  runtime: ManagedRuntime;
  agentId: string;
  projectPath: string;
  prompt?: string | null;
  model?: string | null;
};

export const runtimeSessionsRoutes: FastifyPluginAsync<RuntimeSessionsRoutesOptions> = async (
  app,
  opts,
) => {
  const { runtimeRegistry, logger } = opts;

  app.post<{ Body: RuntimeSessionBody }>('/', async (request, reply) => {
    const adapter = requireAdapter(runtimeRegistry, request.body.runtime);
    const session = await adapter.startSession(toStartInput(request.body));
    logger.info({ runtime: request.body.runtime, sessionId: session.sessionId }, 'Started runtime session');
    return reply.code(201).send({ ok: true, session });
  });

  app.post<{ Params: { sessionId: string }; Body: RuntimeSessionBody }>(
    '/:sessionId/resume',
    async (request) => {
      const adapter = requireAdapter(runtimeRegistry, request.body.runtime);
      const session = await adapter.resumeSession({
        ...toStartInput(request.body),
        nativeSessionId: request.params.sessionId,
      });
      return { ok: true, session };
    },
  );

  app.post<{ Params: { sessionId: string }; Body: RuntimeSessionBody }>(
    '/:sessionId/fork',
    async (request) => {
      const adapter = requireAdapter(runtimeRegistry, request.body.runtime);
      const session = await adapter.forkSession({
        agentId: request.body.agentId,
        projectPath: request.body.projectPath,
        nativeSessionId: request.params.sessionId,
        prompt: request.body.prompt ?? null,
        model: request.body.model ?? null,
      });
      return { ok: true, session };
    },
  );
};

function requireAdapter(registry: RuntimeRegistry, runtime: ManagedRuntime): RuntimeAdapter {
  const adapter = registry.get(runtime);
  if (!adapter) {
    throw new WorkerError('RUNTIME_NOT_FOUND', `Runtime '${runtime}' is not registered`, { runtime });
  }
  return adapter;
}

function toStartInput(body: RuntimeSessionBody): StartManagedSessionInput {
  return {
    agentId: body.agentId,
    projectPath: body.projectPath,
    prompt: body.prompt ?? 'Continue working.',
    model: body.model ?? null,
  };
}
