import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const promotionHistory = pgTable('promotion_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceTier: text('source_tier').notNull(),
  targetTier: text('target_tier').notNull().default('beta'),
  status: text('status').notNull().default('pending'),
  checks: jsonb('checks').default([]),
  error: text('error'),
  gitSha: text('git_sha'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  durationMs: integer('duration_ms'),
  triggeredBy: text('triggered_by').notNull().default('web'),
});
