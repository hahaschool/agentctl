import type { AgentStatus, AgentType, RunStatus, RunTrigger } from '@agentctl/shared';
import { AGENT_STATUSES } from '@agentctl/shared';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  agentActions,
  agentRuns,
  agents,
  machineRuntimeState,
  machines,
  managedSessions,
  memoryEdges,
  memoryFacts,
  memoryScopes,
  nativeImportAttempts,
  runHandoffDecisions,
  runtimeConfigRevisions,
  sessionHandoffs,
} from './schema.js';

// ---------------------------------------------------------------------------
// Helper: extract column metadata in a concise format for assertions
// ---------------------------------------------------------------------------

type ColumnMeta = {
  name: string;
  columnType: string;
  dataType: string;
  notNull: boolean;
  hasDefault: boolean;
  primary: boolean;
};

function getColumnMeta(table: Parameters<typeof getTableColumns>[0]): Record<string, ColumnMeta> {
  const cols = getTableColumns(table);
  const result: Record<string, ColumnMeta> = {};
  for (const [key, col] of Object.entries(cols)) {
    result[key] = {
      name: col.name,
      columnType: col.columnType,
      dataType: col.dataType,
      notNull: col.notNull,
      hasDefault: col.hasDefault,
      primary: col.primary,
    };
  }
  return result;
}

// ============================================================================
// 1. Verify all expected tables are exported
// ============================================================================

describe('Schema module exports', () => {
  it('exports the machines table', () => {
    expect(machines).toBeDefined();
    expect(getTableName(machines)).toBe('machines');
  });

  it('exports the agents table', () => {
    expect(agents).toBeDefined();
    expect(getTableName(agents)).toBe('agents');
  });

  it('exports the agentRuns table', () => {
    expect(agentRuns).toBeDefined();
    expect(getTableName(agentRuns)).toBe('agent_runs');
  });

  it('exports the agentActions table', () => {
    expect(agentActions).toBeDefined();
    expect(getTableName(agentActions)).toBe('agent_actions');
  });

  it('exports the managedSessions table', () => {
    expect(managedSessions).toBeDefined();
    expect(getTableName(managedSessions)).toBe('managed_sessions');
  });

  it('exports the runtimeConfigRevisions table', () => {
    expect(runtimeConfigRevisions).toBeDefined();
    expect(getTableName(runtimeConfigRevisions)).toBe('runtime_config_revisions');
  });

  it('exports the machineRuntimeState table', () => {
    expect(machineRuntimeState).toBeDefined();
    expect(getTableName(machineRuntimeState)).toBe('machine_runtime_state');
  });

  it('exports the sessionHandoffs table', () => {
    expect(sessionHandoffs).toBeDefined();
    expect(getTableName(sessionHandoffs)).toBe('session_handoffs');
  });

  it('exports the nativeImportAttempts table', () => {
    expect(nativeImportAttempts).toBeDefined();
    expect(getTableName(nativeImportAttempts)).toBe('native_import_attempts');
  });

  it('exports the runHandoffDecisions table', () => {
    expect(runHandoffDecisions).toBeDefined();
    expect(getTableName(runHandoffDecisions)).toBe('run_handoff_decisions');
  });

  it('exports the memory layer tables', () => {
    expect(memoryScopes).toBeDefined();
    expect(memoryFacts).toBeDefined();
    expect(memoryEdges).toBeDefined();
    expect(getTableName(memoryScopes)).toBe('memory_scopes');
    expect(getTableName(memoryFacts)).toBe('memory_facts');
    expect(getTableName(memoryEdges)).toBe('memory_edges');
  });
});

// ============================================================================
// 2. Verify each table has the correct column names, types, and constraints
// ============================================================================

describe('machines table columns', () => {
  const meta = getColumnMeta(machines);

  it('has exactly 9 columns', () => {
    expect(Object.keys(meta)).toHaveLength(9);
  });

  it('has all expected column keys', () => {
    const expectedKeys = [
      'id',
      'hostname',
      'tailscaleIp',
      'os',
      'arch',
      'status',
      'lastHeartbeat',
      'capabilities',
      'createdAt',
    ];
    expect(Object.keys(meta)).toEqual(expectedKeys);
  });

  it('id is a text primary key without default', () => {
    expect(meta.id).toEqual({
      name: 'id',
      columnType: 'PgText',
      dataType: 'string',
      notNull: true,
      hasDefault: false,
      primary: true,
    });
  });

  it('hostname is a unique, not-null text column', () => {
    expect(meta.hostname.columnType).toBe('PgText');
    expect(meta.hostname.notNull).toBe(true);
    expect(meta.hostname.hasDefault).toBe(false);

    const cols = getTableColumns(machines);
    expect(cols.hostname.isUnique).toBe(true);
  });

  it('tailscale_ip is a not-null inet column', () => {
    expect(meta.tailscaleIp).toEqual({
      name: 'tailscale_ip',
      columnType: 'PgInet',
      dataType: 'string',
      notNull: true,
      hasDefault: false,
      primary: false,
    });
  });

  it('os is a not-null text column', () => {
    expect(meta.os.columnType).toBe('PgText');
    expect(meta.os.notNull).toBe(true);
    expect(meta.os.hasDefault).toBe(false);
  });

  it('arch is a not-null text column', () => {
    expect(meta.arch.columnType).toBe('PgText');
    expect(meta.arch.notNull).toBe(true);
    expect(meta.arch.hasDefault).toBe(false);
  });

  it('status is a nullable text column with default', () => {
    expect(meta.status.columnType).toBe('PgText');
    expect(meta.status.notNull).toBe(false);
    expect(meta.status.hasDefault).toBe(true);
  });

  it('last_heartbeat is a nullable timestamp without default', () => {
    expect(meta.lastHeartbeat).toEqual({
      name: 'last_heartbeat',
      columnType: 'PgTimestamp',
      dataType: 'date',
      notNull: false,
      hasDefault: false,
      primary: false,
    });
  });

  it('capabilities is a nullable jsonb column with default', () => {
    expect(meta.capabilities.columnType).toBe('PgJsonb');
    expect(meta.capabilities.dataType).toBe('json');
    expect(meta.capabilities.notNull).toBe(false);
    expect(meta.capabilities.hasDefault).toBe(true);
  });

  it('created_at is a nullable timestamp with defaultNow()', () => {
    expect(meta.createdAt).toEqual({
      name: 'created_at',
      columnType: 'PgTimestamp',
      dataType: 'date',
      notNull: false,
      hasDefault: true,
      primary: false,
    });
  });

  it('SQL column names match the migration (snake_case)', () => {
    const sqlNames = Object.values(meta).map((m) => m.name);
    expect(sqlNames).toEqual([
      'id',
      'hostname',
      'tailscale_ip',
      'os',
      'arch',
      'status',
      'last_heartbeat',
      'capabilities',
      'created_at',
    ]);
  });
});

