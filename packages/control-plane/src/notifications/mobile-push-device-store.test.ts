import type { ControlPlaneError, MobilePushDevice } from '@agentctl/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../api/routes/test-helpers.js';
import type { Database } from '../db/index.js';
import { createMockDb, type MockDb } from '../runtime-management/test-helpers.js';
import { MobilePushDeviceStore } from './mobile-push-device-store.js';

function makeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '00000000-0000-4000-a000-000000000001',
    userId: 'operator-dev-1',
    platform: 'ios',
    provider: 'expo',
    pushToken: 'ExponentPushToken[abc123]',
    appId: 'dev.hahaschool.agentctl',
    lastSeenAt: new Date('2026-03-19T10:00:00.000Z'),
    disabledAt: null,
    createdAt: new Date('2026-03-19T09:59:00.000Z'),
    updatedAt: new Date('2026-03-19T10:00:00.000Z'),
    ...overrides,
  };
}

describe('MobilePushDeviceStore', () => {
  let mockDb: MockDb;
  let store: MobilePushDeviceStore;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    store = new MobilePushDeviceStore(mockDb as unknown as Database, createMockLogger());
  });

  it('upserts a device and returns the stored record', async () => {
    mockDb.returning.mockResolvedValueOnce([makeRow()]);

    const device = await store.upsertDevice({
      userId: 'operator-dev-1',
      platform: 'ios',
      provider: 'expo',
      pushToken: 'ExponentPushToken[abc123]',
      appId: 'dev.hahaschool.agentctl',
      lastSeenAt: '2026-03-19T10:00:00.000Z',
    });

    expect(mockDb.insert).toHaveBeenCalledOnce();
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'operator-dev-1',
        platform: 'ios',
        provider: 'expo',
        pushToken: 'ExponentPushToken[abc123]',
        appId: 'dev.hahaschool.agentctl',
      }),
    );
    expect(mockDb.onConflictDoUpdate).toHaveBeenCalledOnce();
    expect(device).toMatchObject<Partial<MobilePushDevice>>({
      userId: 'operator-dev-1',
      platform: 'ios',
      provider: 'expo',
      pushToken: 'ExponentPushToken[abc123]',
      appId: 'dev.hahaschool.agentctl',
    });
  });

  it('lists devices and maps disabled timestamps to strings', async () => {
    mockDb.orderBy.mockResolvedValueOnce([
      makeRow(),
      makeRow({
        id: '00000000-0000-4000-a000-000000000002',
        pushToken: 'ExponentPushToken[disabled]',
        disabledAt: new Date('2026-03-19T10:03:00.000Z'),
      }),
    ]);

    const devices = await store.listDevices({ userId: 'operator-dev-1', includeDisabled: true });

    expect(mockDb.select).toHaveBeenCalledOnce();
    expect(mockDb.where).toHaveBeenCalledOnce();
    expect(devices).toHaveLength(2);
    expect(devices[1]?.disabledAt).toBe('2026-03-19T10:03:00.000Z');
  });

  it('deactivates a device by id and returns the updated row', async () => {
    mockDb.returning.mockResolvedValueOnce([
      makeRow({
        disabledAt: new Date('2026-03-19T10:05:00.000Z'),
        updatedAt: new Date('2026-03-19T10:05:00.000Z'),
      }),
    ]);

    const device = await store.deactivateDevice('00000000-0000-4000-a000-000000000001', {
      disabledAt: '2026-03-19T10:05:00.000Z',
    });

    expect(mockDb.update).toHaveBeenCalledOnce();
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        disabledAt: new Date('2026-03-19T10:05:00.000Z'),
      }),
    );
    expect(device.disabledAt).toBe('2026-03-19T10:05:00.000Z');
  });

  it('deactivates a device by provider and push token for dispatcher follow-ups', async () => {
    mockDb.returning.mockResolvedValueOnce([
      makeRow({
        disabledAt: new Date('2026-03-19T10:06:00.000Z'),
        updatedAt: new Date('2026-03-19T10:06:00.000Z'),
      }),
    ]);

    const device = await store.deactivateByToken({
      provider: 'expo',
      pushToken: 'ExponentPushToken[abc123]',
      disabledAt: '2026-03-19T10:06:00.000Z',
    });

    expect(mockDb.update).toHaveBeenCalledOnce();
    expect(device.disabledAt).toBe('2026-03-19T10:06:00.000Z');
  });

  it('throws DEVICE_NOT_FOUND when deactivation does not match a row', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    await expect(
      store.deactivateDevice('00000000-0000-4000-a000-000000000099'),
    ).rejects.toMatchObject<Partial<ControlPlaneError>>({
      code: 'DEVICE_NOT_FOUND',
    });
  });
});
