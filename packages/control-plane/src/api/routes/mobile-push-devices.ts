import {
  ControlPlaneError,
  isMobilePushPlatform,
  isMobilePushProvider,
  type UpsertMobilePushDeviceRequest,
} from '@agentctl/shared';
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import type { MobilePushDeviceStore } from '../../notifications/mobile-push-device-store.js';
import { readRateLimitEnv } from '../rate-limit.js';

// Field length caps on push-device writes prevent memory-exhaustion abuse
// (arbitrary-size strings stored per-user) and keep downstream logs bounded.
// Expo push tokens are ~50 chars; 256 is a generous safety margin.
const MAX_USER_ID_LENGTH = 128;
const MAX_PUSH_TOKEN_LENGTH = 256;
const MAX_APP_ID_LENGTH = 128;
const MAX_DEVICE_ID_LENGTH = 128;

const trimmedNonEmptyString = (max: number) =>
  z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(max));

// Unknown keys are stripped (default Zod behavior) so forward-compatible
// callers that add new optional fields are not rejected on older servers.
const upsertDeviceBodySchema = z.object({
  userId: trimmedNonEmptyString(MAX_USER_ID_LENGTH),
  platform: z.string().refine(isMobilePushPlatform, {
    message: 'platform must be one of: ios',
  }),
  provider: z.string().refine(isMobilePushProvider, {
    message: 'provider must be one of: expo',
  }),
  pushToken: trimmedNonEmptyString(MAX_PUSH_TOKEN_LENGTH),
  appId: trimmedNonEmptyString(MAX_APP_ID_LENGTH),
  lastSeenAt: z.string().datetime({ offset: true }).optional(),
});

const listDevicesQuerySchema = z.object({
  userId: trimmedNonEmptyString(MAX_USER_ID_LENGTH),
  includeDisabled: z.enum(['true', 'false']).optional(),
});

const deviceIdParamsSchema = z.object({
  deviceId: trimmedNonEmptyString(MAX_DEVICE_ID_LENGTH),
});

export type MobilePushDeviceRoutesOptions = {
  mobilePushDeviceStore: MobilePushDeviceStore;
};

// Rate-limit mobile push device writes: upsert persists push tokens against
// arbitrary userIds and deactivate mutates device state, so both are cross-
// user abuse vectors.
const MOBILE_PUSH_DEVICES_RATE_LIMIT = {
  max: 20,
  timeWindow: 60_000,
} as const;

