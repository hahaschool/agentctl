import type { NotificationPreference } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { notificationPreferenceRoutes } from './notification-preferences.js';

type NotificationRouterStoreMock = {
  getPreferences: ReturnType<typeof vi.fn>;
  setPreference: ReturnType<typeof vi.fn>;
  deletePreference: ReturnType<typeof vi.fn>;
};

function makePreference(overrides: Partial<NotificationPreference> = {}): NotificationPreference {
  return {
    id: 'pref-1',
    userId: 'user-1',
    priority: 'high',
    channels: ['push', 'in-app'],
    quietHoursStart: '22:00',
    quietHoursEnd: '07:30',
    timezone: 'Asia/Shanghai',
    createdAt: '2026-03-19T00:00:00.000Z',
    ...overrides,
  };
}

async function buildApp(
  notificationRouterStore: NotificationRouterStoreMock,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(notificationPreferenceRoutes, {
    prefix: '/api/notifications/preferences',
    notificationRouterStore: notificationRouterStore as never,
  });
  await app.ready();
  return app;
}

describe('notificationPreferenceRoutes', () => {
  let app: FastifyInstance;
  let notificationRouterStore: NotificationRouterStoreMock;

  beforeEach(async () => {
    notificationRouterStore = {
      getPreferences: vi.fn(),
      setPreference: vi.fn(),
      deletePreference: vi.fn(),
    };

    app = await buildApp(notificationRouterStore);
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  describe('GET /api/notifications/preferences', () => {
    it('lists notification preferences for a user', async () => {
      const preferences = [
        makePreference(),
        makePreference({
          id: 'pref-2',
          priority: 'critical',
          channels: ['webhook-slack'],
        }),
      ];
      notificationRouterStore.getPreferences.mockResolvedValue(preferences);

      const response = await app.inject({
        method: 'GET',
        url: '/api/notifications/preferences?userId=user-1',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ preferences });
      expect(notificationRouterStore.getPreferences).toHaveBeenCalledWith('user-1');
    });

    it('returns 400 when userId is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/notifications/preferences',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: 'INVALID_USER_ID',
        message: 'A "userId" query parameter is required',
      });
      expect(notificationRouterStore.getPreferences).not.toHaveBeenCalled();
    });

    it('returns 500 when listing preferences fails', async () => {
      notificationRouterStore.getPreferences.mockRejectedValue(new Error('db offline'));

      const response = await app.inject({
        method: 'GET',
        url: '/api/notifications/preferences?userId=user-1',
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        error: 'PREFERENCE_LIST_FAILED',
        message: 'Failed to list notification preferences: db offline',
      });
    });
  });

  describe('GET /api/notifications/preferences/:userId', () => {
    it('fetches notification preferences for a specific user', async () => {
      const preferences = [makePreference({ userId: 'user-42' })];
      notificationRouterStore.getPreferences.mockResolvedValue(preferences);

      const response = await app.inject({
        method: 'GET',
        url: '/api/notifications/preferences/user-42',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ preferences });
      expect(notificationRouterStore.getPreferences).toHaveBeenCalledWith('user-42');
    });

    it('returns 500 when fetching a user preference list fails', async () => {
      notificationRouterStore.getPreferences.mockRejectedValue(new Error('read failed'));

      const response = await app.inject({
        method: 'GET',
        url: '/api/notifications/preferences/user-42',
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        error: 'PREFERENCE_GET_FAILED',
        message: 'Failed to get notification preferences: read failed',
      });
    });
  });

  describe('POST /api/notifications/preferences', () => {
    const validPayload = {
      userId: 'user-1',
      priority: 'high',
      channels: ['push', 'in-app'],
      quietHoursStart: '21:30',
      quietHoursEnd: '08:15',
      timezone: 'Asia/Shanghai',
    };

    it('creates or updates a notification preference', async () => {
      const preference = makePreference({
        userId: validPayload.userId,
        priority: validPayload.priority,
        channels: validPayload.channels,
        quietHoursStart: validPayload.quietHoursStart,
        quietHoursEnd: validPayload.quietHoursEnd,
        timezone: validPayload.timezone,
      });
      notificationRouterStore.setPreference.mockResolvedValue(preference);

      const response = await app.inject({
        method: 'POST',
        url: '/api/notifications/preferences',
        payload: validPayload,
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({ ok: true, preference });
      expect(notificationRouterStore.setPreference).toHaveBeenCalledWith(validPayload);
    });

    it.each([
      {
        name: 'userId is missing',
        payload: { ...validPayload, userId: '' },
        expected: {
          error: 'INVALID_USER_ID',
          message: 'A non-empty "userId" string is required',
        },
      },
      {
        name: 'priority is invalid',
        payload: { ...validPayload, priority: 'urgent' },
        expected: {
          error: 'INVALID_PRIORITY',
          message: 'Invalid priority "urgent". Must be one of: critical, high, normal, low',
        },
      },
      {
        name: 'channels are missing',
        payload: { ...validPayload, channels: [] },
        expected: {
          error: 'INVALID_CHANNELS',
          message: 'A non-empty "channels" array is required',
        },
      },
      {
        name: 'a channel is invalid',
        payload: { ...validPayload, channels: ['push', 'email'] },
        expected: {
          error: 'INVALID_CHANNELS',
          message:
            'Invalid channel "email". Must be one of: push, webhook-slack, webhook-discord, webhook-generic, in-app',
        },
      },
      {
        name: 'quietHoursStart is invalid',
        payload: { ...validPayload, quietHoursStart: '25:00' },
        expected: {
          error: 'INVALID_QUIET_HOURS',
          message: '"quietHoursStart" must be in HH:MM format (00:00 - 23:59)',
        },
      },
      {
        name: 'quietHoursEnd is invalid',
        payload: { ...validPayload, quietHoursEnd: '9pm' },
        expected: {
          error: 'INVALID_QUIET_HOURS',
          message: '"quietHoursEnd" must be in HH:MM format (00:00 - 23:59)',
        },
      },
    ])('returns 400 when $name', async ({ payload, expected }) => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/notifications/preferences',
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual(expected);
      expect(notificationRouterStore.setPreference).not.toHaveBeenCalled();
    });

    it('returns 500 when saving a preference fails', async () => {
      notificationRouterStore.setPreference.mockRejectedValue(new Error('write failed'));

      const response = await app.inject({
        method: 'POST',
        url: '/api/notifications/preferences',
        payload: validPayload,
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        error: 'PREFERENCE_SET_FAILED',
        message: 'Failed to set notification preference: write failed',
      });
    });
  });

  describe('DELETE /api/notifications/preferences/:id', () => {
    it('deletes a notification preference', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/notifications/preferences/pref-1',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true, deletedId: 'pref-1' });
      expect(notificationRouterStore.deletePreference).toHaveBeenCalledWith('pref-1');
    });

    it('returns 404 when the preference does not exist', async () => {
      const error = Object.assign(new Error('missing'), { code: 'PREFERENCE_NOT_FOUND' });
      notificationRouterStore.deletePreference.mockRejectedValue(error);

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/notifications/preferences/pref-missing',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        error: 'PREFERENCE_NOT_FOUND',
        message: "Notification preference 'pref-missing' not found",
      });
    });

    it('returns 500 when deleting a preference fails unexpectedly', async () => {
      notificationRouterStore.deletePreference.mockRejectedValue(new Error('delete failed'));

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/notifications/preferences/pref-1',
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        error: 'PREFERENCE_DELETE_FAILED',
        message: 'Failed to delete notification preference: delete failed',
      });
    });
  });
});
