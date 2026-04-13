import { DEFAULT_WORKER_PORT, type PermissionRequest } from '@agentctl/shared';
import { and, desc, eq, lt } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import type { Database } from '../../db/index.js';
import { permissionRequests } from '../../db/schema-permission-requests.js';

// Permission request payloads are stored in the control-plane DB and re-served
// to mobile clients. Caps guard against unbounded strings landing in the table
// (reasonable IDs are ≤128 chars) and keep free-form description + toolInput
// JSON small enough to fit in mobile push previews / UI cells.
const MAX_ID_LENGTH = 128;
const MAX_TOOL_NAME_LENGTH = 256;
const MAX_DESCRIPTION_LENGTH = 8_192;
const MAX_TOOL_INPUT_BYTES = 32_768;
const MAX_RESOLVED_BY_LENGTH = 256;
const MAX_TIMEOUT_SECONDS = 86_400;

import type {
  ExpoPushDispatcher,
  ExpoPushFailure,
} from '../../notifications/expo-push-dispatcher.js';
import type { MobilePushDeviceStore } from '../../notifications/mobile-push-device-store.js';
import type { DbAgentRegistry } from '../../registry/db-registry.js';
import { WORKER_REQUEST_TIMEOUT_MS } from '../constants.js';
import { resolveWorkerUrlOrThrow } from '../resolve-worker-url.js';
import { broadcastPermissionEvent } from './ws.js';

const PERMISSION_REQUEST_STATUSES = [
  'pending',
  'approved',
  'denied',
  'expired',
  'cancelled',
] as const;
const PERMISSION_DECISIONS = ['approved', 'denied'] as const;
const PERMISSION_EXPIRY_INTERVAL_MS = 30_000;

type PermissionRequestStatus = (typeof PERMISSION_REQUEST_STATUSES)[number];
type PermissionDecisionValue = (typeof PERMISSION_DECISIONS)[number];
type PermissionRequestRow = typeof permissionRequests.$inferSelect;

const trimmedId = (max: number) =>
  z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(max));

// Cap toolInput at 32 KB stringified so a malicious worker can't insert
// multi-MB blobs into permission_requests.tool_input. Arbitrary JSON is
// accepted; only the serialized size is bounded.
const boundedJsonObject = z
  .record(z.unknown())
  .refine((value) => JSON.stringify(value).length <= MAX_TOOL_INPUT_BYTES, {
    message: `toolInput JSON must be ≤ ${MAX_TOOL_INPUT_BYTES} bytes when stringified`,
  });

