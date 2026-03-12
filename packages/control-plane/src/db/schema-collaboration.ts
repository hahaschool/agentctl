import {
  bigint,
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// ── Collaboration: Spaces + Threads + Events ─────────────────

export const spaces = pgTable('spaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description').default(''),
  type: text('type').notNull(),
  visibility: text('visibility').default('team'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const spaceMembers = pgTable(
  'space_members',
  {
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    memberType: text('member_type').notNull(),
    memberId: text('member_id').notNull(),
    role: text('role').notNull().default('member'),
  },
  (table) => [
    primaryKey({ columns: [table.spaceId, table.memberType, table.memberId] }),
    index('idx_space_members_member_id').on(table.memberId),
  ],
);

export const threads = pgTable(
  'threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [index('idx_threads_space_id').on(table.spaceId)],
);

export const spaceEvents = pgTable(
  'space_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => threads.id),
    sequenceNum: bigint('sequence_num', { mode: 'number' }).notNull(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    correlationId: text('correlation_id').notNull(),
    type: text('type').notNull(),
    senderType: text('sender_type').notNull(),
    senderId: text('sender_id').notNull(),
    payload: jsonb('payload').notNull(),
    visibility: text('visibility').default('public'),
    published: boolean('published').default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_space_events_thread_seq').on(table.threadId, table.sequenceNum),
    index('idx_space_events_outbox').on(table.published),
  ],
);

export const sessionSpaceLinks = pgTable('session_space_links', {
  sessionId: text('session_id').primaryKey(),
  spaceId: uuid('space_id')
    .notNull()
    .references(() => spaces.id, { onDelete: 'cascade' }),
  linkedAt: timestamp('linked_at', { withTimezone: true }).defaultNow(),
});
