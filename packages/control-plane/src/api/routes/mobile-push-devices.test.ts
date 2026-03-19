import { ControlPlaneError } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MobilePushDeviceStore } from '../../notifications/mobile-push-device-store.js';
import { mobilePushDeviceRoutes } from './mobile-push-devices.js';

const NOW = '2026-03-19T10:00:00.000Z';

function makeDevice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'device-1',
    userId: 'operator-1',
    platform: 'ios',
    provider: 'expo',
    pushToken: 'ExponentPushToken[abc123]',
    appId: 'com.agentctl.mobile',
    lastSeenAt: NOW,
    disabledAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function createMockStore(): MobilePushDeviceStore {
  return {
    upsertDevice: vi.fn().mockResolvedValue(makeDevice()),
    listDevices: vi.fn().mockResolvedValue([]),
    deactivateDevice: vi.fn().mockResolvedValue(makeDevice({ disabledAt: NOW })),
  } as unknown as MobilePushDeviceStore;
}

async function buildApp(store: MobilePushDeviceStore): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(mobilePushDeviceRoutes, {
    prefix: '/api/mobile-push-devices',
    mobilePushDeviceStore: store,
  });
  await app.ready();
  return app;
}

describe('mobilePushDeviceRoutes', () => {
  let app: FastifyInstance;
  let store: ReturnType<typeof createMockStore>;

  beforeEach(async () => {
    store = createMockStore();
    app = await buildApp(store);
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  describe('POST /api/mobile-push-devices', () => {
    const validBody = {
      userId: 'operator-1',
      platform: 'ios',
      provider: 'expo',
      pushToken: 'ExponentPushToken[abc123]',
      appId: 'com.agentctl.mobile',
      lastSeenAt: NOW,
    };

    it('upserts a mobile push device and returns 201', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/mobile-push-devices',
        payload: validBody,
      });

      expect(response.statusCode).toBe(201);
      expect(store.upsertDevice).toHaveBeenCalledWith({
        ...validBody,
        lastSeenAt: new Date(NOW),
      });
      expect(response.json()).toMatchObject({
        ok: true,
        device: { id: 'device-1', provider: 'expo' },
      });
    });

    it('returns 400 when userId is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/mobile-push-devices',
        payload: { ...validBody, userId: '' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'INVALID_USER_ID' });
    });

    it('returns 400 when platform is unsupported', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/mobile-push-devices',
        payload: { ...validBody, platform: 'android' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'INVALID_PLATFORM' });
    });

    it('returns 400 when provider is unsupported', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/mobile-push-devices',
        payload: { ...validBody, provider: 'apns' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'INVALID_PROVIDER' });
    });

    it('returns 400 when pushToken is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/mobile-push-devices',
        payload: { ...validBody, pushToken: '' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'INVALID_PUSH_TOKEN' });
    });

    it('returns 400 when appId is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/mobile-push-devices',
        payload: { ...validBody, appId: '' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'INVALID_APP_ID' });
    });

    it('returns 400 when lastSeenAt is invalid', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/mobile-push-devices',
        payload: { ...validBody, lastSeenAt: 'not-a-date' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'INVALID_LAST_SEEN_AT' });
    });
  });

  describe('GET /api/mobile-push-devices', () => {
    it('requires a userId query parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/mobile-push-devices',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'INVALID_USER_ID' });
    });

    it('lists devices for a user and passes includeDisabled through', async () => {
      vi.mocked(store.listDevices).mockResolvedValueOnce([
        makeDevice(),
        makeDevice({ id: 'device-2', disabledAt: NOW }),
      ] as never);

      const response = await app.inject({
        method: 'GET',
        url: '/api/mobile-push-devices?userId=operator-1&includeDisabled=true',
      });

      expect(response.statusCode).toBe(200);
      expect(store.listDevices).toHaveBeenCalledWith({
        userId: 'operator-1',
        includeDisabled: true,
      });
      expect(response.json()).toMatchObject({
        devices: [{ id: 'device-1' }, { id: 'device-2', disabledAt: NOW }],
      });
    });
  });

  describe('POST /api/mobile-push-devices/:deviceId/deactivate', () => {
    it('deactivates a device and returns the updated record', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/mobile-push-devices/device-1/deactivate',
      });

      expect(response.statusCode).toBe(200);
      expect(store.deactivateDevice).toHaveBeenCalledWith('device-1');
      expect(response.json()).toMatchObject({
        ok: true,
        device: { id: 'device-1', disabledAt: NOW },
      });
    });

    it('returns 404 when the store reports a missing device', async () => {
      vi.mocked(store.deactivateDevice).mockRejectedValueOnce(
        new ControlPlaneError('MOBILE_PUSH_DEVICE_NOT_FOUND', 'missing'),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/mobile-push-devices/missing-device/deactivate',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: 'MOBILE_PUSH_DEVICE_NOT_FOUND' });
    });
  });
});