describe('agents table columns', () => {
  const meta = getColumnMeta(agents);

  it('has exactly 18 columns', () => {
    expect(Object.keys(meta)).toHaveLength(18);
  });

  it('has all expected column keys', () => {
    const expectedKeys = [
      'id',
      'machineId',
      'name',
      'type',
      'runtime',
      'status',
      'schedule',
      'projectPath',
      'worktreeBranch',
      'currentSessionId',
      'config',
      'scheduleConfig',
      'loopConfig',
      'lastRunAt',
      'lastCostUsd',
      'totalCostUsd',
      'accountId',
      'createdAt',
    ];
    expect(Object.keys(meta)).toEqual(expectedKeys);
  });

  it('id is a UUID primary key with default (gen_random_uuid)', () => {
    expect(meta.id).toEqual({
      name: 'id',
      columnType: 'PgUUID',
      dataType: 'string',
      notNull: true,
      hasDefault: true,
      primary: true,
    });
  });

  it('machine_id is a nullable text column (FK target)', () => {
    expect(meta.machineId).toEqual({
      name: 'machine_id',
      columnType: 'PgText',
      dataType: 'string',
      notNull: false,
      hasDefault: false,
      primary: false,
    });
  });

  it('name is a not-null text column', () => {
    expect(meta.name.columnType).toBe('PgText');
    expect(meta.name.notNull).toBe(true);
    expect(meta.name.hasDefault).toBe(false);
  });

  it('type is a not-null text column', () => {
    expect(meta.type.columnType).toBe('PgText');
    expect(meta.type.notNull).toBe(true);
    expect(meta.type.hasDefault).toBe(false);
  });

  it('runtime is a nullable text column with default', () => {
    expect(meta.runtime.columnType).toBe('PgText');
    expect(meta.runtime.notNull).toBe(false);
    expect(meta.runtime.hasDefault).toBe(true);
  });

  it('status is a nullable text column with default', () => {
    expect(meta.status.notNull).toBe(false);
    expect(meta.status.hasDefault).toBe(true);
  });

  it('schedule, projectPath, worktreeBranch, currentSessionId are nullable text without default', () => {
    for (const key of ['schedule', 'projectPath', 'worktreeBranch', 'currentSessionId'] as const) {
      expect(meta[key].columnType).toBe('PgText');
      expect(meta[key].notNull).toBe(false);
      expect(meta[key].hasDefault).toBe(false);
    }
  });

  it('config is a nullable jsonb column with default', () => {
    expect(meta.config.columnType).toBe('PgJsonb');
    expect(meta.config.dataType).toBe('json');
    expect(meta.config.hasDefault).toBe(true);
  });

  it('last_run_at is a nullable timestamp without default', () => {
    expect(meta.lastRunAt).toEqual({
      name: 'last_run_at',
      columnType: 'PgTimestamp',
      dataType: 'date',
      notNull: false,
      hasDefault: false,
      primary: false,
    });
  });

  it('last_cost_usd is a nullable numeric without default', () => {
    expect(meta.lastCostUsd).toEqual({
      name: 'last_cost_usd',
      columnType: 'PgNumeric',
      dataType: 'string',
      notNull: false,
      hasDefault: false,
      primary: false,
    });
  });

  it('total_cost_usd is a nullable numeric with default', () => {
    expect(meta.totalCostUsd).toEqual({
      name: 'total_cost_usd',
      columnType: 'PgNumeric',
      dataType: 'string',
      notNull: false,
      hasDefault: true,
      primary: false,
    });
  });

  it('created_at is a nullable timestamp with defaultNow()', () => {
    expect(meta.createdAt).toEqual({
      name: 'created_at',
      columnType: 'PgTimestamp',
      dataType: 'date',
      notNull: false,
      hasDefault: true,
      primary: false,
    });
  });

  it('SQL column names match the migration (snake_case)', () => {
    const sqlNames = Object.values(meta).map((m) => m.name);
    expect(sqlNames).toEqual([
      'id',
      'machine_id',
      'name',
      'type',
      'runtime',
      'status',
      'schedule',
      'project_path',
      'worktree_branch',
      'current_session_id',
      'config',
      'schedule_config',
      'loop_config',
      'last_run_at',
      'last_cost_usd',
      'total_cost_usd',
      'account_id',
      'created_at',
    ]);
  });
});

