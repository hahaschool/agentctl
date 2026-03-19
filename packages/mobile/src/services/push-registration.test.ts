import { describe, expect, it, vi } from 'vitest';

import { MobileClientError } from './api-client.js';
import { type PushNotificationRuntime, PushRegistrationService } from './push-registration.js';

function makeRuntime(overrides: Partial<PushNotificationRuntime> = {}): PushNotificationRuntime {
  return {
    getProjectId: vi.fn().mockReturnValue('project-123'),
    getAppId: vi.fn().mockReturnValue('com.agentctl.mobile'),
    getPermissionsAsync: vi.fn().mockResolvedValue({ status: 'undetermined' }),
    requestPermissionsAsync: vi.fn().mockResolvedValue({ status: 'granted' }),
    getExpoPushTokenAsync: vi.fn().mockResolvedValue({ data: 'ExponentPushToken[token-123]' }),
    getLastNotificationRouteAsync: vi.fn().mockResolvedValue(null),
    addNotificationResponseListener: vi.fn().mockReturnValue({ remove: vi.fn() }),
    ...overrides,
  };
}

describe('PushRegistrationService', () => {
  it('requests permission, resolves projectId, gets a token, and upserts the Expo device', async () => {
    const runtime = makeRuntime();
    const upsertDevice = vi.fn().mockResolvedValue({ ok: true });
    const service = new PushRegistrationService({
      runtime,
      upsertDevice,
      now: () => new Date('2026-03-19T08:00:00.000Z'),
    });

    await expect(service.bootstrap()).resolves.toEqual({
      status: 'registered',
      projectId: 'project-123',
      token: 'ExponentPushToken[token-123]',
      payload: {
        userId: 'mobile-operator',
        platform: 'ios',
        provider: 'expo',
        pushToken: 'ExponentPushToken[token-123]',
        appId: 'com.agentctl.mobile',
        lastSeenAt: '2026-03-19T08:00:00.000Z',
      },
    });

    expect(runtime.requestPermissionsAsync).toHaveBeenCalledOnce();
    expect(runtime.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'project-123' });
    expect(upsertDevice).toHaveBeenCalledWith({
      userId: 'mobile-operator',
      platform: 'ios',
      provider: 'expo',
      pushToken: 'ExponentPushToken[token-123]',
      appId: 'com.agentctl.mobile',
      lastSeenAt: '2026-03-19T08:00:00.000Z',
    });
  });

  it('returns permission-denied without requesting a token when notifications stay denied', async () => {
    const runtime = makeRuntime({
      requestPermissionsAsync: vi.fn().mockResolvedValue({ status: 'denied' }),
    });
    const upsertDevice = vi.fn();
    const service = new PushRegistrationService({ runtime, upsertDevice });

    await expect(service.bootstrap()).resolves.toEqual({
      status: 'skipped',
      reason: 'permission-denied',
    });

    expect(runtime.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(upsertDevice).not.toHaveBeenCalled();
  });

  it('treats missing backend support as deferred instead of crashing startup', async () => {
    const runtime = makeRuntime({
      getPermissionsAsync: vi.fn().mockResolvedValue({ status: 'granted' }),
    });
    const upsertDevice = vi
      .fn()
      .mockRejectedValue(new MobileClientError('HTTP_404', 'Not found', { status: 404 }));
    const service = new PushRegistrationService({ runtime, upsertDevice });

    await expect(service.bootstrap()).resolves.toEqual({
      status: 'deferred',
      reason: 'endpoint-unavailable',
      payload: {
        userId: 'mobile-operator',
        platform: 'ios',
        provider: 'expo',
        pushToken: 'ExponentPushToken[token-123]',
        appId: 'com.agentctl.mobile',
        lastSeenAt: expect.any(String),
      },
    });

    expect(runtime.requestPermissionsAsync).not.toHaveBeenCalled();
  });
});
