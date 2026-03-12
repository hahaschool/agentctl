import type {
  NotificationChannel,
  NotificationPreference,
  NotificationPriority,
  WebhookEventType,
} from '@agentctl/shared';
import type { Logger } from 'pino';

import type { WebhookDispatcher } from '../notifications/webhook-dispatcher.js';

import type { NotificationRouterStore } from './notification-router-store.js';

// ── Default Priority Mapping ──────────────────────────────────

const DEFAULT_PRIORITY_MAP: Record<string, NotificationPriority> = {
  'agent.error': 'critical',
  'deploy.failure': 'critical',
  'audit.high_severity': 'critical',
  'agent.cost_alert': 'high',
  'approval.pending': 'high',
  'approval.timed_out': 'critical',
  'agent.stopped': 'normal',
  'agent.started': 'low',
  'deploy.success': 'low',
};

const DEFAULT_CHANNELS: readonly NotificationChannel[] = ['in-app'];

// ── Channel-to-webhook mapping ────────────────────────────────

const CHANNEL_TO_WEBHOOK_EVENT: Partial<Record<NotificationChannel, true>> = {
  'webhook-slack': true,
  'webhook-discord': true,
  'webhook-generic': true,
};

export class NotificationRouter {
  constructor(
    private readonly preferences: NotificationRouterStore,
    private readonly webhookDispatcher: WebhookDispatcher,
    private readonly logger: Logger,
  ) {}

  /**
   * Route a notification event to the appropriate channels for each target user.
   *
   * 1. Classify event priority
   * 2. For each target user, resolve channel preferences for this priority
   * 3. Filter out channels blocked by quiet hours
   * 4. Dispatch to each resolved channel
   */
  async route(
    event: WebhookEventType,
    data: Record<string, unknown>,
    targetUserIds: readonly string[],
  ): Promise<void> {
    const priority = this.classifyPriority(event);

    this.logger.debug({ event, priority, targetUserIds }, 'Routing notification');

    const dispatchPromises: Promise<void>[] = [];

    for (const userId of targetUserIds) {
      try {
        const userPrefs = await this.preferences.getPreferences(userId);
        const matchingPref = userPrefs.find((p) => p.priority === priority);

        const channels = matchingPref?.channels ?? DEFAULT_CHANNELS;

        // Filter channels if quiet hours are active (critical always goes through)
        const activeChannels =
          priority === 'critical' || !matchingPref || !this.isQuietHours(matchingPref)
            ? channels
            : [];

        if (activeChannels.length === 0) {
          this.logger.debug({ userId, event, priority }, 'All channels suppressed by quiet hours');
          continue;
        }

        for (const channel of activeChannels) {
          if (CHANNEL_TO_WEBHOOK_EVENT[channel]) {
            // Delegate webhook channels to the existing WebhookDispatcher
            dispatchPromises.push(
              this.webhookDispatcher.dispatch(event, { ...data, userId }).then((results) => {
                for (const result of results) {
                  if (!result.success) {
                    this.logger.warn(
                      { webhookId: result.webhookId, error: result.error, userId, event },
                      'Webhook delivery failed during notification routing',
                    );
                  }
                }
              }),
            );
          } else {
            // For push and in-app channels, log the intent (actual dispatch is a future concern)
            this.logger.info(
              { channel, userId, event, priority },
              'Notification dispatched to channel',
            );
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          { userId, event, error: message },
          'Failed to route notification for user',
        );
      }
    }

    await Promise.all(dispatchPromises);
  }

  /**
   * Classify the priority of an event based on the default mapping.
   * Unknown events default to 'normal'.
   */
  classifyPriority(eventType: string): NotificationPriority {
    return DEFAULT_PRIORITY_MAP[eventType] ?? 'normal';
  }

  /**
   * Determine whether a user's quiet hours are currently active.
   *
   * Quiet hours are expressed as HH:MM strings in the user's timezone.
   * If timezone is not set, the check is performed in UTC.
   * Handles overnight ranges (e.g. 22:00 - 07:00).
   */
  isQuietHours(preference: NotificationPreference): boolean {
    const { quietHoursStart, quietHoursEnd, timezone } = preference;

    if (!quietHoursStart || !quietHoursEnd) {
      return false;
    }

    const startMinutes = parseTimeToMinutes(quietHoursStart);
    const endMinutes = parseTimeToMinutes(quietHoursEnd);

    if (startMinutes === null || endMinutes === null) {
      return false;
    }

    const nowMinutes = getCurrentMinutesInTimezone(timezone);

    // Handle overnight range (e.g. 22:00 - 07:00)
    if (startMinutes > endMinutes) {
      return nowMinutes >= startMinutes || nowMinutes < endMinutes;
    }

    // Normal range (e.g. 09:00 - 17:00)
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
}

// ── Helpers ───────────────────────────────────────────────────

function parseTimeToMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
}

function getCurrentMinutesInTimezone(timezone?: string): number {
  const now = new Date();

  if (!timezone) {
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });

    const parts = formatter.formatToParts(now);
    const hourPart = parts.find((p) => p.type === 'hour');
    const minutePart = parts.find((p) => p.type === 'minute');

    const hours = Number(hourPart?.value ?? 0);
    const minutes = Number(minutePart?.value ?? 0);

    return hours * 60 + minutes;
  } catch {
    // Invalid timezone, fall back to UTC
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
}