describe('agentRuns table columns', () => {
  const meta = getColumnMeta(agentRuns);

  it('has exactly 16 columns', () => {
    expect(Object.keys(meta)).toHaveLength(16);
  });

  it('has all expected column keys', () => {
    const expectedKeys = [
      'id',
      'agentId',
      'trigger',
      'status',
      'startedAt',
      'finishedAt',
      'costUsd',
      'tokensIn',
      'tokensOut',
      'model',
      'provider',
      'sessionId',
      'errorMessage',
      'resultSummary',
      'loopIteration',
      'parentRunId',
    ];
    expect(Object.keys(meta)).toEqual(expectedKeys);
  });

  it('id is a UUID primary key with default (gen_random_uuid)', () => {
    expect(meta.id).toEqual({
      name: 'id',
      columnType: 'PgUUID',
      dataType: 'string',
      notNull: true,
      hasDefault: true,
      primary: true,
    });
  });

  it('agent_id is a nullable UUID column (FK target)', () => {
    expect(meta.agentId).toEqual({
      name: 'agent_id',
      columnType: 'PgUUID',
      dataType: 'string',
      notNull: false,
      hasDefault: false,
      primary: false,
    });
  });

  it('trigger is a not-null text column', () => {
    expect(meta.trigger.columnType).toBe('PgText');
    expect(meta.trigger.notNull).toBe(true);
    expect(meta.trigger.hasDefault).toBe(false);
  });

  it('status is a not-null text column', () => {
    expect(meta.status.columnType).toBe('PgText');
    expect(meta.status.notNull).toBe(true);
    expect(meta.status.hasDefault).toBe(false);
  });

  it('started_at is a not-null timestamp', () => {
    expect(meta.startedAt).toEqual({
      name: 'started_at',
      columnType: 'PgTimestamp',
      dataType: 'date',
      notNull: true,
      hasDefault: false,
      primary: false,
    });
  });

  it('finished_at is a nullable timestamp', () => {
    expect(meta.finishedAt).toEqual({
      name: 'finished_at',
      columnType: 'PgTimestamp',
      dataType: 'date',
      notNull: false,
      hasDefault: false,
      primary: false,
    });
  });

  it('cost_usd is a nullable numeric', () => {
    expect(meta.costUsd.columnType).toBe('PgNumeric');
    expect(meta.costUsd.notNull).toBe(false);
    expect(meta.costUsd.hasDefault).toBe(false);
  });

  it('tokens_in and tokens_out are nullable bigint (number mode)', () => {
    expect(meta.tokensIn).toEqual({
      name: 'tokens_in',
      columnType: 'PgBigInt53',
      dataType: 'number',
      notNull: false,
      hasDefault: false,
      primary: false,
    });
    expect(meta.tokensOut).toEqual({
      name: 'tokens_out',
      columnType: 'PgBigInt53',
      dataType: 'number',
      notNull: false,
      hasDefault: false,
      primary: false,
    });
  });

  it('model, provider, sessionId, errorMessage, resultSummary are nullable text', () => {
    for (const key of [
      'model',
      'provider',
      'sessionId',
      'errorMessage',
      'resultSummary',
    ] as const) {
      expect(meta[key].columnType).toBe('PgText');
      expect(meta[key].notNull).toBe(false);
      expect(meta[key].hasDefault).toBe(false);
    }
  });

  it('SQL column names match the migration (snake_case)', () => {
    const sqlNames = Object.values(meta).map((m) => m.name);
    expect(sqlNames).toEqual([
      'id',
      'agent_id',
      'trigger',
      'status',
      'started_at',
      'finished_at',
      'cost_usd',
      'tokens_in',
      'tokens_out',
      'model',
      'provider',
      'session_id',
      'error_message',
      'result_summary',
      'loop_iteration',
      'parent_run_id',
    ]);
  });
});

describe('agentActions table columns', () => {
  const meta = getColumnMeta(agentActions);

  it('has exactly 9 columns', () => {
    expect(Object.keys(meta)).toHaveLength(9);
  });

  it('has all expected column keys', () => {
    const expectedKeys = [
      'id',
      'runId',
      'timestamp',
      'actionType',
      'toolName',
      'toolInput',
      'toolOutputHash',
      'durationMs',
      'approvedBy',
    ];
    expect(Object.keys(meta)).toEqual(expectedKeys);
  });

  it('id is a bigserial primary key with default (autoincrement)', () => {
    expect(meta.id).toEqual({
      name: 'id',
      columnType: 'PgBigSerial53',
      dataType: 'number',
      notNull: true,
      hasDefault: true,
      primary: true,
    });
  });

  it('run_id is a nullable UUID column (FK target)', () => {
    expect(meta.runId).toEqual({
      name: 'run_id',
      columnType: 'PgUUID',
      dataType: 'string',
      notNull: false,
      hasDefault: false,
      primary: false,
    });
  });

  it('timestamp is a nullable timestamp with defaultNow()', () => {
    expect(meta.timestamp).toEqual({
      name: 'timestamp',
      columnType: 'PgTimestamp',
      dataType: 'date',
      notNull: false,
      hasDefault: true,
      primary: false,
    });
  });

  it('action_type is a not-null text column', () => {
    expect(meta.actionType.columnType).toBe('PgText');
    expect(meta.actionType.notNull).toBe(true);
    expect(meta.actionType.hasDefault).toBe(false);
  });

  it('tool_name is a nullable text column', () => {
    expect(meta.toolName.columnType).toBe('PgText');
    expect(meta.toolName.notNull).toBe(false);
  });

  it('tool_input is a nullable jsonb column', () => {
    expect(meta.toolInput.columnType).toBe('PgJsonb');
    expect(meta.toolInput.dataType).toBe('json');
    expect(meta.toolInput.notNull).toBe(false);
    expect(meta.toolInput.hasDefault).toBe(false);
  });

  it('tool_output_hash is a nullable text column', () => {
    expect(meta.toolOutputHash.columnType).toBe('PgText');
    expect(meta.toolOutputHash.notNull).toBe(false);
  });

  it('duration_ms is a nullable integer column', () => {
    expect(meta.durationMs).toEqual({
      name: 'duration_ms',
      columnType: 'PgInteger',
      dataType: 'number',
      notNull: false,
      hasDefault: false,
      primary: false,
    });
  });

  it('approved_by is a nullable text column', () => {
    expect(meta.approvedBy.columnType).toBe('PgText');
    expect(meta.approvedBy.notNull).toBe(false);
    expect(meta.approvedBy.hasDefault).toBe(false);
  });

  it('SQL column names match the migration (snake_case)', () => {
    const sqlNames = Object.values(meta).map((m) => m.name);
    expect(sqlNames).toEqual([
      'id',
      'run_id',
      'timestamp',
      'action_type',
      'tool_name',
      'tool_input',
      'tool_output_hash',
      'duration_ms',
      'approved_by',
    ]);
  });
});

// ============================================================================
// 3. Verify required vs nullable columns match the SQL migration
// ============================================================================

