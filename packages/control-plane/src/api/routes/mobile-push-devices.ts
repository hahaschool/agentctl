import {
  ControlPlaneError,
  isMobilePushPlatform,
  isMobilePushProvider,
  type UpsertMobilePushDeviceRequest,
} from '@agentctl/shared';
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';

import type { MobilePushDeviceStore } from '../../notifications/mobile-push-device-store.js';
import { readRateLimitEnv } from '../rate-limit.js';

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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseOptionalDate(value: string | undefined): Date | null {
  if (value === undefined) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function parseIncludeDisabled(value: string | undefined): boolean | null {
  if (value === undefined) {
    return false;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return null;
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
      const { userId, platform, provider, pushToken, appId, lastSeenAt } = request.body;

      if (!isNonEmptyString(userId)) {
        return reply.code(400).send({
          error: 'INVALID_USER_ID',
          message: 'A non-empty "userId" string is required',
        });
      }

      if (!isNonEmptyString(platform) || !isMobilePushPlatform(platform)) {
        return reply.code(400).send({
          error: 'INVALID_PLATFORM',
          message: 'platform must be one of: ios',
        });
      }

      if (!isNonEmptyString(provider) || !isMobilePushProvider(provider)) {
        return reply.code(400).send({
          error: 'INVALID_PROVIDER',
          message: 'provider must be one of: expo',
        });
      }

      if (!isNonEmptyString(pushToken)) {
        return reply.code(400).send({
          error: 'INVALID_PUSH_TOKEN',
          message: 'A non-empty "pushToken" string is required',
        });
      }

      if (!isNonEmptyString(appId)) {
        return reply.code(400).send({
          error: 'INVALID_APP_ID',
          message: 'A non-empty "appId" string is required',
        });
      }

      const parsedLastSeenAt = parseOptionalDate(lastSeenAt);
      if (lastSeenAt !== undefined && parsedLastSeenAt === null) {
        return reply.code(400).send({
          error: 'INVALID_LAST_SEEN_AT',
          message: '"lastSeenAt" must be a valid ISO-8601 timestamp',
        });
      }

      try {
        const device = await mobilePushDeviceStore.upsertDevice({
          userId: userId.trim(),
          platform,
          provider,
          pushToken: pushToken.trim(),
          appId: appId.trim(),
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
      const { userId, includeDisabled } = request.query;

      if (!isNonEmptyString(userId)) {
        return reply.code(400).send({
          error: 'INVALID_USER_ID',
          message: 'A non-empty "userId" query parameter is required',
        });
      }

      const parsedIncludeDisabled = parseIncludeDisabled(includeDisabled);
      if (parsedIncludeDisabled === null) {
        return reply.code(400).send({
          error: 'INVALID_INCLUDE_DISABLED',
          message: '"includeDisabled" must be "true" or "false" when provided',
        });
      }

      try {
        const devices = await mobilePushDeviceStore.listDevices({
          userId: userId.trim(),
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
      const { deviceId } = request.params;

      if (!isNonEmptyString(deviceId)) {
        return reply.code(400).send({
          error: 'INVALID_DEVICE_ID',
          message: 'A non-empty "deviceId" path parameter is required',
        });
      }

      try {
        const device = await mobilePushDeviceStore.deactivateDevice(deviceId.trim());
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
