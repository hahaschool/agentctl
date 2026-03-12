import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { spaces, threads } from './schema-collaboration.js';

// ── Context References (cross-space pointers / snapshots) ────

export const contextRefs = pgTable(
  'context_refs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceSpaceId: uuid('source_space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    sourceThreadId: uuid('source_thread_id').references(() => threads.id, {
      onDelete: 'set null',
    }),
    sourceEventId: uuid('source_event_id'),
    targetSpaceId: uuid('target_space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    targetThreadId: uuid('target_thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    mode: text('mode').notNull(),
    snapshotPayload: jsonb('snapshot_payload'),
    metadata: jsonb('metadata').default({}),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_context_refs_source_space').on(table.sourceSpaceId),
    index('idx_context_refs_target_space').on(table.targetSpaceId),
    index('idx_context_refs_target_thread').on(table.targetThreadId),
  ],
);

// ── Cross-Space Subscriptions (real-time event feeds) ────────

export const crossSpaceSubscriptions = pgTable(
  'cross_space_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceSpaceId: uuid('source_space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    targetSpaceId: uuid('target_space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    filterCriteria: jsonb('filter_criteria').default({}),
    active: boolean('active').default(true),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_cross_space_subs_source').on(table.sourceSpaceId),
    index('idx_cross_space_subs_target').on(table.targetSpaceId),
  ],
);