describe('Required (NOT NULL) vs nullable columns', () => {
  it('machines: id, hostname, tailscale_ip, os, arch are NOT NULL', () => {
    const meta = getColumnMeta(machines);
    const notNullKeys = Object.entries(meta)
      .filter(([, m]) => m.notNull)
      .map(([key]) => key);

    expect(notNullKeys).toEqual(['id', 'hostname', 'tailscaleIp', 'os', 'arch']);
  });

  it('machines: status, last_heartbeat, capabilities, created_at are nullable', () => {
    const meta = getColumnMeta(machines);
    const nullableKeys = Object.entries(meta)
      .filter(([, m]) => !m.notNull)
      .map(([key]) => key);

    expect(nullableKeys).toEqual(['status', 'lastHeartbeat', 'capabilities', 'createdAt']);
  });

  it('agents: id, name, type are NOT NULL', () => {
    const meta = getColumnMeta(agents);
    const notNullKeys = Object.entries(meta)
      .filter(([, m]) => m.notNull)
      .map(([key]) => key);

    expect(notNullKeys).toEqual(['id', 'name', 'type']);
  });

  it('agents: machine_id, status, schedule, and other optional fields are nullable', () => {
    const meta = getColumnMeta(agents);
    const nullableKeys = Object.entries(meta)
      .filter(([, m]) => !m.notNull)
      .map(([key]) => key);

    expect(nullableKeys).toEqual([
      'machineId',
      'runtime',
      'status',
      'schedule',
      'projectPath',
      'worktreeBranch',
      'currentSessionId',
      'config',
      'scheduleConfig',
      'loopConfig',
      'lastRunAt',
      'lastCostUsd',
      'totalCostUsd',
      'accountId',
      'createdAt',
    ]);
  });

  it('agentRuns: id, trigger, status, started_at are NOT NULL', () => {
    const meta = getColumnMeta(agentRuns);
    const notNullKeys = Object.entries(meta)
      .filter(([, m]) => m.notNull)
      .map(([key]) => key);

    expect(notNullKeys).toEqual(['id', 'trigger', 'status', 'startedAt']);
  });

  it('agentRuns: agent_id, finished_at, cost, tokens, etc. are nullable', () => {
    const meta = getColumnMeta(agentRuns);
    const nullableKeys = Object.entries(meta)
      .filter(([, m]) => !m.notNull)
      .map(([key]) => key);

    expect(nullableKeys).toEqual([
      'agentId',
      'finishedAt',
      'costUsd',
      'tokensIn',
      'tokensOut',
      'model',
      'provider',
      'sessionId',
      'errorMessage',
      'resultSummary',
      'loopIteration',
      'parentRunId',
    ]);
  });

  it('agentActions: id, action_type are NOT NULL', () => {
    const meta = getColumnMeta(agentActions);
    const notNullKeys = Object.entries(meta)
      .filter(([, m]) => m.notNull)
      .map(([key]) => key);

    expect(notNullKeys).toEqual(['id', 'actionType']);
  });

  it('agentActions: run_id, timestamp, tool_name, etc. are nullable', () => {
    const meta = getColumnMeta(agentActions);
    const nullableKeys = Object.entries(meta)
      .filter(([, m]) => !m.notNull)
      .map(([key]) => key);

    expect(nullableKeys).toEqual([
      'runId',
      'timestamp',
      'toolName',
      'toolInput',
      'toolOutputHash',
      'durationMs',
      'approvedBy',
    ]);
  });
});

// ============================================================================
// 4. Verify enum-like text columns accept shared package types
// ============================================================================

describe('Enum compatibility with shared package types', () => {
  it('AgentStatus values are compatible with agents.status text column', () => {
    // The agents.status column is text (not a pg enum), so any string is valid at DB level.
    // Verify the shared package statuses are all non-empty strings.
    const statuses: AgentStatus[] = [...AGENT_STATUSES];
    expect(statuses).toHaveLength(8);
    for (const s of statuses) {
      expect(typeof s).toBe('string');
      expect(s.length).toBeGreaterThan(0);
    }

    // The schema default matches one of the shared AgentStatus values
    const cols = getTableColumns(agents);
    expect(cols.status.default).toBe('registered');
    expect(AGENT_STATUSES).toContain('registered');
  });

  it('AgentType values are valid strings for agents.type text column', () => {
    const types: AgentType[] = ['heartbeat', 'cron', 'manual', 'adhoc', 'loop'];
    expect(types).toHaveLength(5);

    const meta = getColumnMeta(agents);
    expect(meta.type.columnType).toBe('PgText');
    expect(meta.type.dataType).toBe('string');
  });

  it('RunTrigger values are valid strings for agentRuns.trigger text column', () => {
    const triggers: RunTrigger[] = ['schedule', 'manual', 'signal', 'adhoc', 'heartbeat'];
    expect(triggers).toHaveLength(5);

    const meta = getColumnMeta(agentRuns);
    expect(meta.trigger.columnType).toBe('PgText');
    expect(meta.trigger.dataType).toBe('string');
  });

  it('RunStatus values are valid strings for agentRuns.status text column', () => {
    const statuses: RunStatus[] = ['running', 'success', 'failure', 'timeout', 'cancelled'];
    expect(statuses).toHaveLength(5);

    const meta = getColumnMeta(agentRuns);
    expect(meta.status.columnType).toBe('PgText');
    expect(meta.status.dataType).toBe('string');
  });

  it('machines.status default matches a valid MachineStatus', () => {
    const cols = getTableColumns(machines);
    expect(cols.status.default).toBe('online');
  });
});

// ============================================================================
// 5. Verify foreign key relationships
// ============================================================================

