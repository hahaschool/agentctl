import { describe, expect, it } from 'vitest';

import type {
  DeactivateMobilePushDeviceRequest,
  ListMobilePushDevicesQuery,
  MobilePushDevice,
  MobilePushDevicePlatform,
  MobilePushProvider,
  UpsertMobilePushDeviceRequest,
} from './mobile-push-device.js';
import {
  isMobilePushDevicePlatform,
  isMobilePushProvider,
  MOBILE_PUSH_DEVICE_PLATFORMS,
  MOBILE_PUSH_PROVIDERS,
} from './mobile-push-device.js';

describe('mobile push device types', () => {
  it('exposes the supported platform and provider constants', () => {
    expect(MOBILE_PUSH_DEVICE_PLATFORMS).toEqual(['ios']);
    expect(MOBILE_PUSH_PROVIDERS).toEqual(['expo']);
  });

  it('validates known platforms and providers', () => {
    expect(isMobilePushDevicePlatform('ios')).toBe(true);
    expect(isMobilePushDevicePlatform('android')).toBe(false);
    expect(isMobilePushProvider('expo')).toBe(true);
    expect(isMobilePushProvider('apns')).toBe(false);
  });

  it('supports the shared request and record payload shapes', () => {
    const platform: MobilePushDevicePlatform = 'ios';
    const provider: MobilePushProvider = 'expo';

    const upsert: UpsertMobilePushDeviceRequest = {
      userId: 'operator-dev-1',
      platform,
      provider,
      pushToken: 'ExponentPushToken[abc123]',
      appId: 'dev.hahaschool.agentctl',
      lastSeenAt: '2026-03-19T10:00:00.000Z',
    };

    const listQuery: ListMobilePushDevicesQuery = {
      userId: 'operator-dev-1',
      includeDisabled: false,
      platform,
      provider,
    };

    const deactivate: DeactivateMobilePushDeviceRequest = {
      disabledAt: '2026-03-19T10:05:00.000Z',
    };
    const lastSeenAt = upsert.lastSeenAt ?? '2026-03-19T10:00:00.000Z';

    const record: MobilePushDevice = {
      id: 'device-1',
      userId: upsert.userId,
      platform,
      provider,
      pushToken: upsert.pushToken,
      appId: upsert.appId,
      lastSeenAt,
      disabledAt: deactivate.disabledAt,
      createdAt: '2026-03-19T09:59:00.000Z',
      updatedAt: '2026-03-19T10:05:00.000Z',
    };

    expect(record.platform).toBe('ios');
    expect(record.provider).toBe('expo');
    expect(listQuery.includeDisabled).toBe(false);
    expect(deactivate.disabledAt).toContain('2026-03-19');
  });
});