const createPermissionRequestBodySchema = z.object({
  agentId: trimmedId(MAX_ID_LENGTH),
  sessionId: trimmedId(MAX_ID_LENGTH),
  machineId: trimmedId(MAX_ID_LENGTH),
  requestId: trimmedId(MAX_ID_LENGTH),
  toolName: trimmedId(MAX_TOOL_NAME_LENGTH),
  toolInput: boundedJsonObject.optional(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  timeoutSeconds: z.number().int().positive().max(MAX_TIMEOUT_SECONDS),
});

const resolvePermissionRequestBodySchema = z.object({
  decision: z.enum(PERMISSION_DECISIONS),
  resolvedBy: z.string().max(MAX_RESOLVED_BY_LENGTH).optional(),
  allowForSession: z.boolean().optional(),
});

const resolvedByStorageSchema = z.string().max(MAX_RESOLVED_BY_LENGTH);

function mapCreatePermissionIssue(issue: z.ZodIssue | undefined): {
  error: string;
  message: string;
} {
  const field = issue?.path[0];
  switch (field) {
    case 'agentId':
      return { error: 'INVALID_AGENT_ID', message: 'A non-empty "agentId" string is required' };
    case 'sessionId':
      return { error: 'INVALID_SESSION_ID', message: 'A non-empty "sessionId" string is required' };
    case 'machineId':
      return { error: 'INVALID_MACHINE_ID', message: 'A non-empty "machineId" string is required' };
    case 'requestId':
      return { error: 'INVALID_REQUEST_ID', message: 'A non-empty "requestId" string is required' };
    case 'toolName':
      return { error: 'INVALID_TOOL_NAME', message: 'A non-empty "toolName" string is required' };
    case 'toolInput':
      return {
        error: 'INVALID_TOOL_INPUT',
        message: `"toolInput" must be an object of at most ${MAX_TOOL_INPUT_BYTES} bytes when provided`,
      };
    case 'description':
      return {
        error: 'INVALID_DESCRIPTION',
        message: `"description" must be a string of at most ${MAX_DESCRIPTION_LENGTH} characters`,
      };
    case 'timeoutSeconds':
      return {
        error: 'INVALID_TIMEOUT_SECONDS',
        message: `"timeoutSeconds" must be a positive integer ≤ ${MAX_TIMEOUT_SECONDS}`,
      };
    default:
      return {
        error: 'INVALID_PERMISSION_REQUEST_BODY',
        message: 'Invalid permission request body',
      };
  }
}

function mapResolvePermissionIssue(issue: z.ZodIssue | undefined): {
  error: string;
  message: string;
} {
  const field = issue?.path[0];
  if (field === 'decision') {
    return {
      error: 'INVALID_DECISION',
      message: `decision must be one of: ${PERMISSION_DECISIONS.join(', ')}`,
    };
  }
  if (field === 'resolvedBy') {
    return {
      error: 'INVALID_RESOLVED_BY',
      message: `"resolvedBy" must be a string of at most ${MAX_RESOLVED_BY_LENGTH} characters`,
    };
  }
  if (field === 'allowForSession') {
    return { error: 'INVALID_ALLOW_FOR_SESSION', message: '"allowForSession" must be a boolean' };
  }
  return {
    error: 'INVALID_PERMISSION_RESOLVE_BODY',
    message: 'Invalid permission resolve body',
  };
}

export type PermissionRequestRoutesOptions = {
  db: Database;
  dbRegistry?: DbAgentRegistry | null;
  mobilePushDeviceStore?: Pick<MobilePushDeviceStore, 'deactivateByToken' | 'listDevices'> | null;
  expoPushDispatcher?: Pick<ExpoPushDispatcher, 'dispatchApprovalPending'> | null;
  workerPort?: number;
};

export const permissionRequestRoutes: FastifyPluginAsync<PermissionRequestRoutesOptions> = async (
  app,
  opts,
) => {
  const {
    db,
    dbRegistry = null,
    mobilePushDeviceStore = null,
    expoPushDispatcher = null,
    workerPort = DEFAULT_WORKER_PORT,
  } = opts;

  app.post<{
    Body: {
      agentId?: string;
      sessionId?: string;
      machineId?: string;
      requestId?: string;
      toolName?: string;
      toolInput?: Record<string, unknown>;
      description?: string;
      timeoutSeconds?: number;
    };
  }>(
    '/',
    { schema: { tags: ['approvals'], summary: 'Create permission request' } },
    async (request, reply) => {
      const parsed = createPermissionRequestBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(mapCreatePermissionIssue(parsed.error.issues[0]));
      }
      const {
        agentId,
        sessionId,
        machineId,
        requestId,
        toolName,
        toolInput,
        description,
        timeoutSeconds,
      } = parsed.data;

      const now = new Date();
      const timeoutAt = new Date(now.getTime() + timeoutSeconds * 1000);

      // Auto-approve if a previous request with same sessionId + toolName was approved
      // with allowForSession flag (resolvedBy contains 'session-allow:')
      const [sessionAllow] = await db
        .select()
        .from(permissionRequests)
        .where(
          and(
            eq(permissionRequests.sessionId, sessionId),
            eq(permissionRequests.toolName, toolName),
            eq(permissionRequests.status, 'approved'),
          ),
        )
        .orderBy(desc(permissionRequests.requestedAt));

      if (sessionAllow?.resolvedBy?.startsWith('session-allow:')) {
        // Auto-approve: create as already approved
        const [autoApproved] = await db
          .insert(permissionRequests)
          .values({
            agentId,
            sessionId,
            machineId,
            requestId,
            toolName,
            toolInput: toolInput ?? null,
            description: description ?? null,
            status: 'approved',
            decision: 'approved',
            requestedAt: now,
            timeoutAt,
            resolvedAt: now,
            resolvedBy: 'auto:session-allow',
          })
          .returning();

        broadcastPermissionEvent(
          'permission_request_created',
          toPermissionRequestEvent(autoApproved),
        );
        broadcastPermissionEvent(
          'permission_request_resolved',
          toPermissionRequestEvent(autoApproved),
        );

        // Forward auto-approval to worker
        await forwardDecisionToWorker(
          {
            agentId: autoApproved.agentId,
            requestId: autoApproved.requestId,
            decision: 'approved',
          },
          { dbRegistry, workerPort, logger: app.log },
        );

        return reply.code(201).send(autoApproved);
      }

      const [created] = await db
        .insert(permissionRequests)
        .values({
          agentId,
          sessionId,
          machineId,
          requestId,
          toolName,
          toolInput: toolInput ?? null,
          description: description ?? null,
          status: 'pending',
          requestedAt: now,
          timeoutAt,
        })
        .returning();

      broadcastPermissionEvent('permission_request_created', toPermissionRequestEvent(created));
      await dispatchApprovalPendingPush({
        requestId: created.requestId,
        mobilePushDeviceStore,
        expoPushDispatcher,
        logger: app.log,
      });

      return reply.code(201).send(created);
    },
  );

  app.get<{
    Querystring: {
      status?: PermissionRequestStatus;
      agentId?: string;
      sessionId?: string;
    };
  }>(
    '/',
    { schema: { tags: ['approvals'], summary: 'List permission requests' } },
    async (request, reply) => {
      const { status, agentId, sessionId } = request.query;

      if (status && !isPermissionRequestStatus(status)) {
        return reply.code(400).send({
          error: 'INVALID_STATUS',
          message: `status must be one of: ${PERMISSION_REQUEST_STATUSES.join(', ')}`,
        });
      }

      const conditions = [];

      if (status) {
        conditions.push(eq(permissionRequests.status, status));
      }

      if (agentId) {
        conditions.push(eq(permissionRequests.agentId, agentId));
      }

      if (sessionId) {
        conditions.push(eq(permissionRequests.sessionId, sessionId));
      }

      const rows =
        conditions.length > 0
          ? await db
              .select()
              .from(permissionRequests)
              .where(and(...conditions))
              .orderBy(desc(permissionRequests.requestedAt))
          : await db
              .select()
              .from(permissionRequests)
              .orderBy(desc(permissionRequests.requestedAt));

      return reply.send(rows);
    },
  );

  app.patch<{
    Params: { id: string };
    Body: {
      decision?: PermissionDecisionValue;
      resolvedBy?: string;
      allowForSession?: boolean;
    };
  }>(
    '/:id',
    { schema: { tags: ['approvals'], summary: 'Resolve permission request' } },
    async (request, reply) => {
      const parsedBody = resolvePermissionRequestBodySchema.safeParse(request.body);
      if (!parsedBody.success) {
        return reply.code(400).send(mapResolvePermissionIssue(parsedBody.error.issues[0]));
      }
      const decision = parsedBody.data.decision;
      const resolvedByCandidate = parsedBody.data.allowForSession
        ? `session-allow:${resolveResolvedBy(parsedBody.data.resolvedBy, request.headers['x-user-id'])}`
        : resolveResolvedBy(parsedBody.data.resolvedBy, request.headers['x-user-id']);
      const parsedResolvedBy = resolvedByStorageSchema.safeParse(resolvedByCandidate);
      if (!parsedResolvedBy.success) {
        return reply.code(400).send({
          error: 'INVALID_RESOLVED_BY',
          message: `"resolvedBy" must be a string of at most ${MAX_RESOLVED_BY_LENGTH} characters`,
        });
      }

      const [existing] = await db
        .select()
        .from(permissionRequests)
        .where(eq(permissionRequests.id, request.params.id));

      if (!existing) {
        return reply.code(404).send({
          error: 'PERMISSION_REQUEST_NOT_FOUND',
          message: `Permission request '${request.params.id}' was not found`,
        });
      }

      if (existing.status !== 'pending') {
        return reply.code(409).send({
          error: 'PERMISSION_REQUEST_ALREADY_RESOLVED',
          message: `Permission request is already '${existing.status}'`,
        });
      }

      const resolvedAt = new Date();
      const [updated] = await db
        .update(permissionRequests)
        .set({
          status: decision,
          decision,
          resolvedAt,
          resolvedBy: parsedResolvedBy.data,
        })
        .where(
          and(
            eq(permissionRequests.id, request.params.id),
            eq(permissionRequests.status, 'pending'),
          ),
        )
        .returning();

      if (!updated) {
        return reply.code(409).send({
          error: 'PERMISSION_REQUEST_ALREADY_RESOLVED',
          message: 'Permission request was already resolved',
        });
      }

      broadcastPermissionEvent('permission_request_resolved', toPermissionRequestEvent(updated));

      await forwardDecisionToWorker(
        {
          agentId: updated.agentId,
          requestId: updated.requestId,
          decision,
        },
        {
          dbRegistry,
          workerPort,
          logger: app.log,
        },
      );

      return reply.send(updated);
    },
  );

  const safeExpire = (): void => {
    expirePendingPermissionRequests({
      db,
      dbRegistry,
      workerPort,
      logger: app.log,
    }).catch((err) => {
      app.log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'permission expiry check failed',
      );
    });
  };

  const expiryTimer = setInterval(safeExpire, PERMISSION_EXPIRY_INTERVAL_MS);

  app.addHook('onClose', async () => {
    clearInterval(expiryTimer);
  });

  safeExpire();
};

