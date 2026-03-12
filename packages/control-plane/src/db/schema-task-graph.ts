import {
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

import { spaces, threads } from './schema-collaboration.js';

// ── Worker Nodes ─────────────────────────────────────────────

export const workerNodes = pgTable(
  'worker_nodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    hostname: text('hostname').notNull(),
    tailscaleIp: text('tailscale_ip').notNull(),
    maxConcurrentAgents: integer('max_concurrent_agents').default(3),
    currentLoad: real('current_load').default(0.0),
    capabilities: text('capabilities').array().default([]),
    status: text('status').default('online'),
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }).defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_worker_nodes_status').on(table.status),
    index('idx_worker_nodes_hostname').on(table.hostname),
  ],
);

// ── Agent Profiles ───────────────────────────────────────────

export const agentProfiles = pgTable('agent_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  capabilities: text('capabilities').array().default([]),
  preferredModel: text('preferred_model'),
  maxConcurrentTasks: integer('max_concurrent_tasks').default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ── Agent Instances ──────────────────────────────────────────

export const agentInstances = pgTable(
  'agent_instances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => agentProfiles.id, { onDelete: 'cascade' }),
    workerId: uuid('worker_id')
      .notNull()
      .references(() => workerNodes.id, { onDelete: 'cascade' }),
    status: text('status').default('idle'),
    currentTaskRunId: uuid('current_task_run_id'),
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }).defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_agent_instances_profile_id').on(table.profileId),
    index('idx_agent_instances_worker_id').on(table.workerId),
    index('idx_agent_instances_status').on(table.status),
  ],
);

// ── Task Graphs ──────────────────────────────────────────────

export const taskGraphs = pgTable('task_graphs', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ── Task Definitions ─────────────────────────────────────────

export const taskDefinitions = pgTable(
  'task_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    graphId: uuid('graph_id')
      .notNull()
      .references(() => taskGraphs.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    name: text('name').notNull(),
    description: text('description').default(''),
    requiredCapabilities: text('required_capabilities').array().default([]),
    estimatedTokens: integer('estimated_tokens'),
    timeoutMs: integer('timeout_ms').default(3600000),
    maxRetryAttempts: integer('max_retry_attempts').default(1),
    retryBackoffMs: integer('retry_backoff_ms').default(5000),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [index('idx_task_definitions_graph_id').on(table.graphId)],
);

// ── Task Edges ───────────────────────────────────────────────

export const taskEdges = pgTable(
  'task_edges',
  {
    fromDefinition: uuid('from_definition')
      .notNull()
      .references(() => taskDefinitions.id, { onDelete: 'cascade' }),
    toDefinition: uuid('to_definition')
      .notNull()
      .references(() => taskDefinitions.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.fromDefinition, table.toDefinition] }),
    index('idx_task_edges_to_definition').on(table.toDefinition),
  ],
);

// ── Task Runs ────────────────────────────────────────────────

export const taskRuns = pgTable(
  'task_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    definitionId: uuid('definition_id')
      .notNull()
      .references(() => taskDefinitions.id),
    spaceId: uuid('space_id').references(() => spaces.id),
    threadId: uuid('thread_id').references(() => threads.id),
    status: text('status').default('pending'),
    attempt: integer('attempt').default(1),
    assigneeInstanceId: uuid('assignee_instance_id').references(() => agentInstances.id),
    machineId: uuid('machine_id').references(() => workerNodes.id),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
    result: jsonb('result'),
    error: jsonb('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('idx_task_runs_definition_id').on(table.definitionId),
    index('idx_task_runs_status').on(table.status),
    index('idx_task_runs_machine_id').on(table.machineId),
  ],
);

// ── Worker Leases ────────────────────────────────────────────

export const workerLeases = pgTable('worker_leases', {
  taskRunId: uuid('task_run_id')
    .primaryKey()
    .references(() => taskRuns.id),
  workerId: uuid('worker_id')
    .notNull()
    .references(() => workerNodes.id),
  agentInstanceId: uuid('agent_instance_id')
    .notNull()
    .references(() => agentInstances.id),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  renewedAt: timestamp('renewed_at', { withTimezone: true }).defaultNow(),
});
