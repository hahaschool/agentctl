import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NotificationRouterStore } from '../../intelligence/notification-router-store.js';
import { notificationPreferenceRoutes } from './notification-preferences.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const USER_ID = 'user-abc-123';
const PREF_ID = 'pref-00000000-0000-4000-a000-000000000001';

function makePreference(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PREF_ID,
    userId: USER_ID,
    priority: 'high',
    channels: ['push', 'in-app'],
    quietHoursStart: undefined,
    quietHoursEnd: undefined,
    timezone: undefined,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── Store mock ────────────────────────────────────────────────────────────────

function createMockStore(): NotificationRouterStore {
  return {
    getPreferences: vi.fn().mockResolvedValue([]),
    setPreference: vi.fn().mockResolvedValue(makePreference()),
    deletePreference: vi.fn().mockResolvedValue(undefined),
  } as unknown as NotificationRouterStore;
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('notification-preferences routes', () => {
  let app: FastifyInstance;
  let store: ReturnType<typeof createMockStore>;

  beforeEach(async () => {
    store = createMockStore();

    app = Fastify({ logger: false });
    await app.register(notificationPreferenceRoutes, {
      prefix: '/api/notification-preferences',
      notificationRouterStore: store,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  // ── GET / ────────────────────────────────────────────────────────────────────

  describe('GET /api/notification-preferences', () => {
    it('returns preferences for a valid userId', async () => {
      const prefs = [makePreference(), makePreference({ id: 'pref-2', priority: 'low' })];
      vi.mocked(store.getPreferences).mockResolvedValueOnce(prefs as never);

      const res = await app.inject({
        method: 'GET',
        url: `/api/notification-preferences?userId=${USER_ID}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.preferences).toHaveLength(2);
      expect(store.getPreferences).toHaveBeenCalledWith(USER_ID);
    });

    it('returns empty array when user has no preferences', async () => {
      vi.mocked(store.getPreferences).mockResolvedValueOnce([]);

      const res = await app.inject({
        method: 'GET',
        url: `/api/notification-preferences?userId=${USER_ID}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().preferences).toHaveLength(0);
    });

    it('returns 400 when userId query param is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/notification-preferences',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_USER_ID');
    });

    it('returns 500 when store throws', async () => {
      vi.mocked(store.getPreferences).mockRejectedValueOnce(new Error('db connection lost'));

      const res = await app.inject({
        method: 'GET',
        url: `/api/notification-preferences?userId=${USER_ID}`,
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().error).toBe('PREFERENCE_LIST_FAILED');
    });
  });

  // ── GET /:userId ─────────────────────────────────────────────────────────────

  describe('GET /api/notification-preferences/:userId', () => {
    it('returns preferences for the given userId path param', async () => {
      const prefs = [makePreference()];
      vi.mocked(store.getPreferences).mockResolvedValueOnce(prefs as never);

      const res = await app.inject({
        method: 'GET',
        url: `/api/notification-preferences/${USER_ID}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.preferences).toHaveLength(1);
      expect(store.getPreferences).toHaveBeenCalledWith(USER_ID);
    });

    it('returns empty preferences array when user has no preferences', async () => {
      vi.mocked(store.getPreferences).mockResolvedValueOnce([]);

      const res = await app.inject({
        method: 'GET',
        url: `/api/notification-preferences/${USER_ID}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().preferences).toHaveLength(0);
    });

    it('returns 500 when store throws', async () => {
      vi.mocked(store.getPreferences).mockRejectedValueOnce(new Error('unexpected failure'));

      const res = await app.inject({
        method: 'GET',
        url: `/api/notification-preferences/${USER_ID}`,
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().error).toBe('PREFERENCE_GET_FAILED');
    });
  });

  // ── POST / ───────────────────────────────────────────────────────────────────

  describe('POST /api/notification-preferences', () => {
    const validBody = {
      userId: USER_ID,
      priority: 'high',
      channels: ['push', 'in-app'],
    };

    it('creates a preference and returns 201', async () => {
      const created = makePreference();
      vi.mocked(store.setPreference).mockResolvedValueOnce(created as never);

      const res = await app.inject({
        method: 'POST',
        url: '/api/notification-preferences',
        payload: validBody,
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.preference.userId).toBe(USER_ID);
      expect(body.preference.priority).toBe('high');
    });

    it('passes all optional fields to the store', async () => {
      const bodyWithOptionals = {
        ...validBody,
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
        timezone: 'America/New_York',
      };
      const created = makePreference({
        quietHoursStart: '22:00',
        quietHoursEnd: '07:00',
        timezone: 'America/New_York',
      });
      vi.mocked(store.setPreference).mockResolvedValueOnce(created as never);

      const res = await app.inject({
        method: 'POST',
        url: '/api/notification-preferences',
        payload: bodyWithOptionals,
      });

      expect(res.statusCode).toBe(201);
      expect(store.setPreference).toHaveBeenCalledWith(
        expect.objectContaining({
          quietHoursStart: '22:00',
          quietHoursEnd: '07:00',
          timezone: 'America/New_York',
        }),
      );
    });

    it('returns 400 when userId is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/notification-preferences',
        payload: { ...validBody, userId: '' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_USER_ID');
    });

    it('returns 400 when priority is invalid', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/notification-preferences',
        payload: { ...validBody, priority: 'urgent' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_PRIORITY');
    });

    it('returns 400 when priority is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/notification-preferences',
        payload: { ...validBody, priority: '' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_PRIORITY');
    });

    it('returns 400 when channels is an empty array', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/notification-preferences',
        payload: { ...validBody, channels: [] },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_CHANNELS');
    });

    it('returns 400 when channels contains an invalid channel', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/notification-preferences',
        payload: { ...validBody, channels: ['push', 'sms'] },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_CHANNELS');
    });

    it('returns 400 when channels is not an array', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/notification-preferences',
        payload: { ...validBody, channels: 'push' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_CHANNELS');
    });

    it('returns 400 when quietHoursStart has invalid format', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/notification-preferences',
        payload: { ...validBody, quietHoursStart: '25:00' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_QUIET_HOURS');
    });

    it('returns 400 when quietHoursStart has non-numeric format', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/notification-preferences',
        payload: { ...validBody, quietHoursStart: 'midnight' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_QUIET_HOURS');
    });

    it('returns 400 when quietHoursEnd has invalid format', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/notification-preferences',
        payload: { ...validBody, quietHoursEnd: '99:99' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('INVALID_QUIET_HOURS');
    });

    it('accepts all valid priority values', async () => {
      const priorities = ['critical', 'high', 'normal', 'low'];
      for (const priority of priorities) {
        vi.mocked(store.setPreference).mockResolvedValueOnce(makePreference({ priority }) as never);

        const res = await app.inject({
          method: 'POST',
          url: '/api/notification-preferences',
          payload: { ...validBody, priority },
        });

        expect(res.statusCode).toBe(201);
      }
    });

    it('accepts all valid channel values', async () => {
      const channels = ['push', 'webhook-slack', 'webhook-discord', 'webhook-generic', 'in-app'];
      vi.mocked(store.setPreference).mockResolvedValueOnce(makePreference({ channels }) as never);

      const res = await app.inject({
        method: 'POST',
        url: '/api/notification-preferences',
        payload: { ...validBody, channels },
      });

      expect(res.statusCode).toBe(201);
    });

    it('returns 500 when store throws', async () => {
      vi.mocked(store.setPreference).mockRejectedValueOnce(new Error('insert failed'));

      const res = await app.inject({
        method: 'POST',
        url: '/api/notification-preferences',
        payload: validBody,
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().error).toBe('PREFERENCE_SET_FAILED');
    });
  });

  // ── DELETE /:id ──────────────────────────────────────────────────────────────

  describe('DELETE /api/notification-preferences/:id', () => {
    it('deletes a preference and returns ok', async () => {
      vi.mocked(store.deletePreference).mockResolvedValueOnce(undefined);

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/notification-preferences/${PREF_ID}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.deletedId).toBe(PREF_ID);
      expect(store.deletePreference).toHaveBeenCalledWith(PREF_ID);
    });

    it('returns 404 when preference does not exist', async () => {
      const notFoundError = new Error('not found') as Error & { code: string };
      notFoundError.code = 'PREFERENCE_NOT_FOUND';
      vi.mocked(store.deletePreference).mockRejectedValueOnce(notFoundError);

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/notification-preferences/${PREF_ID}`,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('PREFERENCE_NOT_FOUND');
    });

    it('returns 500 for unexpected errors during delete', async () => {
      vi.mocked(store.deletePreference).mockRejectedValueOnce(new Error('database unavailable'));

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/notification-preferences/${PREF_ID}`,
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().error).toBe('PREFERENCE_DELETE_FAILED');
    });
  });
});
