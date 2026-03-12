import type { NotificationPreference } from '@agentctl/shared';
import { ControlPlaneError } from '@agentctl/shared';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';
import { notificationPreferences } from '../db/index.js';

type SetPreferenceInput = {
  userId: string;
  priority: string;
  channels: string[];
  quietHoursStart?: string;
  quietHoursEnd?: string;
  timezone?: string;
};

export class NotificationRouterStore {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  async getPreferences(userId: string): Promise<NotificationPreference[]> {
    const rows = await this.db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId));

    return rows.map((row) => this.toPreference(row));
  }

  async setPreference(input: SetPreferenceInput): Promise<NotificationPreference> {
    const rows = await this.db
      .insert(notificationPreferences)
      .values({
        userId: input.userId,
        priority: input.priority,
        channels: input.channels,
        quietHoursStart: input.quietHoursStart ?? null,
        quietHoursEnd: input.quietHoursEnd ?? null,
        timezone: input.timezone ?? null,
      })
      .onConflictDoUpdate({
        target: [notificationPreferences.userId, notificationPreferences.priority],
        set: {
          channels: input.channels,
          quietHoursStart: input.quietHoursStart ?? null,
          quietHoursEnd: input.quietHoursEnd ?? null,
          timezone: input.timezone ?? null,
        },
      })
      .returning();

    if (rows.length === 0) {
      throw new ControlPlaneError(
        'PREFERENCE_SET_FAILED',
        'Failed to upsert notification preference',
        {
          input,
        },
      );
    }

    this.logger.info(
      { userId: input.userId, priority: input.priority },
      'Notification preference set',
    );
    return this.toPreference(rows[0]);
  }

  async deletePreference(id: string): Promise<void> {
    const result = await this.db
      .delete(notificationPreferences)
      .where(eq(notificationPreferences.id, id))
      .returning({ id: notificationPreferences.id });

    if (result.length === 0) {
      throw new ControlPlaneError(
        'PREFERENCE_NOT_FOUND',
        `Notification preference '${id}' does not exist`,
        { id },
      );
    }

    this.logger.info({ preferenceId: id }, 'Notification preference deleted');
  }

  private toPreference(row: typeof notificationPreferences.$inferSelect): NotificationPreference {
    return {
      id: row.id,
      userId: row.userId,
      priority: row.priority as NotificationPreference['priority'],
      channels: (row.channels ?? []) as NotificationPreference['channels'],
      quietHoursStart: row.quietHoursStart ?? undefined,
      quietHoursEnd: row.quietHoursEnd ?? undefined,
      timezone: row.timezone ?? undefined,
      createdAt: (row.createdAt ?? new Date()).toISOString(),
    };
  }
}
