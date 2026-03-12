import { NOTIFICATION_CHANNELS, NOTIFICATION_PRIORITIES } from '@agentctl/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { NotificationRouterStore } from '../../intelligence/notification-router-store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationPreferenceRoutesOptions = {
  notificationRouterStore: NotificationRouterStore;
};

type SetPreferenceBody = {
  userId: string;
  priority: string;
  channels: string[];
  quietHoursStart?: string;
  quietHoursEnd?: string;
  timezone?: string;
};

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isValidPriority(value: string): boolean {
  return (NOTIFICATION_PRIORITIES as readonly string[]).includes(value);
}

function isValidChannel(value: string): boolean {
  return (NOTIFICATION_CHANNELS as readonly string[]).includes(value);
}

const TIME_PATTERN = /^\d{1,2}:\d{2}$/;

function isValidTime(value: string): boolean {
  if (!TIME_PATTERN.test(value)) {
    return false;
  }
  const [hours, minutes] = value.split(':').map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const notificationPreferenceRoutes: FastifyPluginAsync<
  NotificationPreferenceRoutesOptions
> = async (app, opts) => {
  const { notificationRouterStore } = opts;

  // ── GET / — List all preferences (requires userId query param) ────
  app.get<{ Querystring: { userId?: string } }>(
    '/',
    {
      schema: {
        tags: ['notifications'],
        summary: 'List notification preferences for a user',
      },
    },
    async (request, reply) => {
      const { userId } = request.query;

      if (!userId || typeof userId !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_USER_ID',
          message: 'A "userId" query parameter is required',
        });
      }

      try {
        const preferences = await notificationRouterStore.getPreferences(userId);
        return { preferences };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.code(500).send({
          error: 'PREFERENCE_LIST_FAILED',
          message: `Failed to list notification preferences: ${message}`,
        });
      }
    },
  );

  // ── GET /:userId — Get preferences for a specific user ────────────
  app.get<{ Params: { userId: string } }>(
    '/:userId',
    {
      schema: {
        tags: ['notifications'],
        summary: 'Get notification preferences for a specific user',
      },
    },
    async (request, reply) => {
      const { userId } = request.params;

      try {
        const preferences = await notificationRouterStore.getPreferences(userId);
        return { preferences };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.code(500).send({
          error: 'PREFERENCE_GET_FAILED',
          message: `Failed to get notification preferences: ${message}`,
        });
      }
    },
  );

  // ── POST / — Create or update a notification preference ───────────
  app.post<{ Body: SetPreferenceBody }>(
    '/',
    {
      schema: {
        tags: ['notifications'],
        summary: 'Create or update a notification preference',
      },
    },
    async (request, reply) => {
      const { userId, priority, channels, quietHoursStart, quietHoursEnd, timezone } = request.body;

      if (!userId || typeof userId !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_USER_ID',
          message: 'A non-empty "userId" string is required',
        });
      }

      if (!priority || !isValidPriority(priority)) {
        return reply.code(400).send({
          error: 'INVALID_PRIORITY',
          message: `Invalid priority "${priority}". Must be one of: ${NOTIFICATION_PRIORITIES.join(', ')}`,
        });
      }

      if (!Array.isArray(channels) || channels.length === 0) {
        return reply.code(400).send({
          error: 'INVALID_CHANNELS',
          message: 'A non-empty "channels" array is required',
        });
      }

      for (const channel of channels) {
        if (!isValidChannel(channel)) {
          return reply.code(400).send({
            error: 'INVALID_CHANNELS',
            message: `Invalid channel "${channel}". Must be one of: ${NOTIFICATION_CHANNELS.join(', ')}`,
          });
        }
      }

      if (quietHoursStart !== undefined && !isValidTime(quietHoursStart)) {
        return reply.code(400).send({
          error: 'INVALID_QUIET_HOURS',
          message: '"quietHoursStart" must be in HH:MM format (00:00 - 23:59)',
        });
      }

      if (quietHoursEnd !== undefined && !isValidTime(quietHoursEnd)) {
        return reply.code(400).send({
          error: 'INVALID_QUIET_HOURS',
          message: '"quietHoursEnd" must be in HH:MM format (00:00 - 23:59)',
        });
      }

      try {
        const preference = await notificationRouterStore.setPreference({
          userId,
          priority,
          channels,
          quietHoursStart,
          quietHoursEnd,
          timezone,
        });

        return reply.code(201).send({ ok: true, preference });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.code(500).send({
          error: 'PREFERENCE_SET_FAILED',
          message: `Failed to set notification preference: ${message}`,
        });
      }
    },
  );

  // ── DELETE /:id — Delete a notification preference ────────────────
  app.delete<{ Params: { id: string } }>(
    '/:id',
    {
      schema: {
        tags: ['notifications'],
        summary: 'Delete a notification preference',
      },
    },
    async (request, reply) => {
      const { id } = request.params;

      try {
        await notificationRouterStore.deletePreference(id);
        return { ok: true, deletedId: id };
      } catch (error: unknown) {
        if (error instanceof Error && 'code' in error && error.code === 'PREFERENCE_NOT_FOUND') {
          return reply.code(404).send({
            error: 'PREFERENCE_NOT_FOUND',
            message: `Notification preference '${id}' not found`,
          });
        }
        const message = error instanceof Error ? error.message : String(error);
        return reply.code(500).send({
          error: 'PREFERENCE_DELETE_FAILED',
          message: `Failed to delete notification preference: ${message}`,
        });
      }
    },
  );
};