describe('Foreign key relationships', () => {
  it('agents.machine_id references machines.id and agents.account_id references api_accounts.id', () => {
    const config = getTableConfig(agents);
    expect(config.foreignKeys).toHaveLength(2);

    const machineFk = config.foreignKeys.find(
      (fk) => fk.reference().columns[0].name === 'machine_id',
    );
    expect(machineFk).toBeDefined();
    const machineRef = machineFk?.reference();
    expect(getTableName(machineRef.foreignTable)).toBe('machines');
    expect(machineRef.foreignColumns[0].name).toBe('id');

    const accountFk = config.foreignKeys.find(
      (fk) => fk.reference().columns[0].name === 'account_id',
    );
    expect(accountFk).toBeDefined();
    const accountRef = accountFk?.reference();
    expect(getTableName(accountRef.foreignTable)).toBe('api_accounts');
    expect(accountRef.foreignColumns[0].name).toBe('id');
  });

  it('agentRuns.agent_id references agents.id', () => {
    const config = getTableConfig(agentRuns);
    expect(config.foreignKeys).toHaveLength(1);

    const fk = config.foreignKeys[0];
    const ref = fk.reference();
    expect(ref.columns).toHaveLength(1);
    expect(ref.columns[0].name).toBe('agent_id');
    expect(getTableName(ref.foreignTable)).toBe('agents');
    expect(ref.foreignColumns).toHaveLength(1);
    expect(ref.foreignColumns[0].name).toBe('id');
  });

  it('agentActions.run_id references agent_runs.id', () => {
    const config = getTableConfig(agentActions);
    expect(config.foreignKeys).toHaveLength(1);

    const fk = config.foreignKeys[0];
    const ref = fk.reference();
    expect(ref.columns).toHaveLength(1);
    expect(ref.columns[0].name).toBe('run_id');
    expect(getTableName(ref.foreignTable)).toBe('agent_runs');
    expect(ref.foreignColumns).toHaveLength(1);
    expect(ref.foreignColumns[0].name).toBe('id');
  });

  it('machines table has no foreign keys', () => {
    const config = getTableConfig(machines);
    expect(config.foreignKeys).toHaveLength(0);
  });

  it('FK chain: machines <- agents <- agentRuns <- agentActions', () => {
    // Verify the full referential chain from actions back to machines
    const actionsFk = getTableConfig(agentActions).foreignKeys[0].reference();
    expect(getTableName(actionsFk.foreignTable)).toBe('agent_runs');

    const runsFk = getTableConfig(agentRuns).foreignKeys[0].reference();
    expect(getTableName(runsFk.foreignTable)).toBe('agents');

    const agentsFk = getTableConfig(agents).foreignKeys[0].reference();
    expect(getTableName(agentsFk.foreignTable)).toBe('machines');
  });
});

// ============================================================================
// 6. Verify default values
// ============================================================================

describe('Default values', () => {
  it('machines.status defaults to "online"', () => {
    const cols = getTableColumns(machines);
    expect(cols.status.default).toBe('online');
  });

  it('machines.capabilities defaults to empty object', () => {
    const cols = getTableColumns(machines);
    expect(cols.capabilities.default).toEqual({});
  });

  it('machines.created_at has a default (defaultNow)', () => {
    const cols = getTableColumns(machines);
    expect(cols.createdAt.hasDefault).toBe(true);
  });

  it('agents.id has a default (defaultRandom UUID via SQL)', () => {
    const cols = getTableColumns(agents);
    expect(cols.id.hasDefault).toBe(true);
    // defaultRandom() in Drizzle uses SQL-level gen_random_uuid(), not a runtime defaultFn
  });

  it('agents.status defaults to "registered"', () => {
    const cols = getTableColumns(agents);
    expect(cols.status.default).toBe('registered');
  });

  it('agents.config defaults to empty object', () => {
    const cols = getTableColumns(agents);
    expect(cols.config.default).toEqual({});
  });

  it('agents.total_cost_usd defaults to "0"', () => {
    const cols = getTableColumns(agents);
    expect(cols.totalCostUsd.default).toBe('0');
  });

  it('agents.created_at has a default (defaultNow)', () => {
    const cols = getTableColumns(agents);
    expect(cols.createdAt.hasDefault).toBe(true);
  });

  it('agentRuns.id has a default (defaultRandom UUID via SQL)', () => {
    const cols = getTableColumns(agentRuns);
    expect(cols.id.hasDefault).toBe(true);
    // defaultRandom() in Drizzle uses SQL-level gen_random_uuid(), not a runtime defaultFn
  });

  it('agentActions.id has a default (bigserial autoincrement)', () => {
    const cols = getTableColumns(agentActions);
    expect(cols.id.hasDefault).toBe(true);
  });

  it('agentActions.timestamp has a default (defaultNow)', () => {
    const cols = getTableColumns(agentActions);
    expect(cols.timestamp.hasDefault).toBe(true);
  });

  it('columns without defaults are correctly identified', () => {
    // Spot-check several columns that should NOT have defaults
    const agentCols = getTableColumns(agents);
    expect(agentCols.name.hasDefault).toBe(false);
    expect(agentCols.type.hasDefault).toBe(false);
    expect(agentCols.machineId.hasDefault).toBe(false);
    expect(agentCols.schedule.hasDefault).toBe(false);
    expect(agentCols.lastRunAt.hasDefault).toBe(false);
    expect(agentCols.lastCostUsd.hasDefault).toBe(false);

    const runCols = getTableColumns(agentRuns);
    expect(runCols.trigger.hasDefault).toBe(false);
    expect(runCols.status.hasDefault).toBe(false);
    expect(runCols.startedAt.hasDefault).toBe(false);
    expect(runCols.finishedAt.hasDefault).toBe(false);
    expect(runCols.costUsd.hasDefault).toBe(false);
    expect(runCols.loopIteration.hasDefault).toBe(false);
    expect(runCols.parentRunId.hasDefault).toBe(false);

    const actionCols = getTableColumns(agentActions);
    expect(actionCols.actionType.hasDefault).toBe(false);
    expect(actionCols.toolName.hasDefault).toBe(false);
    expect(actionCols.toolInput.hasDefault).toBe(false);
    expect(actionCols.durationMs.hasDefault).toBe(false);
  });
});

// ============================================================================
// 7. Verify primary keys across all tables
// ============================================================================

