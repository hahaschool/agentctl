import { MobileClientError } from './api-client.js';
import {
  buildPushDeviceUpsertPayload,
  PushRegistrationService,
  resolveExpoProjectId,
} from './push-registration.js';

describe('push registration helpers', () => {
  it('prefers expoConfig extra.eas.projectId before easConfig.projectId', () => {
    expect(
      resolveExpoProjectId({
        expoConfig: { extra: { eas: { projectId: 'expo-config-project' } } },
        easConfig: { projectId: 'native-project' },
      }),
    ).toBe('expo-config-project');
  });

  it('falls back to easConfig.projectId when expoConfig is absent', () => {
    expect(
      resolveExpoProjectId({
        easConfig: { projectId: 'native-project' },
      }),
    ).toBe('native-project');
  });

  it('builds the control-plane upsert payload with the default operator label', () => {
    expect(
      buildPushDeviceUpsertPayload({
        pushToken: 'ExponentPushToken[abc123]',
        appId: 'com.agentctl.mobile',
        lastSeenAt: '2026-03-19T12:00:00.000Z',
      }),
    ).toEqual({
      userId: 'operator',
      platform: 'ios',
      provider: 'expo',
      pushToken: 'ExponentPushToken[abc123]',
      appId: 'com.agentctl.mobile',
      lastSeenAt: '2026-03-19T12:00:00.000Z',
    });
  });
});

describe('PushRegistrationService', () => {
  const NOW = '2026-03-19T12:00:00.000Z';

  function createService(
    overrides: Partial<ConstructorParameters<typeof PushRegistrationService>[0]> = {},
  ) {
    return new PushRegistrationService({
      platform: 'ios',
      isDevice: true,
      constants: {
        expoConfig: { extra: { eas: { projectId: 'project-123' } } },
      },
      getPermissionsAsync: vi.fn().mockResolvedValue({ status: 'undetermined' }),
      requestPermissionsAsync: vi.fn().mockResolvedValue({ status: 'granted' }),
      getExpoPushTokenAsync: vi
        .fn()
        .mockResolvedValue({ data: 'ExponentPushToken[push-token-123]' }),
      getApplicationId: vi.fn().mockReturnValue('com.agentctl.mobile'),
      now: () => NOW,
      ...overrides,
    });
  }

  it('returns physical-device-required on simulators and emulators', async () => {
    const service = createService({ isDevice: false });

    const result = await service.bootstrap();

    expect(result).toEqual({
      status: 'physical-device-required',
      platform: 'ios',
    });
  });

  it('returns permission-denied when permission is rejected', async () => {
    const getPermissionsAsync = vi.fn().mockResolvedValue({ status: 'denied' });
    const requestPermissionsAsync = vi.fn().mockResolvedValue({ status: 'denied' });
    const service = createService({
      getPermissionsAsync,
      requestPermissionsAsync,
    });

    const result = await service.bootstrap();

    expect(result).toEqual({
      status: 'permission-denied',
      permissionStatus: 'denied',
    });
    expect(getPermissionsAsync).toHaveBeenCalledOnce();
    expect(requestPermissionsAsync).toHaveBeenCalledOnce();
  });

  it('returns missing-project-id before requesting OS permissions when config is absent', async () => {
    const getPermissionsAsync = vi.fn();
    const requestPermissionsAsync = vi.fn();
    const getExpoPushTokenAsync = vi.fn();
    const service = createService({
      constants: {},
      getPermissionsAsync,
      requestPermissionsAsync,
      getExpoPushTokenAsync,
    });

    const result = await service.bootstrap();

    expect(result).toEqual({ status: 'missing-project-id' });
    expect(getPermissionsAsync).not.toHaveBeenCalled();
    expect(requestPermissionsAsync).not.toHaveBeenCalled();
    expect(getExpoPushTokenAsync).not.toHaveBeenCalled();
  });

  it('returns token-acquired with the prepared upsert payload when no backend upsert callback is provided', async () => {
    const service = createService({
      getPermissionsAsync: vi.fn().mockResolvedValue({ status: 'granted' }),
      requestPermissionsAsync: vi.fn(),
      userId: 'primary-operator',
    });

    const result = await service.bootstrap();

    expect(result).toEqual({
      status: 'token-acquired',
      projectId: 'project-123',
      pushToken: 'ExponentPushToken[push-token-123]',
      payload: {
        userId: 'primary-operator',
        platform: 'ios',
        provider: 'expo',
        pushToken: 'ExponentPushToken[push-token-123]',
        appId: 'com.agentctl.mobile',
        lastSeenAt: NOW,
      },
    });
  });

  it('upserts the prepared payload when the backend callback succeeds', async () => {
    const upsertDevice = vi.fn().mockResolvedValue(undefined);
    const service = createService({
      getPermissionsAsync: vi.fn().mockResolvedValue({ status: 'granted' }),
      requestPermissionsAsync: vi.fn(),
      upsertDevice,
    });

    const result = await service.bootstrap();

    expect(result).toEqual({
      status: 'registered',
      projectId: 'project-123',
      pushToken: 'ExponentPushToken[push-token-123]',
      payload: {
        userId: 'operator',
        platform: 'ios',
        provider: 'expo',
        pushToken: 'ExponentPushToken[push-token-123]',
        appId: 'com.agentctl.mobile',
        lastSeenAt: NOW,
      },
    });
    expect(upsertDevice).toHaveBeenCalledWith(result.payload);
  });

  it('classifies missing backend routes as backend-unavailable while preserving the prepared payload', async () => {
    const upsertDevice = vi
      .fn()
      .mockRejectedValue(new MobileClientError('HTTP_404', 'HTTP 404 Not Found'));
    const service = createService({
      getPermissionsAsync: vi.fn().mockResolvedValue({ status: 'granted' }),
      requestPermissionsAsync: vi.fn(),
      upsertDevice,
    });

    const result = await service.bootstrap();

    expect(result.status).toBe('backend-unavailable');
    expect(result.payload.pushToken).toBe('ExponentPushToken[push-token-123]');
    expect(result.error).toBeInstanceOf(MobileClientError);
  });
});
