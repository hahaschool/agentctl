// ---------------------------------------------------------------------------
// HandoffNotificationService — uses Expo Notifications to alert when a
// handoff occurs. Designed to be initialized once at app startup and
// polled periodically to detect new handoff events.
// ---------------------------------------------------------------------------

import type { ManagedRuntime } from '@agentctl/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HandoffNotificationEvent = {
  handoffId: string;
  sourceRuntime: ManagedRuntime;
  targetRuntime: ManagedRuntime;
  reason: string;
  status: 'pending' | 'succeeded' | 'failed';
  sessionId: string;
};

export type NotificationPermissionStatus = 'granted' | 'denied' | 'undetermined';

export type HandoffNotificationConfig = {
  /** Callback to schedule a local notification (abstracted for testability). */
  scheduleNotification: (params: {
    title: string;
    body: string;
    data: Record<string, string>;
  }) => Promise<string>;
  /** Callback to request notification permissions. */
  requestPermissions: () => Promise<NotificationPermissionStatus>;
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class HandoffNotificationService {
  private readonly scheduleNotification: HandoffNotificationConfig['scheduleNotification'];
  private readonly requestPermissions: HandoffNotificationConfig['requestPermissions'];
  private readonly seenHandoffIds = new Set<string>();
  private permissionStatus: NotificationPermissionStatus = 'undetermined';

  constructor(config: HandoffNotificationConfig) {
    this.scheduleNotification = config.scheduleNotification;
    this.requestPermissions = config.requestPermissions;
  }

  /** Request notification permissions from the OS. */
  async initialize(): Promise<NotificationPermissionStatus> {
    this.permissionStatus = await this.requestPermissions();
    return this.permissionStatus;
  }

  /** Check a batch of handoff events and fire notifications for new ones. */
  async processHandoffEvents(events: HandoffNotificationEvent[]): Promise<string[]> {
    if (this.permissionStatus !== 'granted') return [];

    const notificationIds: string[] = [];

    for (const event of events) {
      if (this.seenHandoffIds.has(event.handoffId)) continue;
      this.seenHandoffIds.add(event.handoffId);

      const title = buildNotificationTitle(event);
      const body = buildNotificationBody(event);

      try {
        const notificationId = await this.scheduleNotification({
          title,
          body,
          data: {
            handoffId: event.handoffId,
            sessionId: event.sessionId,
            type: 'handoff',
          },
        });
        notificationIds.push(notificationId);
      } catch {
        // Notification scheduling failed — not critical, continue.
      }
    }

    return notificationIds;
  }

  /** Mark a handoff as already seen (e.g., loaded from initial fetch). */
  markSeen(handoffIds: readonly string[]): void {
    for (const id of handoffIds) {
      this.seenHandoffIds.add(id);
    }
  }

  /** Clear all tracked handoff IDs. */
  reset(): void {
    this.seenHandoffIds.clear();
  }

  get currentPermissionStatus(): NotificationPermissionStatus {
    return this.permissionStatus;
  }
}

// ---------------------------------------------------------------------------
// Notification content builders
// ---------------------------------------------------------------------------

function runtimeLabel(runtime: ManagedRuntime): string {
  return runtime === 'claude-code' ? 'Claude Code' : 'Codex';
}

function buildNotificationTitle(event: HandoffNotificationEvent): string {
  if (event.status === 'failed') {
    return `Handoff Failed: ${runtimeLabel(event.sourceRuntime)}`;
  }
  return `Handoff: ${runtimeLabel(event.sourceRuntime)} → ${runtimeLabel(event.targetRuntime)}`;
}

function buildNotificationBody(event: HandoffNotificationEvent): string {
  const reason = event.reason.replaceAll('-', ' ');
  if (event.status === 'failed') {
    return `A ${reason} handoff from ${runtimeLabel(event.sourceRuntime)} failed.`;
  }
  if (event.status === 'succeeded') {
    return `Session handed off to ${runtimeLabel(event.targetRuntime)} (${reason}).`;
  }
  return `Handoff in progress: ${runtimeLabel(event.sourceRuntime)} → ${runtimeLabel(event.targetRuntime)} (${reason}).`;
}
