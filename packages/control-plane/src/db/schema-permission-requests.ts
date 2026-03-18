import type { PermissionRequestStatus } from '@agentctl/shared';
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

type PermissionDecision = 'approved' | 'denied';

export const permissionRequests = pgTable(
  'permission_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id').notNull(),
    sessionId: text('session_id').notNull(),
    machineId: text('machine_id').notNull(),
    requestId: text('request_id').notNull(),
    toolName: text('tool_name').notNull(),
    toolInput: jsonb('tool_input').$type<Record<string, unknown> | null>(),
    description: text('description'),
    status: text('status').$type<PermissionRequestStatus>().notNull().default('pending'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    timeoutAt: timestamp('timeout_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: text('resolved_by'),
    decision: text('decision').$type<PermissionDecision | null>(),
  },
  (table) => [
    check(
      'permission_requests_valid_status',
      sql`${table.status} IN ('pending', 'approved', 'denied', 'expired', 'cancelled')`,
    ),
    check(
      'permission_requests_valid_decision',
      sql`${table.decision} IS NULL OR ${table.decision} IN ('approved', 'denied')`,
    ),
    index('idx_perm_req_status').on(table.status),
    index('idx_perm_req_agent').on(table.agentId),
    index('idx_perm_req_session').on(table.sessionId),
  ],
);
