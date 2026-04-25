import type { DispatchConfigSnapshot, ExecutionSummary } from '@agentctl/shared';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  customType,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const vector1536 = customType<{ data: string | null; driverData: string | null }>({
  dataType() {
    return 'vector(1536)';
  },
});

const tsvector = customType<{ data: string | null; driverData: string | null }>({
  dataType() {
    return 'tsvector';
  },
});

export const machines = pgTable('machines', {
  id: text('id').primaryKey(),
  hostname: text('hostname').unique().notNull(),
  tailscaleIp: inet('tailscale_ip').notNull(),
  os: text('os').notNull(),
  arch: text('arch').notNull(),
  status: text('status').default('online'),
  lastHeartbeat: timestamp('last_heartbeat', { withTimezone: true }),
  capabilities: jsonb('capabilities').default({}),
  originNodeId: text('origin_node_id'),
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
    phase: text('phase').notNull().default('queued'),
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
    /** ID of the original run this is a retry of (null for first attempts). */
    retryOf: uuid('retry_of'),
    /** 1-based retry attempt number (null for first attempts). */
    retryIndex: integer('retry_index'),
    /** Dispatch config snapshot captured at dispatch time. Excluded from list queries. */
    dispatchConfig: jsonb('dispatch_config').$type<DispatchConfigSnapshot | null>(),
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

export const runHandoffDecisions = pgTable(
  'run_handoff_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceRunId: uuid('source_run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    sourceManagedSessionId: uuid('source_managed_session_id').references(() => managedSessions.id, {
      onDelete: 'set null',
    }),
    targetRunId: uuid('target_run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
    handoffId: uuid('handoff_id').references(() => sessionHandoffs.id, { onDelete: 'set null' }),
    trigger: text('trigger').notNull(),
    stage: text('stage').notNull(),
    mode: text('mode').notNull(),
    status: text('status').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    policySnapshot: jsonb('policy_snapshot').notNull().default({}),
    signalPayload: jsonb('signal_payload').notNull().default({}),
    reason: text('reason'),
    skippedReason: text('skipped_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_run_handoff_decisions_source_run_id').on(table.sourceRunId),
    index('idx_run_handoff_decisions_trigger').on(table.trigger),
    index('idx_run_handoff_decisions_created_at').on(table.createdAt),
  ],
);

export const memoryScopes = pgTable('memory_scopes', {
  scope: text('scope').primaryKey(),
  parentScope: text('parent_scope').references((): AnyPgColumn => memoryScopes.scope),
  displayName: text('display_name'),
  configJson: jsonb('config_json').notNull().default({}),
});

export const memoryDrawers = pgTable(
  'memory_drawers',
  {
    id: text('id').primaryKey(),
    scope: text('scope')
      .notNull()
      .references(() => memoryScopes.scope, { onDelete: 'cascade' }),
    topic: text('topic').notNull().default('general'),
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id').notNull(),
    sourceUri: text('source_uri'),
    chunkIndex: integer('chunk_index').notNull().default(0),
    content: text('content').notNull(),
    contentSha256: text('content_sha256').notNull(),
    embedding: vector1536('embedding'),
    embeddingModel: text('embedding_model').notNull().default('text-embedding-3-small'),
    embeddingVersion: integer('embedding_version').notNull().default(1),
    contentTsvSimple: tsvector('content_tsv_simple'),
    tokenCount: integer('token_count').notNull().default(0),
    sourceJson: jsonb('source_json').notNull().default({}),
    syncVisibility: text('sync_visibility').notNull().default('local'),
    retentionExpiresAt: timestamp('retention_expires_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    redactionStatus: text('redaction_status').notNull().default('unreviewed'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('memory_drawers_source_unique').on(
      table.sourceType,
      table.sourceId,
      table.chunkIndex,
    ),
    index('idx_memory_drawers_scope_topic').on(table.scope, table.topic),
    index('idx_memory_drawers_source').on(table.sourceType, table.sourceId, table.chunkIndex),
    index('idx_memory_drawers_content_sha256').on(table.contentSha256),
    index('idx_memory_drawers_retention').on(table.retentionExpiresAt),
  ],
);

export const memoryDrawerBackfillState = pgTable(
  'memory_drawer_backfill_state',
  {
    id: text('id').primaryKey(),
    sourceType: text('source_type').notNull(),
    sourceRoot: text('source_root').notNull(),
    cursorJson: jsonb('cursor_json').notNull().default({}),
    status: text('status').notNull(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('memory_drawer_backfill_source_unique').on(table.sourceType, table.sourceRoot),
    index('idx_memory_drawer_backfill_state_status').on(table.status),
  ],
);

// LOCAL-ONLY: durable Memory Import API job state. Not in TABLE_SYNC_CONFIG.
export const memoryImportJobs = pgTable(
  'memory_import_jobs',
  {
    id: text('id').primaryKey(),
    source: text('source').notNull(),
    sourcePath: text('source_path').notNull(),
    status: text('status').notNull(),
    progressCurrent: integer('progress_current').notNull().default(0),
    progressTotal: integer('progress_total').notNull().default(0),
    imported: integer('imported').notNull().default(0),
    skipped: integer('skipped').notNull().default(0),
    errors: integer('errors').notNull().default(0),
    rolledBack: integer('rolled_back').notNull().default(0),
    errorMessage: text('error_message'),
    cursorJson: jsonb('cursor_json').notNull().default({}),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_memory_import_jobs_status_updated').on(table.status, table.updatedAt),
    index('idx_memory_import_jobs_source_updated').on(table.source, table.updatedAt),
    // memory_import_jobs_one_running is a raw-SQL partial unique index in migration 0034.
  ],
);

// LOCAL-ONLY: first production entity canonicalization slice. Intentionally
// separate from synced memory_facts/memory_edges until mesh-safe wiring lands.
export const memoryEntities = pgTable(
  'memory_entities',
  {
    id: text('id').primaryKey(),
    entityType: text('entity_type').notNull(),
    canonicalName: text('canonical_name').notNull(),
    normalizedCanonicalName: text('normalized_canonical_name').notNull(),
    metadataJson: jsonb('metadata_json').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_memory_entities_type_normalized_name').on(
      table.entityType,
      table.normalizedCanonicalName,
    ),
    index('idx_memory_entities_created_at').on(table.createdAt),
  ],
);

// LOCAL-ONLY: aliases resolve into memory_entities; no historical fact/edge
// rewrites or synced-row canonical ids in this initial slice.
export const memoryEntityAliases = pgTable(
  'memory_entity_aliases',
  {
    id: text('id').primaryKey(),
    canonicalId: text('canonical_id')
      .notNull()
      .references(() => memoryEntities.id, { onDelete: 'cascade' }),
    alias: text('alias').notNull(),
    normalizedAlias: text('normalized_alias').notNull(),
    sourceJson: jsonb('source_json').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('memory_entity_aliases_canonical_unique').on(
      table.canonicalId,
      table.normalizedAlias,
    ),
    index('idx_memory_entity_aliases_normalized_alias').on(
      table.normalizedAlias,
      table.canonicalId,
    ),
  ],
);

export const memoryFacts = pgTable(
  'memory_facts',
  {
    id: text('id').primaryKey(),
    scope: text('scope').notNull(),
    content: text('content').notNull(),
    contentModel: text('content_model').notNull().default('text-embedding-3-small'),
    embeddingVersion: integer('embedding_version').notNull().default(1),
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

export const memoryFactSources = pgTable(
  'memory_fact_sources',
  {
    id: text('id').primaryKey(),
    factId: text('fact_id')
      .notNull()
      .references(() => memoryFacts.id, { onDelete: 'cascade' }),
    drawerId: text('drawer_id')
      .notNull()
      .references(() => memoryDrawers.id, { onDelete: 'cascade' }),
    startOffset: integer('start_offset').notNull(),
    endOffset: integer('end_offset').notNull(),
    sourceJson: jsonb('source_json').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('memory_fact_sources_unique_span').on(
      table.factId,
      table.drawerId,
      table.startOffset,
      table.endOffset,
    ),
    index('idx_memory_fact_sources_fact').on(table.factId),
    index('idx_memory_fact_sources_drawer').on(table.drawerId),
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
    embeddingVersion: integer('embedding_version').notNull().default(1),
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
    /** Globally unique ID for mesh sync (bigserial PK is not globally unique). */
    syncId: uuid('sync_id').defaultRandom(),
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
    // NEW: credential_kind distinguishes runtime LLM accounts from embedding accounts.
    // DEFAULT 'runtime' ensures existing rows automatically satisfy the filter.
    credentialKind: text('credential_kind').notNull().default('runtime'),
    credentialLast4: text('credential_last4'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_api_accounts_provider').on(table.provider),
    index('idx_api_accounts_is_active').on(table.isActive),
    index('idx_api_accounts_kind').on(table.credentialKind),
    // Note: api_accounts_one_active_embedding partial unique index is raw-SQL only (migration 0033)
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

// ---------------------------------------------------------------------------
// Mesh Sync — Change log, conflict tracking, and node registry
// ---------------------------------------------------------------------------

export const syncNodes = pgTable('sync_nodes', {
  id: text('id').primaryKey(),
  hostname: text('hostname').notNull(),
  tailscaleIp: text('tailscale_ip'),
  role: text('role').notNull().default('full'),
  lastSeen: timestamp('last_seen', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // P4 extensions:
  syncUrl: text('sync_url'),
  syncStatus: text('sync_status').default('unknown'),
  syncIntervalMs: integer('sync_interval_ms').default(30000),
  isSelf: boolean('is_self').default(false),
  publicKey: text('public_key'),
  lastPingError: text('last_ping_error'),
  lastPingStatusCode: integer('last_ping_status_code'),
  // 33.9 (partial): version observability captured on each ping. All nullable —
  // older peers that have not yet shipped the /health fields will continue to
  // ping successfully and simply leave these columns NULL.
  peerVersion: text('peer_version'),
  peerGitSha: text('peer_git_sha'),
  peerSchemaVersion: integer('peer_schema_version'),
  // 33.10: envelope schema-ahead rejection tracking. When the apply-side
  // MESH_ENVELOPE_SCHEMA_AHEAD gate fires, we stamp the rejected envelope's
  // schemaVersion + timestamp here and bump the count so /mesh-peers can surface
  // a red "Peer ahead" badge on the offending peer row.
  lastSchemaAheadVersion: integer('last_schema_ahead_version'),
  lastSchemaAheadAt: timestamp('last_schema_ahead_at', { withTimezone: true }),
  schemaAheadCount: integer('schema_ahead_count').notNull().default(0),
  // 33.8: reverse registration outcome tracking (migration 0026). These columns
  // existed only in SQL until now — adding them to Drizzle so route code can
  // stop using the raw SYNC_NODE_COLUMNS string for queries.
  reverseRegistrationStatus: text('reverse_registration_status'),
  reverseRegistrationError: text('reverse_registration_error'),
  reverseRegistrationAt: timestamp('reverse_registration_at', { withTimezone: true }),
  // §33.12 Phase 3.1: structured error codes for reverse registration.
  // Machine-readable error code (e.g. 'TOKEN_MISMATCH', 'SIGNATURE_INVALID')
  // and HTTP status allow the frontend to map failures to actionable guidance.
  reverseRegistrationErrorCode: text('reverse_registration_error_code'),
  reverseRegistrationHttpStatus: integer('reverse_registration_http_status'),
});

// §33.12 Phase 2: Local-only mesh identity config. NOT synced — each machine
// manages its own identity independently. No sync trigger must ever be added.
export const meshLocalConfig = pgTable('mesh_local_config', {
  key: text('key').primaryKey(),
  value: text('value'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const syncChangeLog = pgTable(
  'sync_change_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    nodeId: text('node_id').notNull(),
    tableName: text('table_name').notNull(),
    rowId: text('row_id').notNull(),
    operation: text('operation').notNull(),
    payload: jsonb('payload'),
    vclock: jsonb('vclock').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    synced: boolean('synced').notNull().default(false),
  },
  // NOTE: The migration creates partial indexes (WHERE synced = false, WHERE status = 'pending')
  // which Drizzle's schema API does not natively support. The indexes below are plain (non-partial)
  // in the Drizzle schema for type-safety only — the actual partial indexes come from the SQL migration.
  // This intentional divergence is acceptable; drizzle-kit push/pull is not used for migrations.
  (table) => [index('idx_change_log_table_row').on(table.tableName, table.rowId)],
);

export const syncConflicts = pgTable(
  'sync_conflicts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tableName: text('table_name').notNull(),
    rowId: text('row_id').notNull(),
    localVclock: jsonb('local_vclock').notNull(),
    localPayload: jsonb('local_payload'),
    remoteVclock: jsonb('remote_vclock').notNull(),
    remotePayload: jsonb('remote_payload'),
    remoteNodeId: text('remote_node_id').notNull(),
    status: text('status').notNull().default('pending'),
    resolution: text('resolution'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // NOTE: The migration creates idx_conflicts_pending as a partial index (WHERE status = 'pending').
  // Drizzle schema API does not support partial index predicates, so no index is declared here.
  // The actual index comes from the SQL migration only.
);

export const syncPeerCursors = pgTable(
  'sync_peer_cursors',
  {
    localNodeId: text('local_node_id').notNull(),
    remoteNodeId: text('remote_node_id').notNull(),
    pulledCursor: bigint('pulled_cursor', { mode: 'number' }).default(0),
    ackedCursor: bigint('acked_cursor', { mode: 'number' }).default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.localNodeId, table.remoteNodeId] })],
);

// ---------------------------------------------------------------------------
// Memory Operations — Jobs, Events, Audit
// Migration 0033: memory_ops_jobs (mesh-synced), memory_ops_job_events (local),
// memory_ops_audit (local)
// ---------------------------------------------------------------------------

// CAUTION: idx_memory_ops_jobs_kind_scope_status is a raw-SQL expression index
// defined in migration 0033_add_memory_ops.sql. Never generate a DROP for it.
export const memoryOpsJobs = pgTable(
  'memory_ops_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    status: text('status').notNull(),
    params: jsonb('params').notNull().default(sql`'{}'::jsonb`),
    progress: jsonb('progress')
      .notNull()
      .default(
        sql`'{"processed":0,"embedded":0,"failed":0,"total":0,"costUsd":0,"usageEstimated":false}'::jsonb`,
      ),
    result: jsonb('result'),
    error: text('error'),
    errorCode: text('error_code'),
    credentialId: uuid('credential_id'),
    providerKind: text('provider_kind'),
    providerModel: text('provider_model'),
    providerHost: text('provider_host'),
    priceUsdPerMtoken: numeric('price_usd_per_mtoken', { precision: 12, scale: 8 }),
    originMachineId: text('origin_machine_id').notNull(),
    executorMachineId: text('executor_machine_id').notNull(),
    cancelRequestedAt: timestamp('cancel_requested_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    egressConfirmedAt: timestamp('egress_confirmed_at', { withTimezone: true }),
    egressConfirmedBy: text('egress_confirmed_by'),
    egressSnapshot: jsonb('egress_snapshot'),
  },
  (table) => [
    index('idx_memory_ops_jobs_status_executor').on(table.status, table.executorMachineId),
    index('idx_memory_ops_jobs_kind_created').on(table.kind, table.createdAt),
    // idx_memory_ops_jobs_kind_scope_status — raw-SQL expression index in migration 0033; omitted here intentionally.
  ],
);

// LOCAL-ONLY: NOT in TABLE_SYNC_CONFIG.
export const memoryOpsJobEvents = pgTable(
  'memory_ops_job_events',
  {
    eventId: bigserial('event_id', { mode: 'bigint' }).primaryKey(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => memoryOpsJobs.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    level: text('level'),
    message: text('message'),
    progress: jsonb('progress'),
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_memory_ops_job_events_job').on(table.jobId, table.eventId)],
);

// LOCAL-ONLY: NOT in TABLE_SYNC_CONFIG.
export const memoryOpsAudit = pgTable(
  'memory_ops_audit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    target: text('target').notNull(),
    context: jsonb('context').notNull().default(sql`'{}'::jsonb`),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_memory_ops_audit_action_ts').on(table.action, table.timestamp),
    index('idx_memory_ops_audit_target').on(table.target),
  ],
);
