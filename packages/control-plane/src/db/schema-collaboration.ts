import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
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
    subscriptionFilter: jsonb('subscription_filter').default({}),
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

// ── Agent Identity ──────────────────────────────────────────

export const agentProfiles = pgTable('agent_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  runtimeType: text('runtime_type').notNull(),
  modelId: text('model_id').notNull(),
  providerId: text('provider_id').notNull(),
  capabilities: text('capabilities').array().default([]),
  toolScopes: text('tool_scopes').array().default([]),
  maxTokensPerTask: integer('max_tokens_per_task'),
  maxCostPerHour: real('max_cost_per_hour'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const agentInstances = pgTable(
  'agent_instances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => agentProfiles.id, { onDelete: 'cascade' }),
    machineId: text('machine_id'),
    worktreeId: text('worktree_id'),
    runtimeSessionId: text('runtime_session_id'),
    status: text('status').default('idle'),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }).defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_agent_instances_profile').on(table.profileId),
    index('idx_agent_instances_status').on(table.status),
  ],
);

// ── Approval Gates ──────────────────────────────────────────

export const approvalGates = pgTable(
  'approval_gates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskDefinitionId: text('task_definition_id').notNull(),
    taskRunId: text('task_run_id'),
    threadId: uuid('thread_id').references(() => threads.id),
    requiredApprovers: text('required_approvers').array().notNull().default([]),
    requiredCount: integer('required_count').notNull().default(1),
    timeoutMs: integer('timeout_ms').default(3_600_000),
    timeoutPolicy: text('timeout_policy').default('pause'),
    contextArtifactIds: text('context_artifact_ids').array().default([]),
    status: text('status').default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_approval_gates_thread').on(table.threadId),
    index('idx_approval_gates_status').on(table.status),
  ],
);

export const approvalDecisions = pgTable(
  'approval_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gateId: uuid('gate_id')
      .notNull()
      .references(() => approvalGates.id, { onDelete: 'cascade' }),
    decidedBy: text('decided_by').notNull(),
    action: text('action').notNull(),
    comment: text('comment'),
    viaTimeout: boolean('via_timeout').default(false),
    decidedAt: timestamp('decided_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [index('idx_approval_decisions_gate').on(table.gateId)],
);
