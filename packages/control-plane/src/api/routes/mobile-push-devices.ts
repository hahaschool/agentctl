import {
  ControlPlaneError,
  type DeactivateMobilePushDeviceRequest,
  isMobilePushDevicePlatform,
  isMobilePushProvider,
  MOBILE_PUSH_DEVICE_PLATFORMS,
  MOBILE_PUSH_PROVIDERS,
  type UpsertMobilePushDeviceRequest,
} from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { MobilePushDeviceStore } from '../../notifications/mobile-push-device-store.js';

export type MobilePushDeviceRoutesOptions = {
  mobilePushDeviceStore: MobilePushDeviceStore;
};

type ListDevicesQuerystring = {
  userId?: string;
  includeDisabled?: string;
  platform?: string;
  provider?: string;
};

export const mobilePushDeviceRoutes: FastifyPluginAsync<MobilePushDeviceRoutesOptions> = async (
  app,
  opts,
) => {
  const { mobilePushDeviceStore } = opts;

  app.get<{ Querystring: ListDevicesQuerystring }>(
    '/',
    {
      schema: {
        tags: ['notifications'],
        summary: 'List registered mobile push devices',
      },
    },
    async (request, reply) => {
      const includeDisabled = parseIncludeDisabled(request.query.includeDisabled);
      if (includeDisabled === null) {
        return reply.code(400).send({
          error: 'INVALID_INCLUDE_DISABLED',
          message: '"includeDisabled" must be "true" or "false" when provided',
        });
      }

      if (
        request.query.platform !== undefined &&
        !isMobilePushDevicePlatform(request.query.platform)
      ) {
        return reply.code(400).send({
          error: 'INVALID_PLATFORM',
          message: `platform must be one of: ${MOBILE_PUSH_DEVICE_PLATFORMS.join(', ')}`,
        });
      }

      if (request.query.provider !== undefined && !isMobilePushProvider(request.query.provider)) {
        return reply.code(400).send({
          error: 'INVALID_PROVIDER',
          message: `provider must be one of: ${MOBILE_PUSH_PROVIDERS.join(', ')}`,
        });
      }

      try {
        const devices = await mobilePushDeviceStore.listDevices({
          userId: request.query.userId,
          includeDisabled,
          platform: request.query.platform,
          provider: request.query.provider,
        });

        return { devices };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.code(500).send({
          error: 'DEVICE_LIST_FAILED',
          message: `Failed to list mobile push devices: ${message}`,
        });
      }
    },
  );

  app.post<{ Body: UpsertMobilePushDeviceRequest }>(
    '/',
    {
      schema: {
        tags: ['notifications'],
        summary: 'Create or update a mobile push device registration',
      },
    },
    async (request, reply) => {
      const { userId, platform, provider, pushToken, appId, lastSeenAt } = request.body;

      if (!isNonEmptyString(userId)) {
        return reply.code(400).send({
          error: 'INVALID_USER_ID',
          message: 'A non-empty "userId" string is required',
        });
      }

      if (!isMobilePushDevicePlatform(platform)) {
        return reply.code(400).send({
          error: 'INVALID_PLATFORM',
          message: `platform must be one of: ${MOBILE_PUSH_DEVICE_PLATFORMS.join(', ')}`,
        });
      }

      if (!isMobilePushProvider(provider)) {
        return reply.code(400).send({
          error: 'INVALID_PROVIDER',
          message: `provider must be one of: ${MOBILE_PUSH_PROVIDERS.join(', ')}`,
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

      if (lastSeenAt !== undefined && !isIsoTimestamp(lastSeenAt)) {
        return reply.code(400).send({
          error: 'INVALID_LAST_SEEN_AT',
          message: '"lastSeenAt" must be a valid ISO timestamp when provided',
        });
      }

      try {
        const device = await mobilePushDeviceStore.upsertDevice({
          userId,
          platform,
          provider,
          pushToken,
          appId,
          lastSeenAt,
        });

        return reply.code(200).send({ ok: true, device });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.code(500).send({
          error: 'DEVICE_UPSERT_FAILED',
          message: `Failed to upsert mobile push device: ${message}`,
        });
      }
    },
  );

  app.post<{ Params: { id: string }; Body: DeactivateMobilePushDeviceRequest }>(
    '/:id/deactivate',
    {
      schema: {
        tags: ['notifications'],
        summary: 'Deactivate a mobile push device registration',
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { disabledAt } = request.body ?? {};

      if (!isNonEmptyString(id)) {
        return reply.code(400).send({
          error: 'INVALID_DEVICE_ID',
          message: 'A non-empty device id is required',
        });
      }

      if (disabledAt !== undefined && !isIsoTimestamp(disabledAt)) {
        return reply.code(400).send({
          error: 'INVALID_DISABLED_AT',
          message: '"disabledAt" must be a valid ISO timestamp when provided',
        });
      }

      try {
        const device = await mobilePushDeviceStore.deactivateDevice(id, { disabledAt });
        return { ok: true, device };
      } catch (error: unknown) {
        if (error instanceof ControlPlaneError && error.code === 'DEVICE_NOT_FOUND') {
          return reply.code(404).send({
            error: 'DEVICE_NOT_FOUND',
            message: error.message,
          });
        }

        const message = error instanceof Error ? error.message : String(error);
        return reply.code(500).send({
          error: 'DEVICE_DEACTIVATE_FAILED',
          message: `Failed to deactivate mobile push device: ${message}`,
        });
      }
    },
  );
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isIsoTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime());
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