describe('Primary keys', () => {
  it('each table has exactly one primary key column', () => {
    const tables = [machines, agents, agentRuns, agentActions];
    for (const table of tables) {
      const cols = getTableColumns(table);
      const pkCols = Object.values(cols).filter((c) => c.primary);
      expect(pkCols).toHaveLength(1);
    }
  });

  it('machines PK is id (text)', () => {
    const cols = getTableColumns(machines);
    expect(cols.id.primary).toBe(true);
    expect(cols.id.columnType).toBe('PgText');
  });

  it('agents PK is id (uuid)', () => {
    const cols = getTableColumns(agents);
    expect(cols.id.primary).toBe(true);
    expect(cols.id.columnType).toBe('PgUUID');
  });

  it('agentRuns PK is id (uuid)', () => {
    const cols = getTableColumns(agentRuns);
    expect(cols.id.primary).toBe(true);
    expect(cols.id.columnType).toBe('PgUUID');
  });

  it('agentActions PK is id (bigserial)', () => {
    const cols = getTableColumns(agentActions);
    expect(cols.id.primary).toBe(true);
    expect(cols.id.columnType).toBe('PgBigSerial53');
  });
});

describe('runtimeConfigRevisions table columns', () => {
  const meta = getColumnMeta(runtimeConfigRevisions);

  it('has exactly 5 columns', () => {
    expect(Object.keys(meta)).toHaveLength(5);
  });

  it('has all expected column keys', () => {
    expect(Object.keys(meta)).toEqual(['id', 'version', 'hash', 'config', 'createdAt']);
  });

  it('stores revision payloads as a JSONB document', () => {
    expect(meta.config).toEqual({
      name: 'config',
      columnType: 'PgJsonb',
      dataType: 'json',
      notNull: true,
      hasDefault: false,
      primary: false,
    });
  });

  it('version is a required integer and hash is required text', () => {
    expect(meta.version).toEqual({
      name: 'version',
      columnType: 'PgInteger',
      dataType: 'number',
      notNull: true,
      hasDefault: false,
      primary: false,
    });
    expect(meta.hash).toEqual({
      name: 'hash',
      columnType: 'PgText',
      dataType: 'string',
      notNull: true,
      hasDefault: false,
      primary: false,
    });
  });
});

describe('managedSessions table columns', () => {
  const meta = getColumnMeta(managedSessions);

  it('has exactly 15 columns', () => {
    expect(Object.keys(meta)).toHaveLength(15);
  });

  it('has all expected column keys', () => {
    expect(Object.keys(meta)).toEqual([
      'id',
      'runtime',
      'nativeSessionId',
      'machineId',
      'agentId',
      'projectPath',
      'worktreePath',
      'status',
      'configVersion',
      'handoffStrategy',
      'handoffSourceSessionId',
      'metadata',
      'startedAt',
      'lastHeartbeat',
      'endedAt',
    ]);
  });

  it('tracks runtime and session status as required text columns', () => {
    expect(meta.runtime).toEqual({
      name: 'runtime',
      columnType: 'PgText',
      dataType: 'string',
      notNull: true,
      hasDefault: false,
      primary: false,
    });
    expect(meta.status).toEqual({
      name: 'status',
      columnType: 'PgText',
      dataType: 'string',
      notNull: true,
      hasDefault: true,
      primary: false,
    });
  });

  it('stores config version as a required integer and metadata as jsonb with default', () => {
    expect(meta.configVersion).toEqual({
      name: 'config_version',
      columnType: 'PgInteger',
      dataType: 'number',
      notNull: true,
      hasDefault: false,
      primary: false,
    });
    expect(meta.metadata).toEqual({
      name: 'metadata',
      columnType: 'PgJsonb',
      dataType: 'json',
      notNull: false,
      hasDefault: true,
      primary: false,
    });
  });
});

describe('machineRuntimeState table columns', () => {
  const meta = getColumnMeta(machineRuntimeState);

  it('has exactly 12 columns', () => {
    expect(Object.keys(meta)).toHaveLength(12);
  });

  it('has all expected column keys', () => {
    expect(Object.keys(meta)).toEqual([
      'id',
      'machineId',
      'runtime',
      'isInstalled',
      'isAuthenticated',
      'syncStatus',
      'configVersion',
      'configHash',
      'metadata',
      'lastConfigAppliedAt',
      'createdAt',
      'updatedAt',
    ]);
  });

  it('tracks install/auth state with required booleans', () => {
    expect(meta.isInstalled).toEqual({
      name: 'is_installed',
      columnType: 'PgBoolean',
      dataType: 'boolean',
      notNull: true,
      hasDefault: true,
      primary: false,
    });
    expect(meta.isAuthenticated).toEqual({
      name: 'is_authenticated',
      columnType: 'PgBoolean',
      dataType: 'boolean',
      notNull: true,
      hasDefault: true,
      primary: false,
    });
  });
});

describe('sessionHandoffs table columns', () => {
  const meta = getColumnMeta(sessionHandoffs);

  it('has exactly 12 columns', () => {
    expect(Object.keys(meta)).toHaveLength(12);
  });

  it('has all expected column keys', () => {
    expect(Object.keys(meta)).toEqual([
      'id',
      'sourceSessionId',
      'targetSessionId',
      'sourceRuntime',
      'targetRuntime',
      'reason',
      'strategy',
      'status',
      'snapshot',
      'errorMessage',
      'createdAt',
      'completedAt',
    ]);
  });

  it('stores handoff snapshot as required jsonb', () => {
    expect(meta.snapshot).toEqual({
      name: 'snapshot',
      columnType: 'PgJsonb',
      dataType: 'json',
      notNull: true,
      hasDefault: false,
      primary: false,
    });
  });
});

describe('nativeImportAttempts table columns', () => {
  const meta = getColumnMeta(nativeImportAttempts);

  it('has exactly 10 columns', () => {
    expect(Object.keys(meta)).toHaveLength(10);
  });

  it('has all expected column keys', () => {
    expect(Object.keys(meta)).toEqual([
      'id',
      'handoffId',
      'sourceSessionId',
      'targetSessionId',
      'sourceRuntime',
      'targetRuntime',
      'status',
      'metadata',
      'errorMessage',
      'attemptedAt',
    ]);
  });

  it('tracks import status and attempt metadata', () => {
    expect(meta.status).toEqual({
      name: 'status',
      columnType: 'PgText',
      dataType: 'string',
      notNull: true,
      hasDefault: true,
      primary: false,
    });
    expect(meta.metadata).toEqual({
      name: 'metadata',
      columnType: 'PgJsonb',
      dataType: 'json',
      notNull: false,
      hasDefault: true,
      primary: false,
    });
  });
});