function parseOptionalDate(value: string | undefined): Date | null {
  if (value === undefined) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

// Map Zod upsert-device body issues back to the stable, per-field error codes
// that existing clients (mobile app, iOS relay) already handle. Keeping the
// error vocabulary stable lets us tighten the schema without breaking
// downstream consumers.
function mapUpsertDeviceIssue(issue: z.ZodIssue | undefined): {
  error: string;
  message: string;
} {
  const field = issue?.path[0];
  switch (field) {
    case 'userId':
      return {
        error: 'INVALID_USER_ID',
        message: 'A non-empty "userId" string is required',
      };
    case 'platform':
      return {
        error: 'INVALID_PLATFORM',
        message: 'platform must be one of: ios',
      };
    case 'provider':
      return {
        error: 'INVALID_PROVIDER',
        message: 'provider must be one of: expo',
      };
    case 'pushToken':
      return {
        error: 'INVALID_PUSH_TOKEN',
        message: 'A non-empty "pushToken" string is required',
      };
    case 'appId':
      return {
        error: 'INVALID_APP_ID',
        message: 'A non-empty "appId" string is required',
      };
    case 'lastSeenAt':
      return {
        error: 'INVALID_LAST_SEEN_AT',
        message: '"lastSeenAt" must be a valid ISO-8601 timestamp',
      };
    default:
      return {
        error: 'INVALID_UPSERT_DEVICE_BODY',
        message: 'Invalid mobile push device registration body',
      };
  }
}

export const mobilePushDeviceRoutes: FastifyPluginAsync<MobilePushDeviceRoutesOptions> = async (
  app,
  opts,
) => {
  const { mobilePushDeviceStore } = opts;

  const mobilePushDevicesRateLimitMax = readRateLimitEnv(
    'MOBILE_PUSH_DEVICES_RATE_LIMIT_MAX',
    MOBILE_PUSH_DEVICES_RATE_LIMIT.max,
  );
  const mobilePushDevicesRateLimitWindowMs = readRateLimitEnv(
    'MOBILE_PUSH_DEVICES_RATE_LIMIT_WINDOW_MS',
    MOBILE_PUSH_DEVICES_RATE_LIMIT.timeWindow,
  );
  const mobilePushDevicesRateLimitError = () => ({
    statusCode: 429,
    error: 'RATE_LIMITED',
    message: 'Too many mobile push device requests',
  });
  const mobilePushDevicesFastifyRateLimit = {
    max: mobilePushDevicesRateLimitMax,
    timeWindow: mobilePushDevicesRateLimitWindowMs,
    errorResponseBuilder: mobilePushDevicesRateLimitError,
  } as const;

  await app.register(rateLimit, {
    global: false,
    keyGenerator: (request) =>
      request.ip ??
      (typeof request.headers['x-forwarded-for'] === 'string'
        ? request.headers['x-forwarded-for']
        : 'unknown'),
    errorResponseBuilder: mobilePushDevicesRateLimitError,
  });

  app.post<{ Body: UpsertMobilePushDeviceRequest }>(
    '/',
    {
      schema: {
        tags: ['notifications'],
        summary: 'Upsert a mobile push device registration',
      },
      config: { rateLimit: mobilePushDevicesFastifyRateLimit },
      preHandler: [app.rateLimit(mobilePushDevicesFastifyRateLimit)],
    },
    async (request, reply) => {
      const parsed = upsertDeviceBodySchema.safeParse(request.body);
      if (!parsed.success) {
        const mapped = mapUpsertDeviceIssue(parsed.error.issues[0]);
        return reply.code(400).send(mapped);
      }
      const { userId, platform, provider, pushToken, appId, lastSeenAt } = parsed.data;

      const parsedLastSeenAt = parseOptionalDate(lastSeenAt);

      try {
        const device = await mobilePushDeviceStore.upsertDevice({
          userId,
          platform,
          provider,
          pushToken,
          appId,
          lastSeenAt: parsedLastSeenAt,
        });

        return reply.code(201).send({ ok: true, device });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.code(500).send({
          error: 'MOBILE_PUSH_DEVICE_UPSERT_FAILED',
          message: `Failed to upsert mobile push device: ${message}`,
        });
      }
    },
  );

  app.get<{ Querystring: { userId?: string; includeDisabled?: string } }>(
    '/',
    {
      schema: {
        tags: ['notifications'],
        summary: 'List mobile push devices for a user',
      },
    },
    async (request, reply) => {
      const parsed = listDevicesQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        const firstPath = parsed.error.issues[0]?.path[0];
        if (firstPath === 'includeDisabled') {
          return reply.code(400).send({
            error: 'INVALID_INCLUDE_DISABLED',
            message: '"includeDisabled" must be "true" or "false" when provided',
          });
        }
        return reply.code(400).send({
          error: 'INVALID_USER_ID',
          message: 'A non-empty "userId" query parameter is required',
        });
      }
      const { userId, includeDisabled } = parsed.data;
      const parsedIncludeDisabled = includeDisabled === 'true';

      try {
        const devices = await mobilePushDeviceStore.listDevices({
          userId,
          includeDisabled: parsedIncludeDisabled,
        });

        return { devices };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.code(500).send({
          error: 'MOBILE_PUSH_DEVICE_LIST_FAILED',
          message: `Failed to list mobile push devices: ${message}`,
        });
      }
    },
  );

  app.post<{ Params: { deviceId: string } }>(
    '/:deviceId/deactivate',
    {
      schema: {
        tags: ['notifications'],
        summary: 'Deactivate a mobile push device',
      },
      config: { rateLimit: mobilePushDevicesFastifyRateLimit },
      preHandler: [app.rateLimit(mobilePushDevicesFastifyRateLimit)],
    },
    async (request, reply) => {
      const parsed = deviceIdParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'INVALID_DEVICE_ID',
          message: 'A non-empty "deviceId" path parameter is required',
          details: parsed.error.issues,
        });
      }
      const { deviceId } = parsed.data;

      try {
        const device = await mobilePushDeviceStore.deactivateDevice(deviceId);
        return { ok: true, device };
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError && error.code === 'MOBILE_PUSH_DEVICE_NOT_FOUND') {
          return reply.code(404).send({
            error: 'MOBILE_PUSH_DEVICE_NOT_FOUND',
            message: `Mobile push device '${deviceId}' not found`,
          });
        }

        const message = error instanceof Error ? error.message : String(error);
        return reply.code(500).send({
          error: 'MOBILE_PUSH_DEVICE_DEACTIVATE_FAILED',
          message: `Failed to deactivate mobile push device: ${message}`,
        });
      }
    },
  );
};
