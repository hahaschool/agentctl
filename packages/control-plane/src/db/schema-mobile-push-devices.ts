import type { MobilePushDevicePlatform, MobilePushProvider } from '@agentctl/shared';
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

export const mobilePushDevices = pgTable(
  'mobile_push_devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    platform: text('platform').$type<MobilePushDevicePlatform>().notNull(),
    provider: text('provider').$type<MobilePushProvider>().notNull(),
    pushToken: text('push_token').notNull(),
    appId: text('app_id').notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('mobile_push_devices_valid_platform', sql`${table.platform} IN ('ios')`),
    check('mobile_push_devices_valid_provider', sql`${table.provider} IN ('expo')`),
    unique('uq_mobile_push_devices_provider_token').on(table.provider, table.pushToken),
    index('idx_mobile_push_devices_user_id').on(table.userId),
    index('idx_mobile_push_devices_disabled_at').on(table.disabledAt),
  ],
);