describe('runHandoffDecisions table columns', () => {
  const meta = getColumnMeta(runHandoffDecisions);

  it('has exactly 16 columns', () => {
    expect(Object.keys(meta)).toHaveLength(16);
  });

  it('has all expected column keys', () => {
    expect(Object.keys(meta)).toEqual([
      'id',
      'sourceRunId',
      'sourceManagedSessionId',
      'targetRunId',
      'handoffId',
      'trigger',
      'stage',
      'mode',
      'status',
      'dedupeKey',
      'policySnapshot',
      'signalPayload',
      'reason',
      'skippedReason',
      'createdAt',
      'updatedAt',
    ]);
  });

  it('stores decision payloads as jsonb and lifecycle timestamps with defaults', () => {
    expect(meta.policySnapshot).toEqual({
      name: 'policy_snapshot',
      columnType: 'PgJsonb',
      dataType: 'json',
      notNull: true,
      hasDefault: true,
      primary: false,
    });
    expect(meta.signalPayload).toEqual({
      name: 'signal_payload',
      columnType: 'PgJsonb',
      dataType: 'json',
      notNull: true,
      hasDefault: true,
      primary: false,
    });
    expect(meta.createdAt.columnType).toBe('PgTimestamp');
    expect(meta.createdAt.hasDefault).toBe(true);
    expect(meta.updatedAt.columnType).toBe('PgTimestamp');
    expect(meta.updatedAt.hasDefault).toBe(true);
  });
});

describe('memoryScopes table columns', () => {
  const meta = getColumnMeta(memoryScopes);

  it('has exactly 4 columns', () => {
    expect(Object.keys(meta)).toHaveLength(4);
  });

  it('has all expected column keys', () => {
    expect(Object.keys(meta)).toEqual(['scope', 'parentScope', 'displayName', 'configJson']);
  });

  it('stores scope as a text primary key and config as jsonb with default', () => {
    expect(meta.scope).toEqual({
      name: 'scope',
      columnType: 'PgText',
      dataType: 'string',
      notNull: true,
      hasDefault: false,
      primary: true,
    });
    expect(meta.configJson).toEqual({
      name: 'config_json',
      columnType: 'PgJsonb',
      dataType: 'json',
      notNull: true,
      hasDefault: true,
      primary: false,
    });
  });
});

describe('memoryFacts table columns', () => {
  const meta = getColumnMeta(memoryFacts);

  it('has exactly 12 columns', () => {
    expect(Object.keys(meta)).toHaveLength(12);
  });

  it('has all expected column keys', () => {
    expect(Object.keys(meta)).toEqual([
      'id',
      'scope',
      'content',
      'contentModel',
      'entityType',
      'confidence',
      'strength',
      'sourceJson',
      'validFrom',
      'validUntil',
      'createdAt',
      'accessedAt',
    ]);
  });

  it('stores fact identity and content as required text columns', () => {
    expect(meta.id).toEqual({
      name: 'id',
      columnType: 'PgText',
      dataType: 'string',
      notNull: true,
      hasDefault: false,
      primary: true,
    });
    expect(meta.scope).toEqual({
      name: 'scope',
      columnType: 'PgText',
      dataType: 'string',
      notNull: true,
      hasDefault: false,
      primary: false,
    });
    expect(meta.content).toEqual({
      name: 'content',
      columnType: 'PgText',
      dataType: 'string',
      notNull: true,
      hasDefault: false,
      primary: false,
    });
  });

  it('tracks content model and metadata defaults for memory facts', () => {
    expect(meta.contentModel.columnType).toBe('PgText');
    expect(meta.contentModel.notNull).toBe(true);
    expect(meta.contentModel.hasDefault).toBe(true);
    expect(meta.sourceJson.columnType).toBe('PgJsonb');
    expect(meta.sourceJson.hasDefault).toBe(true);
  });

  it('uses numeric scoring columns and timestamp lifecycle columns', () => {
    expect(meta.confidence.columnType).toBe('PgNumeric');
    expect(meta.confidence.notNull).toBe(true);
    expect(meta.confidence.hasDefault).toBe(true);
    expect(meta.strength.columnType).toBe('PgNumeric');
    expect(meta.strength.notNull).toBe(true);
    expect(meta.strength.hasDefault).toBe(true);
    expect(meta.validFrom.columnType).toBe('PgTimestamp');
    expect(meta.validFrom.notNull).toBe(true);
    expect(meta.validUntil.columnType).toBe('PgTimestamp');
    expect(meta.createdAt.columnType).toBe('PgTimestamp');
    expect(meta.accessedAt.columnType).toBe('PgTimestamp');
  });
});

describe('memoryEdges table columns', () => {
  const meta = getColumnMeta(memoryEdges);

  it('has exactly 6 columns', () => {
    expect(Object.keys(meta)).toHaveLength(6);
  });

  it('has all expected column keys', () => {
    expect(Object.keys(meta)).toEqual([
      'id',
      'sourceFactId',
      'targetFactId',
      'relation',
      'weight',
      'createdAt',
    ]);
  });

  it('stores both fact references as required text columns and weight as numeric', () => {
    expect(meta.sourceFactId).toEqual({
      name: 'source_fact_id',
      columnType: 'PgText',
      dataType: 'string',
      notNull: true,
      hasDefault: false,
      primary: false,
    });
    expect(meta.targetFactId).toEqual({
      name: 'target_fact_id',
      columnType: 'PgText',
      dataType: 'string',
      notNull: true,
      hasDefault: false,
      primary: false,
    });
    expect(meta.weight.columnType).toBe('PgNumeric');
    expect(meta.weight.notNull).toBe(true);
    expect(meta.weight.hasDefault).toBe(true);
  });
});

