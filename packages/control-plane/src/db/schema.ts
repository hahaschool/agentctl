import {
  bigint,
  bigserial,
  boolean,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const machines = pgTable('machines', {
  id: text('id').primaryKey(),
  hostname: text('hostname').unique().notNull(),
  tailscaleIp: inet('tailscale_ip').notNull(),
  os: text('os').notNull(),
  arch: text('arch').notNull(),
  status: text('status').default('online'),
  lastHeartbeat: timestamp('last_heartbeat', { withTimezone: true }),
  capabilities: jsonb('capabilities').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const agents = pgTable(
  'agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    machineId: text('machine_id').references(() => machines.id),
    name: text('name').notNull(),
    type: text('type').notNull(),
    status: text('status').default('registered'),
    schedule: text('schedule'),
    projectPath: text('project_path'),
    worktreeBranch: text('worktree_branch'),
    currentSessionId: text('current_session_id'),
    config: jsonb('config').default({}),
    /** Scheduled session configuration (sessionMode, promptTemplate, pattern, timezone). */
    scheduleConfig: jsonb('schedule_config'),
    /** Loop configuration (mode, limits, delay). Stores LoopConfig from @agentctl/shared. */
    loopConfig: jsonb('loop_config'),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastCostUsd: numeric('last_cost_usd', { precision: 10, scale: 6 }),
    totalCostUsd: numeric('total_cost_usd', { precision: 12, scale: 6 }).default('0'),
    accountId: uuid('account_id').references(() => apiAccounts.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [index('idx_agents_machine_id').on(table.machineId)],
);

export const agentRuns = pgTable(
  'agent_runs',
  {
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
    /** Which iteration of a loop this run represents (null for non-loop runs). */
    loopIteration: integer('loop_iteration'),
    /** Links sub-runs to their parent loop run (null for top-level runs). */
    parentRunId: text('parent_run_id'),
  },
  (table) => [
    index('idx_agent_runs_agent_id_status').on(table.agentId, table.status),
    index('idx_agent_runs_created_at').on(table.startedAt),
  ],
);

export const rcSessions = pgTable(
  'rc_sessions',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id').notNull(),
    machineId: text('machine_id')
      .notNull()
      .references(() => machines.id),
    sessionUrl: text('session_url'),
    claudeSessionId: text('claude_session_id'),
    status: text('status').notNull().default('starting'),
    projectPath: text('project_path'),
    model: text('model'),
    pid: integer('pid'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    lastHeartbeat: timestamp('last_heartbeat', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    metadata: jsonb('metadata').default({}),
    accountId: uuid('account_id').references(() => apiAccounts.id, { onDelete: 'set null' }),
  },
  (table) => [
    index('idx_rc_sessions_agent_id').on(table.agentId),
    index('idx_rc_sessions_machine_id').on(table.machineId),
    index('idx_rc_sessions_status').on(table.status),
  ],
);

export const agentActions = pgTable(
  'agent_actions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    runId: uuid('run_id').references(() => agentRuns.id),
    timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow(),
    actionType: text('action_type').notNull(),
    toolName: text('tool_name'),
    toolInput: jsonb('tool_input'),
    toolOutputHash: text('tool_output_hash'),
    durationMs: integer('duration_ms'),
    approvedBy: text('approved_by'),
  },
  (table) => [index('idx_agent_actions_run_id').on(table.runId)],
);

export const apiAccounts = pgTable(
  'api_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    provider: text('provider').notNull(),
    credential: text('credential').notNull(),
    credentialIv: text('credential_iv').notNull(),
    priority: integer('priority').notNull().default(0),
    rateLimit: jsonb('rate_limit').default({}),
    isActive: boolean('is_active').default(true),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_api_accounts_provider').on(table.provider),
    index('idx_api_accounts_is_active').on(table.isActive),
  ],
);

export const projectAccountMappings = pgTable(
  'project_account_mappings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectPath: text('project_path').notNull().unique(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => apiAccounts.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [index('idx_project_account_mappings_account_id').on(table.accountId)],
);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
