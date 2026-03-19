import type { ControlPlaneError, MobilePushDevice } from '@agentctl/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../api/routes/test-helpers.js';
import type { Database } from '../db/index.js';
import { createMockDb, type MockDb } from '../runtime-management/test-helpers.js';
import { MobilePushDeviceStore } from './mobile-push-device-store.js';

const NOW = new Date('2026-03-19T10:00:00.000Z');

function makeRow(overrides: Record<string, unknown> = {}) {
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

function setTerminalValue(mockDb: MockDb, value: unknown): void {
  // biome-ignore lint/suspicious/noThenProperty: drizzle query builders are thenable
  (mockDb as Record<string, unknown>).then = (
    resolve: (value: unknown) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(value).then(resolve, reject);
}

describe('MobilePushDeviceStore', () => {
  let mockDb: MockDb;
  let store: MobilePushDeviceStore;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    store = new MobilePushDeviceStore(mockDb as unknown as Database, createMockLogger());
  });

  it('upserts a device by provider + push token and returns the mapped record', async () => {
    mockDb.returning.mockResolvedValueOnce([makeRow()]);

    const device = await store.upsertDevice({
      userId: 'operator-1',
      platform: 'ios',
      provider: 'expo',
      pushToken: 'ExponentPushToken[abc123]',
      appId: 'com.agentctl.mobile',
      lastSeenAt: NOW,
    });

    expect(mockDb.insert).toHaveBeenCalledOnce();
    expect(mockDb.values).toHaveBeenCalledWith({
      userId: 'operator-1',
      platform: 'ios',
      provider: 'expo',
      pushToken: 'ExponentPushToken[abc123]',
      appId: 'com.agentctl.mobile',
      lastSeenAt: NOW,
      disabledAt: null,
      updatedAt: expect.any(Date),
    });
    expect(mockDb.onConflictDoUpdate).toHaveBeenCalledOnce();
    expect(device).toMatchObject<Partial<MobilePushDevice>>({
      id: 'device-1',
      userId: 'operator-1',
      platform: 'ios',
      provider: 'expo',
      disabledAt: null,
    });
  });

  it('lists mapped devices for a user', async () => {
    const rows = [makeRow(), makeRow({ id: 'device-2', pushToken: 'ExponentPushToken[xyz789]' })];
    setTerminalValue(mockDb, rows);

    const devices = await store.listDevices({ userId: 'operator-1', includeDisabled: false });

    expect(mockDb.select).toHaveBeenCalledOnce();
    expect(mockDb.from).toHaveBeenCalledOnce();
    expect(mockDb.where).toHaveBeenCalledOnce();
    expect(mockDb.orderBy).toHaveBeenCalledOnce();
    expect(devices).toHaveLength(2);
    expect(devices[1]?.id).toBe('device-2');
  });

  it('deactivates a device by id and returns the mapped record', async () => {
    mockDb.returning.mockResolvedValueOnce([makeRow({ disabledAt: NOW })]);

    const device = await store.deactivateDevice('device-1', NOW);

    expect(mockDb.update).toHaveBeenCalledOnce();
    expect(mockDb.set).toHaveBeenCalledWith({
      disabledAt: NOW,
      updatedAt: expect.any(Date),
    });
    expect(device.disabledAt).toBe(NOW.toISOString());
  });

  it('supports deactivation by provider + push token for later dispatcher pruning', async () => {
    mockDb.returning.mockResolvedValueOnce([makeRow({ disabledAt: NOW })]);

    const device = await store.deactivateByToken({
      provider: 'expo',
      pushToken: 'ExponentPushToken[abc123]',
      disabledAt: NOW,
    });

    expect(mockDb.update).toHaveBeenCalledOnce();
    expect(device.provider).toBe('expo');
    expect(device.disabledAt).toBe(NOW.toISOString());
  });

  it('throws when deactivating a missing device', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    await expect(store.deactivateDevice('missing-device', NOW)).rejects.toMatchObject<
      Partial<ControlPlaneError>
    >({
      code: 'MOBILE_PUSH_DEVICE_NOT_FOUND',
    });
  });
});
