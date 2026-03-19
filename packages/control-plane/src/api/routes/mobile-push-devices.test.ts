import type { MobilePushDevice, UpsertMobilePushDeviceRequest } from '@agentctl/shared';
import { ControlPlaneError } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MobilePushDeviceStore } from '../../notifications/mobile-push-device-store.js';
import { mobilePushDeviceRoutes } from './mobile-push-devices.js';

function makeDevice(overrides: Partial<MobilePushDevice> = {}): MobilePushDevice {
  return {
    id: '00000000-0000-4000-a000-000000000001',
    userId: 'operator-dev-1',
    platform: 'ios',
    provider: 'expo',
    pushToken: 'ExponentPushToken[abc123]',
    appId: 'dev.hahaschool.agentctl',
    lastSeenAt: '2026-03-19T10:00:00.000Z',
    createdAt: '2026-03-19T09:59:00.000Z',
    updatedAt: '2026-03-19T10:00:00.000Z',
    ...overrides,
  };
}

function createMockStore(): MobilePushDeviceStore {
  return {
    listDevices: vi.fn().mockResolvedValue([]),
    upsertDevice: vi.fn().mockResolvedValue(makeDevice()),
    deactivateDevice: vi
      .fn()
      .mockResolvedValue(makeDevice({ disabledAt: '2026-03-19T10:05:00.000Z' })),
    deactivateByToken: vi.fn(),
    listActiveDevices: vi.fn().mockResolvedValue([]),
  } as unknown as MobilePushDeviceStore;
}

describe('mobile push device routes', () => {
  let app: FastifyInstance;
  let store: ReturnType<typeof createMockStore>;

  beforeEach(async () => {
    store = createMockStore();
    app = Fastify({ logger: false });
    await app.register(mobilePushDeviceRoutes, {
      prefix: '/api/mobile-push-devices',
      mobilePushDeviceStore: store,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  describe('POST /api/mobile-push-devices', () => {
    const validBody: UpsertMobilePushDeviceRequest = {
      userId: 'operator-dev-1',
      platform: 'ios',
      provider: 'expo',
      pushToken: 'ExponentPushToken[abc123]',
      appId: 'dev.hahaschool.agentctl',
      lastSeenAt: '2026-03-19T10:00:00.000Z',
    };

    it('upserts a device and returns the stored record', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/mobile-push-devices',
        payload: validBody,
      });

      expect(response.statusCode).toBe(200);
      expect(vi.mocked(store.upsertDevice)).toHaveBeenCalledWith(validBody);
      expect(response.json()).toEqual({ ok: true, device: makeDevice() });
    });

    it('returns 400 when userId is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/mobile-push-devices',
        payload: { ...validBody, userId: '' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('INVALID_USER_ID');
    });

    it('returns 400 when platform is invalid', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/mobile-push-devices',
        payload: { ...validBody, platform: 'android' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('INVALID_PLATFORM');
    });

    it('returns 400 when provider is invalid', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/mobile-push-devices',
        payload: { ...validBody, provider: 'apns' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('INVALID_PROVIDER');
    });

    it('returns 400 when lastSeenAt is not an ISO timestamp', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/mobile-push-devices',
        payload: { ...validBody, lastSeenAt: 'not-a-date' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('INVALID_LAST_SEEN_AT');
    });
  });

  describe('GET /api/mobile-push-devices', () => {
    it('lists devices with query filters', async () => {
      vi.mocked(store.listDevices).mockResolvedValueOnce([
        makeDevice(),
        makeDevice({
          id: '00000000-0000-4000-a000-000000000002',
          disabledAt: '2026-03-19T10:03:00.000Z',
        }),
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/mobile-push-devices?userId=operator-dev-1&includeDisabled=true&platform=ios&provider=expo',
      });

      expect(response.statusCode).toBe(200);
      expect(vi.mocked(store.listDevices)).toHaveBeenCalledWith({
        userId: 'operator-dev-1',
        includeDisabled: true,
        platform: 'ios',
        provider: 'expo',
      });
      expect(response.json().devices).toHaveLength(2);
    });

    it('returns 400 when includeDisabled is invalid', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/mobile-push-devices?includeDisabled=maybe',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBe('INVALID_INCLUDE_DISABLED');
    });
  });

  describe('POST /api/mobile-push-devices/:id/deactivate', () => {
    it('deactivates a device by id', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/mobile-push-devices/00000000-0000-4000-a000-000000000001/deactivate',
        payload: { disabledAt: '2026-03-19T10:05:00.000Z' },
      });

      expect(response.statusCode).toBe(200);
      expect(vi.mocked(store.deactivateDevice)).toHaveBeenCalledWith(
        '00000000-0000-4000-a000-000000000001',
        { disabledAt: '2026-03-19T10:05:00.000Z' },
      );
      expect(response.json().device.disabledAt).toBe('2026-03-19T10:05:00.000Z');
    });

    it('returns 404 when the device does not exist', async () => {
      vi.mocked(store.deactivateDevice).mockRejectedValueOnce(
        new ControlPlaneError('DEVICE_NOT_FOUND', 'missing device'),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/mobile-push-devices/00000000-0000-4000-a000-000000000099/deactivate',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toBe('DEVICE_NOT_FOUND');
    });
  });
});