function isPermissionRequestStatus(value: string): value is PermissionRequestStatus {
  return (PERMISSION_REQUEST_STATUSES as readonly string[]).includes(value);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function resolveResolvedBy(
  bodyResolvedBy: string | undefined,
  headerResolvedBy: string | string[] | undefined,
): string {
  if (typeof bodyResolvedBy === 'string' && bodyResolvedBy.trim().length > 0) {
    return bodyResolvedBy;
  }

  if (typeof headerResolvedBy === 'string' && headerResolvedBy.trim().length > 0) {
    return headerResolvedBy;
  }

  if (Array.isArray(headerResolvedBy) && headerResolvedBy.length > 0) {
    const first = headerResolvedBy[0];
    if (typeof first === 'string' && first.trim().length > 0) {
      return first;
    }
  }

  return 'user';
}

async function dispatchApprovalPendingPush({
  requestId,
  mobilePushDeviceStore,
  expoPushDispatcher,
  logger,
}: {
  requestId: string;
  mobilePushDeviceStore: Pick<MobilePushDeviceStore, 'deactivateByToken' | 'listDevices'> | null;
  expoPushDispatcher: Pick<ExpoPushDispatcher, 'dispatchApprovalPending'> | null;
  logger: { warn: (obj: Record<string, unknown>, msg: string) => void };
}): Promise<void> {
  if (!mobilePushDeviceStore || !expoPushDispatcher) {
    return;
  }

  try {
    const devices = await mobilePushDeviceStore.listDevices({
      includeDisabled: false,
      platform: 'ios',
      provider: 'expo',
    });

    const result = await expoPushDispatcher.dispatchApprovalPending({
      requestId,
      devices,
    });

    for (const failure of result.failures) {
      if (!failure.permanent) {
        continue;
      }

      await deactivateInvalidPushToken({
        failure,
        requestId,
        mobilePushDeviceStore,
        logger,
      });
    }

    if (result.failures.length > 0) {
      logger.warn(
        {
          requestId,
          failureCount: result.failures.length,
          failures: result.failures,
        },
        'approval pending push dispatch failed',
      );
    }
  } catch (error: unknown) {
    logger.warn(
      {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      },
      'approval pending push dispatch failed',
    );
  }
}

async function deactivateInvalidPushToken({
  failure,
  requestId,
  mobilePushDeviceStore,
  logger,
}: {
  failure: ExpoPushFailure;
  requestId: string;
  mobilePushDeviceStore: Pick<MobilePushDeviceStore, 'deactivateByToken'>;
  logger: { warn: (obj: Record<string, unknown>, msg: string) => void };
}): Promise<void> {
  try {
    await mobilePushDeviceStore.deactivateByToken({
      provider: 'expo',
      pushToken: failure.token,
    });
  } catch (error: unknown) {
    logger.warn(
      {
        requestId,
        pushToken: failure.token,
        error: error instanceof Error ? error.message : String(error),
      },
      'failed to deactivate invalid expo push token',
    );
  }
}

async function expirePendingPermissionRequests({
  db,
  dbRegistry,
  workerPort,
  logger,
}: {
  db: Database;
  dbRegistry: DbAgentRegistry | null;
  workerPort: number;
  logger: { warn: (obj: Record<string, unknown>, msg: string) => void };
}): Promise<void> {
  const now = new Date();

  const expired = await db
    .update(permissionRequests)
    .set({
      status: 'expired',
      decision: 'denied',
      resolvedAt: now,
      resolvedBy: 'timeout',
    })
    .where(and(eq(permissionRequests.status, 'pending'), lt(permissionRequests.timeoutAt, now)))
    .returning();

  for (const request of expired) {
    broadcastPermissionEvent('permission_request_resolved', toPermissionRequestEvent(request));

    await forwardDecisionToWorker(
      {
        agentId: request.agentId,
        requestId: request.requestId,
        decision: 'denied',
      },
      {
        dbRegistry,
        workerPort,
        logger,
      },
    );
  }
}

async function forwardDecisionToWorker(
  decision: {
    agentId: string;
    requestId: string;
    decision: PermissionDecisionValue;
  },
  opts: {
    dbRegistry: DbAgentRegistry | null;
    workerPort: number;
    logger: { warn: (obj: Record<string, unknown>, msg: string) => void };
  },
): Promise<void> {
  const { dbRegistry, workerPort, logger } = opts;

  if (!dbRegistry) {
    logger.warn(
      { agentId: decision.agentId, requestId: decision.requestId },
      'Skipping permission decision delivery because dbRegistry is unavailable',
    );
    return;
  }

  let workerBaseUrl: string;
  try {
    workerBaseUrl = await resolveWorkerUrlOrThrow(
      decision.agentId,
      {},
      {
        dbRegistry,
        workerPort,
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(
      {
        agentId: decision.agentId,
        requestId: decision.requestId,
        error: message,
      },
      'Failed to resolve worker URL for permission decision delivery',
    );
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WORKER_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${workerBaseUrl}/api/agents/${encodeURIComponent(decision.agentId)}/permission-response`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: decision.requestId,
          decision: decision.decision,
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      logger.warn(
        {
          agentId: decision.agentId,
          requestId: decision.requestId,
          status: response.status,
          workerBaseUrl,
        },
        'Worker rejected permission decision delivery',
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(
      {
        agentId: decision.agentId,
        requestId: decision.requestId,
        error: message,
        workerBaseUrl,
      },
      'Failed to deliver permission decision to worker',
    );
  } finally {
    clearTimeout(timeout);
  }
}

function toPermissionRequestEvent(row: PermissionRequestRow): PermissionRequest {
  return {
    id: row.id,
    agentId: row.agentId,
    sessionId: row.sessionId,
    machineId: row.machineId,
    requestId: row.requestId,
    toolName: row.toolName,
    toolInput: isJsonObject(row.toolInput) ? row.toolInput : undefined,
    description: row.description ?? undefined,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    timeoutAt: row.timeoutAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString(),
    resolvedBy: row.resolvedBy ?? undefined,
    decision: row.decision ?? undefined,
  };
}
