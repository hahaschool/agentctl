import type {
  ExportHandoffSnapshotRequest,
  RuntimeSessionSummary,
  StartHandoffRequest,
} from '@agentctl/shared';
import { WorkerError, type ManagedRuntime } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { Logger } from 'pino';

import type { HandoffController } from '../../runtime/handoff-controller.js';
import type {
  ForkManagedSessionInput,
  ManagedSessionHandle,
  ResumeManagedSessionInput,
  RuntimeAdapter,
  StartManagedSessionInput,
} from '../../runtime/runtime-adapter.js';
import { RuntimeRegistry } from '../../runtime/runtime-registry.js';

export type RuntimeSessionsRoutesOptions = {
  machineId: string;
  runtimeRegistry: RuntimeRegistry;
  handoffController: Pick<HandoffController, 'exportSnapshot' | 'handoff'>;
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
  const { runtimeRegistry, handoffController, logger } = opts;

  app.post<{ Body: RuntimeSessionBody }>('/', async (request, reply) => {
    const adapter = requireAdapter(runtimeRegistry, request.body.runtime);
    const session = await adapter.startSession(toStartInput(request.body));
    logger.info({ runtime: request.body.runtime, sessionId: session.sessionId }, 'Started runtime session');
    return reply.code(201).send({ ok: true, session });
  });

  app.post<{
    Params: { sessionId: string };
    Body: ExportHandoffSnapshotRequest;
  }>('/:sessionId/handoff/export', async (request) => {
    const snapshot = await handoffController.exportSnapshot({
      ...request.body,
      nativeSessionId: request.params.sessionId,
    });
    return {
      ok: true,
      strategy: 'snapshot-handoff' as const,
      snapshot,
    };
  });

  app.post<{ Body: StartHandoffRequest }>('/handoff', async (request) => {
    const result = await handoffController.handoff(request.body);
    return {
      ok: true,
      strategy: result.strategy,
      attemptedStrategies: result.attemptedStrategies,
      nativeImportAttempt: result.nativeImportAttempt,
      snapshot: result.snapshot,
      session: toSessionSummary(result.session),
    };
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

function toSessionSummary(session: ManagedSessionHandle): RuntimeSessionSummary {
  return {
    runtime: session.runtime,
    sessionId: session.sessionId,
    nativeSessionId: session.nativeSessionId,
    agentId: session.agentId,
    projectPath: session.projectPath,
    model: session.model,
    status: session.status,
  };
}
