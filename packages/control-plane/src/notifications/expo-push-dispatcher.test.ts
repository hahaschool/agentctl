import { describe, expect, it, vi } from 'vitest';

import { ExpoPushDispatcher } from './expo-push-dispatcher.js';

function makeDevice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'device-1',
    platform: 'ios',
    provider: 'expo',
    pushToken: 'ExponentPushToken[abc123]',
    ...overrides,
  };
}

describe('ExpoPushDispatcher', () => {
  it('sends approval.pending payloads to every device with the approvals route metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { status: 'ok', id: 'ticket-1' },
          { status: 'ok', id: 'ticket-2' },
        ],
      }),
    });

    const dispatcher = new ExpoPushDispatcher({ fetch: fetchMock as typeof fetch });

    const result = await dispatcher.dispatchApprovalPending({
      requestId: 'req-123',
      devices: [
        makeDevice(),
        makeDevice({
          id: 'device-2',
          pushToken: 'ExponentPushToken[xyz789]',
        }),
      ],
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://exp.host/--/api/v2/push/send');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual([
      {
        to: 'ExponentPushToken[abc123]',
        sound: 'default',
        title: 'Approval required',
        body: 'Open AgentCTL to review a pending approval request.',
        data: {
          type: 'approval.pending',
          requestId: 'req-123',
          route: 'approvals',
        },
      },
      {
        to: 'ExponentPushToken[xyz789]',
        sound: 'default',
        title: 'Approval required',
        body: 'Open AgentCTL to review a pending approval request.',
        data: {
          type: 'approval.pending',
          requestId: 'req-123',
          route: 'approvals',
        },
      },
    ]);
    expect(result.failures).toEqual([]);
    expect(result.deliveries).toEqual([
      { token: 'ExponentPushToken[abc123]', ticketId: 'ticket-1' },
      { token: 'ExponentPushToken[xyz789]', ticketId: 'ticket-2' },
    ]);
  });

  it('applies a bounded request timeout so approval creation is not blocked by a hung Expo call', async () => {
    const signal = new AbortController().signal;
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [{ status: 'ok', id: 'ticket-1' }],
      }),
    });

    const dispatcher = new ExpoPushDispatcher({
      fetch: fetchMock as typeof fetch,
      timeoutMs: 4_321,
    });

    await dispatcher.dispatchApprovalPending({
      requestId: 'req-123',
      devices: [makeDevice()],
    });

    expect(timeoutSpy).toHaveBeenCalledWith(4_321);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(signal);
    timeoutSpy.mockRestore();
  });

  it('marks DeviceNotRegistered ticket errors as permanent invalid-token failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            status: 'error',
            message: '"ExponentPushToken[abc123]" is not a registered push notification recipient',
            details: { error: 'DeviceNotRegistered' },
          },
        ],
      }),
    });

    const dispatcher = new ExpoPushDispatcher({ fetch: fetchMock as typeof fetch });

    const result = await dispatcher.dispatchApprovalPending({
      requestId: 'req-123',
      devices: [makeDevice()],
    });

    expect(result.deliveries).toEqual([]);
    expect(result.failures).toEqual([
      {
        token: 'ExponentPushToken[abc123]',
        message: '"ExponentPushToken[abc123]" is not a registered push notification recipient',
        details: { error: 'DeviceNotRegistered' },
        permanent: true,
      },
    ]);
  });

  it('returns non-permanent failures for request-level delivery errors without throwing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({
        errors: [{ code: 'UNAVAILABLE', message: 'Expo temporarily unavailable' }],
      }),
    });

    const dispatcher = new ExpoPushDispatcher({ fetch: fetchMock as typeof fetch });

    const result = await dispatcher.dispatchApprovalPending({
      requestId: 'req-123',
      devices: [makeDevice()],
    });

    expect(result.deliveries).toEqual([]);
    expect(result.failures).toEqual([
      {
        token: 'ExponentPushToken[abc123]',
        message: 'Expo push request failed with HTTP 503',
        details: { errors: [{ code: 'UNAVAILABLE', message: 'Expo temporarily unavailable' }] },
        permanent: false,
      },
    ]);
  });
});
