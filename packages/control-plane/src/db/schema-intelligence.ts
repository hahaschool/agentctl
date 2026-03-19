import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { approvalGates } from './schema-collaboration.js';
import { taskDefinitions, taskRuns, workerNodes } from './schema-task-graph.js';

// ── Routing Decisions ───────────────────────────────────────

export const routingDecisions = pgTable(
  'routing_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskDefId: uuid('task_def_id')
      .notNull()
      .references(() => taskDefinitions.id),
    taskRunId: uuid('task_run_id')
      .notNull()
      .references(() => taskRuns.id),
    profileId: uuid('profile_id').notNull(),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => workerNodes.id),
    score: real('score').notNull(),
    breakdown: jsonb('breakdown').notNull(),
    mode: text('mode').notNull().default('auto'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_routing_decisions_task_run').on(table.taskRunId),
    index('idx_routing_decisions_profile').on(table.profileId),
  ],
);

// ── Routing Outcomes ────────────────────────────────────────

export const routingOutcomes = pgTable(
  'routing_outcomes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    routingDecisionId: uuid('routing_decision_id').references(() => routingDecisions.id),
    taskRunId: uuid('task_run_id')
      .notNull()
      .references(() => taskRuns.id),
    profileId: uuid('profile_id').notNull(),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => workerNodes.id),
    capabilities: text('capabilities').array().notNull().default([]),
    status: text('status').notNull(),
    durationMs: integer('duration_ms'),
    costUsd: real('cost_usd'),
    tokensUsed: integer('tokens_used'),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_routing_outcomes_profile').on(table.profileId),
    index('idx_routing_outcomes_status').on(table.status),
  ],
);

// ── Approval Timings ────────────────────────────────────────

export const approvalTimings = pgTable(
  'approval_timings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gateId: uuid('gate_id')
      .notNull()
      .references(() => approvalGates.id),
    decidedBy: text('decided_by').notNull(),
    capabilities: text('capabilities').array().notNull().default([]),
    decisionTimeMs: integer('decision_time_ms').notNull(),
    timedOut: boolean('timed_out').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [index('idx_approval_timings_decided_by').on(table.decidedBy)],
);

// ── Notification Preferences ────────────────────────────────

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    priority: text('priority').notNull(),
    channels: text('channels').array().notNull().default([]),
    quietHoursStart: text('quiet_hours_start'),
    quietHoursEnd: text('quiet_hours_end'),
    timezone: text('timezone'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [unique('uq_notification_pref_user_priority').on(table.userId, table.priority)],
);

// ── Mobile Push Devices ─────────────────────────────────────

export const mobilePushDevices = pgTable(
  'mobile_push_devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    platform: text('platform').$type<'ios'>().notNull(),
    provider: text('provider').$type<'expo'>().notNull(),
    pushToken: text('push_token').notNull(),
    appId: text('app_id').notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('uq_mobile_push_devices_provider_token').on(table.provider, table.pushToken),
    index('idx_mobile_push_devices_user_id').on(table.userId),
    index('idx_mobile_push_devices_updated_at').on(table.updatedAt),
    index('idx_mobile_push_devices_disabled_at').on(table.disabledAt),
  ],
);
