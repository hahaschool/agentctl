import { describe, expect, it } from 'vitest';

import type {
  DeactivateMobilePushDeviceResponse,
  ListMobilePushDevicesResponse,
  MobilePushDevice,
  MobilePushPlatform,
  MobilePushProvider,
  UpsertMobilePushDeviceRequest,
  UpsertMobilePushDeviceResponse,
} from './mobile-push-device.js';
import {
  isMobilePushPlatform,
  isMobilePushProvider,
  MOBILE_PUSH_PLATFORMS,
  MOBILE_PUSH_PROVIDERS,
} from './mobile-push-device.js';

const NOW = '2026-03-19T10:00:00.000Z';

describe('mobile push device types', () => {
  it('exports the expected supported platforms', () => {
    const platforms: MobilePushPlatform[] = ['ios'];
    expect(platforms).toEqual(['ios']);
    expect([...MOBILE_PUSH_PLATFORMS]).toEqual(['ios']);
    expect(isMobilePushPlatform('ios')).toBe(true);
    expect(isMobilePushPlatform('android')).toBe(false);
  });

  it('exports the expected supported providers', () => {
    const providers: MobilePushProvider[] = ['expo'];
    expect(providers).toEqual(['expo']);
    expect([...MOBILE_PUSH_PROVIDERS]).toEqual(['expo']);
    expect(isMobilePushProvider('expo')).toBe(true);
    expect(isMobilePushProvider('apns')).toBe(false);
  });

  it('defines the mobile push device record shape', () => {
    const device: MobilePushDevice = {
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
    };

    expect(device.platform).toBe('ios');
    expect(device.provider).toBe('expo');
    expect(device.disabledAt).toBeNull();
  });

  it('defines shared request and response payloads', () => {
    const request: UpsertMobilePushDeviceRequest = {
      userId: 'operator-1',
      platform: 'ios',
      provider: 'expo',
      pushToken: 'ExponentPushToken[abc123]',
      appId: 'com.agentctl.mobile',
      lastSeenAt: NOW,
    };
    const device: MobilePushDevice = {
      id: 'device-1',
      userId: request.userId,
      platform: request.platform,
      provider: request.provider,
      pushToken: request.pushToken,
      appId: request.appId,
      lastSeenAt: NOW,
      disabledAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const upsertResponse: UpsertMobilePushDeviceResponse = { ok: true, device };
    const listResponse: ListMobilePushDevicesResponse = { devices: [device] };
    const deactivateResponse: DeactivateMobilePushDeviceResponse = { ok: true, device };

    expect(upsertResponse.device.pushToken).toContain('ExponentPushToken');
    expect(listResponse.devices).toHaveLength(1);
    expect(deactivateResponse.ok).toBe(true);
  });
});
