import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClient } from './api-client.js';
import {
  MobilePushDeviceApi,
  type MobilePushDeviceUpsertRequest,
} from './mobile-push-device-api.js';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>(),
}));

vi.stubGlobal('fetch', mocks.fetch);

function jsonResponse(body: unknown, status = 200, statusText = 'OK'): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('MobilePushDeviceApi', () => {
  let apiClient: ApiClient;
  let deviceApi: MobilePushDeviceApi;

  beforeEach(() => {
    vi.clearAllMocks();
    apiClient = new ApiClient({ baseUrl: 'https://cp.example.com', authToken: 'tok_mobile' });
    deviceApi = new MobilePushDeviceApi(apiClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('posts Expo push device upserts to the control plane route', async () => {
    const payload: MobilePushDeviceUpsertRequest = {
      userId: 'mobile-operator',
      platform: 'ios',
      provider: 'expo',
      pushToken: 'ExponentPushToken[abc123]',
      appId: 'com.agentctl.mobile',
      lastSeenAt: '2026-03-19T08:00:00.000Z',
    };

    mocks.fetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

    await deviceApi.upsertDevice(payload);

    const [url, init] = mocks.fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://cp.example.com/api/mobile-push-devices');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok_mobile');
    expect(JSON.parse(String(init?.body))).toEqual(payload);
  });
});
