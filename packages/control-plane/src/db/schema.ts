import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  numeric,
  bigint,
  bigserial,
  integer,
  inet,
} from 'drizzle-orm/pg-core';

export const machines = pgTable('machines', {
  id: uuid('id').primaryKey().defaultRandom(),
  hostname: text('hostname').unique().notNull(),
  tailscaleIp: inet('tailscale_ip').notNull(),
  os: text('os').notNull(),
  arch: text('arch').notNull(),
  status: text('status').default('online'),
  lastHeartbeat: timestamp('last_heartbeat', { withTimezone: true }),
  capabilities: jsonb('capabilities').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  machineId: uuid('machine_id').references(() => machines.id),
  name: text('name').notNull(),
  type: text('type').notNull(),
  status: text('status').default('idle'),
  schedule: text('schedule'),
  projectPath: text('project_path'),
  worktreeBranch: text('worktree_branch'),
  currentSessionId: text('current_session_id'),
  config: jsonb('config').default({}),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastCostUsd: numeric('last_cost_usd', { precision: 10, scale: 6 }),
  totalCostUsd: numeric('total_cost_usd', { precision: 12, scale: 6 }).default('0'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const agentRuns = pgTable('agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').references(() => agents.id),
  trigger: text('trigger').notNull(),
  status: text('status').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
  tokensIn: bigint('tokens_in', { mode: 'number' }),
  tokensOut: bigint('tokens_out', { mode: 'number' }),
  model: text('model'),
  provider: text('provider'),
  sessionId: text('session_id'),
  errorMessage: text('error_message'),
  resultSummary: text('result_summary'),
});

export const agentActions = pgTable('agent_actions', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  runId: uuid('run_id').references(() => agentRuns.id),
  timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow(),
  actionType: text('action_type').notNull(),
  toolName: text('tool_name'),
  toolInput: jsonb('tool_input'),
  toolOutputHash: text('tool_output_hash'),
  durationMs: integer('duration_ms'),
  approvedBy: text('approved_by'),
});
