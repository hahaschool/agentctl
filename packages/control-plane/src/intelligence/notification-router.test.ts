import type { NotificationPreference } from '@agentctl/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WebhookDispatcher } from '../notifications/webhook-dispatcher.js';
import { NotificationRouter } from './notification-router.js';
import type { NotificationRouterStore } from './notification-router-store.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLogger(): ReturnType<typeof createSilentLogger> {
  return createSilentLogger();
}

function createSilentLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    // biome-ignore lint/suspicious/noExplicitAny: test mock
  } as any;
}

function makePreference(overrides?: Partial<NotificationPreference>): NotificationPreference {
  return {
    id: 'pref-1',
    userId: 'user-1',
    priority: 'normal',
    channels: ['in-app'],
    createdAt: '2026-03-12T00:00:00.000Z',
    ...overrides,
  };
}

function makeStore(prefs: NotificationPreference[] = []): NotificationRouterStore {
  return {
    getPreferences: vi.fn().mockResolvedValue(prefs),
    setPreference: vi.fn(),
    deletePreference: vi.fn(),
    // biome-ignore lint/suspicious/noExplicitAny: test mock
  } as any;
}

function makeDispatcher(): WebhookDispatcher {
  return {
    dispatch: vi.fn().mockResolvedValue([]),
    register: vi.fn(),
    unregister: vi.fn(),
    getWebhooks: vi.fn().mockReturnValue([]),
    formatPayload: vi.fn(),
    // biome-ignore lint/suspicious/noExplicitAny: test mock
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NotificationRouter', () => {
  let store: NotificationRouterStore;
  let dispatcher: WebhookDispatcher;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    store = makeStore();
    dispatcher = makeDispatcher();
    logger = makeLogger();
  });

  // ── classifyPriority ──────────────────────────────────────────────

  describe('classifyPriority', () => {
    it('maps agent.error to critical', () => {
      const router = new NotificationRouter(store, dispatcher, logger);
      expect(router.classifyPriority('agent.error')).toBe('critical');
    });

    it('maps deploy.failure to critical', () => {
      const router = new NotificationRouter(store, dispatcher, logger);
      expect(router.classifyPriority('deploy.failure')).toBe('critical');
    });

    it('maps audit.high_severity to critical', () => {
      const router = new NotificationRouter(store, dispatcher, logger);
      expect(router.classifyPriority('audit.high_severity')).toBe('critical');
    });

    it('maps agent.cost_alert to high', () => {
      const router = new NotificationRouter(store, dispatcher, logger);
      expect(router.classifyPriority('agent.cost_alert')).toBe('high');
    });

    it('maps approval.pending to high', () => {
      const router = new NotificationRouter(store, dispatcher, logger);
      expect(router.classifyPriority('approval.pending')).toBe('high');
    });

    it('maps approval.timed_out to critical', () => {
      const router = new NotificationRouter(store, dispatcher, logger);
      expect(router.classifyPriority('approval.timed_out')).toBe('critical');
    });

    it('maps agent.stopped to normal', () => {
      const router = new NotificationRouter(store, dispatcher, logger);
      expect(router.classifyPriority('agent.stopped')).toBe('normal');
    });

    it('maps agent.started to low', () => {
      const router = new NotificationRouter(store, dispatcher, logger);
      expect(router.classifyPriority('agent.started')).toBe('low');
    });

    it('maps deploy.success to low', () => {
      const router = new NotificationRouter(store, dispatcher, logger);
      expect(router.classifyPriority('deploy.success')).toBe('low');
    });

    it('defaults unknown events to normal', () => {
      const router = new NotificationRouter(store, dispatcher, logger);
      expect(router.classifyPriority('some.unknown.event')).toBe('normal');
    });
  });

  // ── isQuietHours ──────────────────────────────────────────────────

  describe('isQuietHours', () => {
    it('returns false when quiet hours are not configured', () => {
      const router = new NotificationRouter(store, dispatcher, logger);
      const pref = makePreference({ quietHoursStart: undefined, quietHoursEnd: undefined });
      expect(router.isQuietHours(pref)).toBe(false);
    });

    it('returns false when only start is configured', () => {
      const router = new NotificationRouter(store, dispatcher, logger);
      const pref = makePreference({ quietHoursStart: '22:00', quietHoursEnd: undefined });
      expect(router.isQuietHours(pref)).toBe(false);
    });

    it('returns false when only end is configured', () => {
      const router = new NotificationRouter(store, dispatcher, logger);
      const pref = makePreference({ quietHoursStart: undefined, quietHoursEnd: '07:00' });
      expect(router.isQuietHours(pref)).toBe(false);
    });

    it('returns false when time format is invalid', () => {
      const router = new NotificationRouter(store, dispatcher, logger);
      const pref = makePreference({ quietHoursStart: 'invalid', quietHoursEnd: '07:00' });
      expect(router.isQuietHours(pref)).toBe(false);
    });

    it('returns false when hours are out of range', () => {
      const router = new NotificationRouter(store, dispatcher, logger);
      const pref = makePreference({ quietHoursStart: '25:00', quietHoursEnd: '07:00' });
      expect(router.isQuietHours(pref)).toBe(false);
    });

    it('handles timezone gracefully when invalid', () => {
      const router = new NotificationRouter(store, dispatcher, logger);
      // With an invalid timezone, it should fall back to UTC and not throw
      const pref = makePreference({
        quietHoursStart: '00:00',
        quietHoursEnd: '00:01',
        timezone: 'Invalid/Timezone',
      });
      // Should not throw
      expect(typeof router.isQuietHours(pref)).toBe('boolean');
    });
  });

  // ── route ─────────────────────────────────────────────────────────

  describe('route', () => {
    it('uses default in-app channel when user has no preferences', async () => {
      const router = new NotificationRouter(store, dispatcher, logger);

      await router.route('agent.started', { agentId: 'a1' }, ['user-1']);

      expect(store.getPreferences).toHaveBeenCalledWith('user-1');
      // in-app channel should be logged (not a webhook dispatch)
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'in-app', userId: 'user-1' }),
        expect.any(String),
      );
    });

    it('dispatches webhook when user prefers webhook-slack', async () => {
      const prefs = [makePreference({ priority: 'low', channels: ['webhook-slack'] })];
      store = makeStore(prefs);
      const router = new NotificationRouter(store, dispatcher, logger);

      await router.route('agent.started', { agentId: 'a1' }, ['user-1']);

      expect(dispatcher.dispatch).toHaveBeenCalledWith(
        'agent.started',
        expect.objectContaining({ agentId: 'a1', userId: 'user-1' }),
      );
    });

    it('routes to multiple users independently', async () => {
      const router = new NotificationRouter(store, dispatcher, logger);

      await router.route('agent.started', {}, ['user-1', 'user-2']);

      expect(store.getPreferences).toHaveBeenCalledWith('user-1');
      expect(store.getPreferences).toHaveBeenCalledWith('user-2');
    });

    it('continues routing even if one user lookup fails', async () => {
      const mockGetPrefs = vi
        .fn()
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce([]);

      store = {
        ...makeStore(),
        getPreferences: mockGetPrefs,
      } as unknown as NotificationRouterStore;
      const router = new NotificationRouter(store, dispatcher, logger);

      // Should not throw
      await router.route('agent.started', {}, ['user-1', 'user-2']);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', error: 'DB error' }),
        expect.any(String),
      );
      // user-2 should still get processed
      expect(mockGetPrefs).toHaveBeenCalledTimes(2);
    });

    it('always delivers critical notifications even during quiet hours', async () => {
      // Create a preference with quiet hours covering all times
      const prefs = [
        makePreference({
          priority: 'critical',
          channels: ['webhook-slack'],
          quietHoursStart: '00:00',
          quietHoursEnd: '23:59',
          timezone: 'UTC',
        }),
      ];
      store = makeStore(prefs);
      const router = new NotificationRouter(store, dispatcher, logger);

      await router.route('agent.error', { agentId: 'a1' }, ['user-1']);

      // Critical should still dispatch through webhook
      expect(dispatcher.dispatch).toHaveBeenCalled();
    });

    it('logs warning when webhook delivery fails', async () => {
      const prefs = [makePreference({ priority: 'low', channels: ['webhook-generic'] })];
      store = makeStore(prefs);

      const failingDispatcher = makeDispatcher();
      (failingDispatcher.dispatch as ReturnType<typeof vi.fn>).mockResolvedValue([
        { webhookId: 'wh-1', success: false, error: 'Connection refused', durationMs: 100 },
      ]);

      const router = new NotificationRouter(store, failingDispatcher, logger);

      await router.route('agent.started', {}, ['user-1']);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ webhookId: 'wh-1', error: 'Connection refused' }),
        expect.any(String),
      );
    });
  });
});