describe('Runtime management foreign key relationships', () => {
  it('managedSessions references machines, agents, and prior managed sessions', () => {
    const config = getTableConfig(managedSessions);
    expect(config.foreignKeys).toHaveLength(3);

    const machineFk = config.foreignKeys.find(
      (fk) => fk.reference().columns[0].name === 'machine_id',
    );
    expect(getTableName(machineFk?.reference().foreignTable)).toBe('machines');

    const agentFk = config.foreignKeys.find((fk) => fk.reference().columns[0].name === 'agent_id');
    expect(getTableName(agentFk?.reference().foreignTable)).toBe('agents');

    const sourceFk = config.foreignKeys.find(
      (fk) => fk.reference().columns[0].name === 'handoff_source_session_id',
    );
    expect(getTableName(sourceFk?.reference().foreignTable)).toBe('managed_sessions');
  });

  it('machineRuntimeState references machines', () => {
    const config = getTableConfig(machineRuntimeState);
    expect(config.foreignKeys).toHaveLength(1);
    expect(getTableName(config.foreignKeys[0].reference().foreignTable)).toBe('machines');
  });

  it('sessionHandoffs references source and target managed sessions', () => {
    const config = getTableConfig(sessionHandoffs);
    expect(config.foreignKeys).toHaveLength(2);
    expect(getTableName(config.foreignKeys[0].reference().foreignTable)).toBe('managed_sessions');
    expect(getTableName(config.foreignKeys[1].reference().foreignTable)).toBe('managed_sessions');
  });

  it('nativeImportAttempts references handoffs and managed sessions', () => {
    const config = getTableConfig(nativeImportAttempts);
    expect(config.foreignKeys).toHaveLength(3);

    const handoffFk = config.foreignKeys.find(
      (fk) => fk.reference().columns[0].name === 'handoff_id',
    );
    expect(getTableName(handoffFk?.reference().foreignTable)).toBe('session_handoffs');

    const sourceFk = config.foreignKeys.find(
      (fk) => fk.reference().columns[0].name === 'source_session_id',
    );
    expect(getTableName(sourceFk?.reference().foreignTable)).toBe('managed_sessions');

    const targetFk = config.foreignKeys.find(
      (fk) => fk.reference().columns[0].name === 'target_session_id',
    );
    expect(getTableName(targetFk?.reference().foreignTable)).toBe('managed_sessions');
  });

  it('runHandoffDecisions references runs, managed sessions, and session handoffs', () => {
    const config = getTableConfig(runHandoffDecisions);
    expect(config.foreignKeys).toHaveLength(4);

    const sourceRunFk = config.foreignKeys.find(
      (fk) => fk.reference().columns[0].name === 'source_run_id',
    );
    expect(getTableName(sourceRunFk?.reference().foreignTable)).toBe('agent_runs');

    const sourceManagedSessionFk = config.foreignKeys.find(
      (fk) => fk.reference().columns[0].name === 'source_managed_session_id',
    );
    expect(getTableName(sourceManagedSessionFk?.reference().foreignTable)).toBe('managed_sessions');

    const targetRunFk = config.foreignKeys.find(
      (fk) => fk.reference().columns[0].name === 'target_run_id',
    );
    expect(getTableName(targetRunFk?.reference().foreignTable)).toBe('agent_runs');

    const handoffFk = config.foreignKeys.find(
      (fk) => fk.reference().columns[0].name === 'handoff_id',
    );
    expect(getTableName(handoffFk?.reference().foreignTable)).toBe('session_handoffs');
  });

  it('memoryScopes can reference a parent memory scope', () => {
    const config = getTableConfig(memoryScopes);
    expect(config.foreignKeys).toHaveLength(1);
    expect(getTableName(config.foreignKeys[0].reference().foreignTable)).toBe('memory_scopes');
  });

  it('memoryEdges references source and target memory facts', () => {
    const config = getTableConfig(memoryEdges);
    expect(config.foreignKeys).toHaveLength(2);
    expect(getTableName(config.foreignKeys[0].reference().foreignTable)).toBe('memory_facts');
    expect(getTableName(config.foreignKeys[1].reference().foreignTable)).toBe('memory_facts');
  });
});

describe('Runtime management default values', () => {
  it('managedSessions defaults status to starting and metadata to an empty object', () => {
    const cols = getTableColumns(managedSessions);
    expect(cols.status.default).toBe('starting');
    expect(cols.metadata.default).toEqual({});
  });

  it('machineRuntimeState defaults installation and auth flags to false', () => {
    const cols = getTableColumns(machineRuntimeState);
    expect(cols.isInstalled.default).toBe(false);
    expect(cols.isAuthenticated.default).toBe(false);
    expect(cols.syncStatus.default).toBe('unknown');
    expect(cols.metadata.default).toEqual({});
  });

  it('sessionHandoffs defaults status to pending', () => {
    const cols = getTableColumns(sessionHandoffs);
    expect(cols.status.default).toBe('pending');
  });

  it('nativeImportAttempts defaults status to pending and metadata to an empty object', () => {
    const cols = getTableColumns(nativeImportAttempts);
    expect(cols.status.default).toBe('pending');
    expect(cols.metadata.default).toEqual({});
  });

  it('runHandoffDecisions defaults policy and signal payloads to an empty object', () => {
    const cols = getTableColumns(runHandoffDecisions);
    expect(cols.policySnapshot.default).toEqual({});
    expect(cols.signalPayload.default).toEqual({});
  });
});

describe('Runtime management indexes', () => {
  it('runHandoffDecisions exposes indexes for source run, trigger, and created at', () => {
    const config = getTableConfig(runHandoffDecisions);
    const indexNames = config.indexes.map((idx) => idx.config.name);

    expect(indexNames).toEqual(
      expect.arrayContaining([
        'idx_run_handoff_decisions_source_run_id',
        'idx_run_handoff_decisions_trigger',
        'idx_run_handoff_decisions_created_at',
      ]),
    );
  });
});
