import type {
  ManualTakeoverPermissionMode,
  ManualTakeoverResponse,
  ManualTakeoverState,
  StartManualTakeoverRequest,
} from '@agentctl/shared';
import {
  isManualTakeoverPermissionMode,
  WorkerError,
} from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { Logger } from 'pino';

import type { RcSession } from '../../runtime/rc-session-manager.js';

type ManualTakeoverRouteBody = StartManualTakeoverRequest & {
  agentId?: string | null;
  projectPath: string;
};

export type ManualTakeoverRoutesOptions = {
  logger: Logger;
  rcSessionManager: {
    startSession(input: {
      agentId: string;
      projectPath: string;
      resumeSessionId?: string;
      permissionMode?: ManualTakeoverPermissionMode;
    }): Promise<RcSession>;
    getSessionByNativeSessionId(nativeSessionId: string): RcSession | null;
    getSessionByProjectPath(projectPath: string): RcSession | null;
    stopSession(sessionId: string, graceful?: boolean): Promise<void>;
  };
};

export const manualTakeoverRoutes: FastifyPluginAsync<ManualTakeoverRoutesOptions> = async (
  app,
  opts,
) => {
  const { logger, rcSessionManager } = opts;

  app.post<{
    Params: { sessionId: string };
    Body: ManualTakeoverRouteBody;
  }>('/:sessionId/manual-takeover', async (request) => {
    const nativeSessionId = request.params.sessionId;
    const projectPath = request.body.projectPath?.trim();
    if (!projectPath) {
      throw new WorkerError('INVALID_PROJECT_PATH', 'projectPath must be a non-empty string', {
        nativeSessionId,
      });
    }

    const permissionMode = parsePermissionMode(request.body.permissionMode);
    const existing =
      rcSessionManager.getSessionByNativeSessionId(nativeSessionId) ??
      rcSessionManager.getSessionByProjectPath(projectPath);

    if (existing) {
      logger.info(
        {
          nativeSessionId,
          workerSessionId: existing.id,
          projectPath,
        },
        'Reusing manual takeover session',
      );
      return manualTakeoverResponse(existing);
    }

    const agentId = request.body.agentId?.trim() || nativeSessionId;
    const session = await rcSessionManager.startSession({
      agentId,
      projectPath,
      resumeSessionId: nativeSessionId,
      permissionMode,
    });

    logger.info(
      {
        nativeSessionId,
        workerSessionId: session.id,
        projectPath,
      },
      'Started manual takeover session',
    );

    return manualTakeoverResponse(session);
  });

  app.get<{ Params: { sessionId: string } }>('/:sessionId/manual-takeover', async (request) => {
    const session = rcSessionManager.getSessionByNativeSessionId(request.params.sessionId);
    return manualTakeoverResponse(session);
  });

  app.delete<{ Params: { sessionId: string } }>('/:sessionId/manual-takeover', async (request) => {
    const session = rcSessionManager.getSessionByNativeSessionId(request.params.sessionId);
    if (!session) {
      return manualTakeoverResponse(null);
    }

    await rcSessionManager.stopSession(session.id);
    logger.info(
      {
        nativeSessionId: request.params.sessionId,
        workerSessionId: session.id,
        projectPath: session.projectPath,
      },
      'Revoked manual takeover session',
    );

    return manualTakeoverResponse(session, {
      status: 'stopped',
      sessionUrl: null,
      error: null,
    });
  });
};

function parsePermissionMode(value?: string | null): ManualTakeoverPermissionMode {
  if (!value) {
    return 'default';
  }

  if (!isManualTakeoverPermissionMode(value)) {
    throw new WorkerError(
      'INVALID_PERMISSION_MODE',
      `permissionMode must be one of: default, accept-edits, plan`,
      { permissionMode: value },
    );
  }

  return value;
}

function manualTakeoverResponse(
  session: RcSession | null,
  overrides: Partial<ManualTakeoverState> = {},
): ManualTakeoverResponse {
  return {
    ok: true,
    manualTakeover: session ? toManualTakeoverState(session, overrides) : null,
  };
}

function toManualTakeoverState(
  session: RcSession,
  overrides: Partial<ManualTakeoverState> = {},
): ManualTakeoverState {
  const now = new Date().toISOString();
  return {
    workerSessionId: session.id,
    nativeSessionId: session.nativeSessionId ?? '',
    projectPath: session.projectPath,
    status: session.status,
    permissionMode: session.permissionMode,
    sessionUrl: session.sessionUrl,
    startedAt: session.startedAt.toISOString(),
    lastHeartbeat: session.lastHeartbeat?.toISOString() ?? null,
    lastVerifiedAt: now,
    error: session.error,
    ...overrides,
  };
}
