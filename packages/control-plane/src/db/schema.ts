import type { ExecutionSummary } from '@agentctl/shared';
import {
  type AnyPgColumn,
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
    runtime: text('runtime').default('claude-code'),
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
    resultSummary: jsonb('result_summary').$type<ExecutionSummary | string | null>(),
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

export const runtimeConfigRevisions = pgTable(
  'runtime_config_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    version: integer('version').notNull().unique(),
    hash: text('hash').notNull().unique(),
    config: jsonb('config').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_runtime_config_revisions_version').on(table.version),
    index('idx_runtime_config_revisions_hash').on(table.hash),
  ],
);

export const managedSessions = pgTable(
  'managed_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runtime: text('runtime').notNull(),
    nativeSessionId: text('native_session_id'),
    executionEnvironment: text('execution_environment'),
    machineId: text('machine_id')
      .notNull()
      .references(() => machines.id),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    projectPath: text('project_path').notNull(),
    worktreePath: text('worktree_path'),
    status: text('status').notNull().default('starting'),
    configVersion: integer('config_version').notNull(),
    handoffStrategy: text('handoff_strategy'),
    handoffSourceSessionId: uuid('handoff_source_session_id').references(
      (): AnyPgColumn => managedSessions.id,
      { onDelete: 'set null' },
    ),
    metadata: jsonb('metadata').default({}),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow(),
    lastHeartbeat: timestamp('last_heartbeat', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_managed_sessions_machine_id').on(table.machineId),
    index('idx_managed_sessions_agent_id').on(table.agentId),
    index('idx_managed_sessions_status').on(table.status),
    index('idx_managed_sessions_runtime').on(table.runtime),
  ],
);

export const machineRuntimeState = pgTable(
  'machine_runtime_state',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    machineId: text('machine_id')
      .notNull()
      .references(() => machines.id, { onDelete: 'cascade' }),
    runtime: text('runtime').notNull(),
    isInstalled: boolean('is_installed').notNull().default(false),
    isAuthenticated: boolean('is_authenticated').notNull().default(false),
    syncStatus: text('sync_status').notNull().default('unknown'),
    configVersion: integer('config_version'),
    configHash: text('config_hash'),
    metadata: jsonb('metadata').default({}),
    lastConfigAppliedAt: timestamp('last_config_applied_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_machine_runtime_state_machine_id').on(table.machineId),
    index('idx_machine_runtime_state_runtime').on(table.runtime),
  ],
);

export const sessionHandoffs = pgTable(
  'session_handoffs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceSessionId: uuid('source_session_id')
      .notNull()
      .references(() => managedSessions.id, { onDelete: 'cascade' }),
    targetSessionId: uuid('target_session_id').references(() => managedSessions.id, {
      onDelete: 'set null',
    }),
    sourceRuntime: text('source_runtime').notNull(),
    targetRuntime: text('target_runtime').notNull(),
    reason: text('reason').notNull(),
    strategy: text('strategy').notNull(),
    status: text('status').notNull().default('pending'),
    snapshot: jsonb('snapshot').notNull(),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_session_handoffs_source_session_id').on(table.sourceSessionId),
    index('idx_session_handoffs_target_session_id').on(table.targetSessionId),
    index('idx_session_handoffs_status').on(table.status),
  ],
);

export const nativeImportAttempts = pgTable(
  'native_import_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    handoffId: uuid('handoff_id').references(() => sessionHandoffs.id, { onDelete: 'set null' }),
    sourceSessionId: uuid('source_session_id').references(() => managedSessions.id, {
      onDelete: 'set null',
    }),
    targetSessionId: uuid('target_session_id').references(() => managedSessions.id, {
      onDelete: 'set null',
    }),
    sourceRuntime: text('source_runtime').notNull(),
    targetRuntime: text('target_runtime').notNull(),
    status: text('status').notNull().default('pending'),
    metadata: jsonb('metadata').default({}),
    errorMessage: text('error_message'),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_native_import_attempts_handoff_id').on(table.handoffId),
    index('idx_native_import_attempts_status').on(table.status),
  ],
);

export const memoryScopes = pgTable('memory_scopes', {
  scope: text('scope').primaryKey(),
  parentScope: text('parent_scope').references((): AnyPgColumn => memoryScopes.scope),
  displayName: text('display_name'),
  configJson: jsonb('config_json').notNull().default({}),
});

export const memoryFacts = pgTable(
  'memory_facts',
  {
    id: text('id').primaryKey(),
    scope: text('scope').notNull(),
    content: text('content').notNull(),
    contentModel: text('content_model').notNull().default('text-embedding-3-small'),
    entityType: text('entity_type').notNull(),
    confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull().default('0.800'),
    strength: numeric('strength', { precision: 4, scale: 3 }).notNull().default('1.000'),
    sourceJson: jsonb('source_json').notNull().default({}),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull().defaultNow(),
    validUntil: timestamp('valid_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    accessedAt: timestamp('accessed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_memory_facts_scope').on(table.scope),
    index('idx_memory_facts_entity_type').on(table.entityType),
  ],
);

export const memoryEdges = pgTable(
  'memory_edges',
  {
    id: text('id').primaryKey(),
    sourceFactId: text('source_fact_id')
      .notNull()
      .references(() => memoryFacts.id, { onDelete: 'cascade' }),
    targetFactId: text('target_fact_id')
      .notNull()
      .references(() => memoryFacts.id, { onDelete: 'cascade' }),
    relation: text('relation').notNull(),
    weight: numeric('weight', { precision: 4, scale: 3 }).notNull().default('0.500'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_memory_edges_source').on(table.sourceFactId),
    index('idx_memory_edges_target').on(table.targetFactId),
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
