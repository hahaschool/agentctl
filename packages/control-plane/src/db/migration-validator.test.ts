import { describe, expect, it } from 'vitest';

import {
  extractMigrationMetadata,
  hasDestructiveOperations,
  validateMigration,
} from './migration-validator.js';

// ============================================================================
// 1. Valid migration scenarios
// ============================================================================

describe('validateMigration — valid migrations', () => {
  it('accepts a valid CREATE TABLE migration', () => {
    const sql = `
BEGIN;
CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "email" text UNIQUE NOT NULL,
  "created_at" timestamp with time zone DEFAULT now()
);
COMMIT;
    `;

    const result = validateMigration(sql);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.summary.tablesCreated).toContain('users');
  });

  it('accepts a valid ALTER TABLE ADD COLUMN migration', () => {
    const sql = `
BEGIN;
ALTER TABLE "agents" ADD COLUMN "schedule_config" jsonb DEFAULT NULL;
COMMIT;
    `;

    const result = validateMigration(sql);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.summary.tablesAltered).toContain('agents');
    expect(result.summary.columnsAdded).toContain('schedule_config');
  });

  it('accepts an empty migration as valid', () => {
    const result = validateMigration('');

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('accepts a comments-only migration as valid', () => {
    const sql = `
-- This is a placeholder migration
-- @author developer
-- @description no-op migration for versioning
    `;

    const result = validateMigration(sql);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('accepts DROP TABLE IF EXISTS (safe form)', () => {
    const sql = `
BEGIN;
DROP TABLE IF EXISTS "old_table";
COMMIT;
    `;

    const result = validateMigration(sql);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    // Still flagged as destructive in summary
    expect(result.summary.hasDestructiveChanges).toBe(true);
  });
});

// ============================================================================
// 2. Error detection
// ============================================================================

describe('validateMigration — errors', () => {
  it('flags DROP TABLE without IF EXISTS as an error', () => {
    const sql = `
DROP TABLE "users";
    `;

    const result = validateMigration(sql);

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/DROP TABLE without IF EXISTS/);
    expect(result.errors[0].severity).toBe('error');
  });

  it('flags TRUNCATE TABLE as an error', () => {
    const sql = `
TRUNCATE TABLE "audit_log";
    `;

    const result = validateMigration(sql);

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/TRUNCATE TABLE/);
    expect(result.errors[0].severity).toBe('error');
  });

  it('flags DELETE FROM without WHERE as an error', () => {
    const sql = `
DELETE FROM "sessions";
    `;

    const result = validateMigration(sql);

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/DELETE FROM without WHERE/);
  });

  it('does not flag DELETE FROM with WHERE clause', () => {
    const sql = `
BEGIN;
DELETE FROM "sessions" WHERE "expired_at" < now();
COMMIT;
    `;

    const result = validateMigration(sql);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('flags ALTER TABLE ... DROP COLUMN as an error', () => {
    const sql = `
ALTER TABLE "agents" DROP COLUMN "deprecated_field";
    `;

    const result = validateMigration(sql);

    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toMatch(/DROP COLUMN.*destructive/);
    expect(result.summary.columnsDropped).toContain('deprecated_field');
  });

  it('provides correct line numbers for errors', () => {
    const sql = `-- comment
-- another comment
DROP TABLE "users";
    `;

    const result = validateMigration(sql);

    expect(result.errors[0].line).toBe(3);
  });

  it('detects multiple errors in one file', () => {
    const sql = `
DROP TABLE "table_a";
TRUNCATE TABLE "table_b";
DELETE FROM "table_c";
    `;

    const result = validateMigration(sql);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ============================================================================
// 3. Warning detection
// ============================================================================

describe('validateMigration — warnings', () => {
  it('warns on ALTER COLUMN TYPE change', () => {
    const sql = `
BEGIN;
ALTER TABLE "agents" ALTER COLUMN "name" TYPE varchar(255);
COMMIT;
    `;

    const result = validateMigration(sql);

    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.message.includes('ALTER COLUMN TYPE'))).toBe(true);
  });

  it('warns on DROP INDEX', () => {
    const sql = `
BEGIN;
DROP INDEX "idx_agents_status";
COMMIT;
    `;

    const result = validateMigration(sql);

    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.message.includes('DROP INDEX'))).toBe(true);
  });

  it('warns on ALTER TABLE ... DROP CONSTRAINT', () => {
    const sql = `
BEGIN;
ALTER TABLE "agents" DROP CONSTRAINT "agents_machine_id_fkey";
COMMIT;
    `;

    const result = validateMigration(sql);

    // DROP CONSTRAINT is a warning, not an error
    expect(result.warnings.some((w) => w.message.includes('DROP CONSTRAINT'))).toBe(true);
  });

  it('warns when transaction wrapper is missing', () => {
    const sql = `
CREATE TABLE IF NOT EXISTS "temp" ("id" serial PRIMARY KEY);
    `;

    const result = validateMigration(sql);

    expect(result.warnings.some((w) => w.message.includes('transaction wrapper'))).toBe(true);
  });

  it('does not warn about transaction when BEGIN/COMMIT are present', () => {
    const sql = `
BEGIN;
CREATE TABLE IF NOT EXISTS "temp" ("id" serial PRIMARY KEY);
COMMIT;
    `;

    const result = validateMigration(sql);

    expect(result.warnings.some((w) => w.message.includes('transaction wrapper'))).toBe(false);
  });
});

// ============================================================================
// 4. Summary extraction
// ============================================================================

describe('validateMigration — summary', () => {
  it('correctly identifies created tables', () => {
    const sql = `
BEGIN;
CREATE TABLE IF NOT EXISTS "machines" (
  "id" text PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS "agents" (
  "id" uuid PRIMARY KEY
);
COMMIT;
    `;

    const result = validateMigration(sql);

    expect(result.summary.tablesCreated).toEqual(['machines', 'agents']);
  });

  it('correctly identifies altered tables (deduplication)', () => {
    const sql = `
BEGIN;
ALTER TABLE "agents" ADD COLUMN "col_a" text;
ALTER TABLE "agents" ADD COLUMN "col_b" text;
ALTER TABLE "machines" ADD COLUMN "col_c" text;
COMMIT;
    `;

    const result = validateMigration(sql);

    expect(result.summary.tablesAltered).toEqual(['agents', 'machines']);
  });

  it('correctly identifies added columns', () => {
    const sql = `
BEGIN;
ALTER TABLE "agents" ADD COLUMN "loop_config" jsonb DEFAULT NULL;
ALTER TABLE "agent_runs" ADD COLUMN "loop_iteration" integer DEFAULT NULL;
ALTER TABLE "agent_runs" ADD COLUMN "parent_run_id" text DEFAULT NULL;
COMMIT;
    `;

    const result = validateMigration(sql);

    expect(result.summary.columnsAdded).toEqual(['loop_config', 'loop_iteration', 'parent_run_id']);
  });

  it('correctly identifies dropped columns', () => {
    const sql = `
ALTER TABLE "agents" DROP COLUMN "old_field";
ALTER TABLE "agents" DROP COLUMN "deprecated";
    `;

    const result = validateMigration(sql);

    expect(result.summary.columnsDropped).toEqual(['old_field', 'deprecated']);
  });

  it('correctly identifies created indexes', () => {
    const sql = `
BEGIN;
CREATE INDEX IF NOT EXISTS "idx_machines_status" ON "machines" ("status");
CREATE UNIQUE INDEX "idx_agents_name" ON "agents" ("name");
COMMIT;
    `;

    const result = validateMigration(sql);

    expect(result.summary.indexesCreated).toEqual(['idx_machines_status', 'idx_agents_name']);
  });

  it('sets hasDestructiveChanges when DROP TABLE IF EXISTS is used', () => {
    const sql = `
BEGIN;
DROP TABLE IF EXISTS "old_table";
COMMIT;
    `;

    const result = validateMigration(sql);

    expect(result.summary.hasDestructiveChanges).toBe(true);
  });

  it('sets hasDestructiveChanges to false for non-destructive migrations', () => {
    const sql = `
BEGIN;
CREATE TABLE IF NOT EXISTS "tasks" ("id" serial PRIMARY KEY);
ALTER TABLE "agents" ADD COLUMN "priority" integer;
COMMIT;
    `;

    const result = validateMigration(sql);

    expect(result.summary.hasDestructiveChanges).toBe(false);
  });
});

// ============================================================================
// 5. Complex / multi-statement scenarios
// ============================================================================

describe('validateMigration — complex scenarios', () => {
  it('handles multiple statement types in one file', () => {
    const sql = `
BEGIN;
CREATE TABLE IF NOT EXISTS "tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "title" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now()
);
ALTER TABLE "agents" ADD COLUMN "task_count" integer DEFAULT 0;
CREATE INDEX IF NOT EXISTS "idx_tasks_created" ON "tasks" ("created_at");
COMMIT;
    `;

    const result = validateMigration(sql);

    expect(result.valid).toBe(true);
    expect(result.summary.tablesCreated).toEqual(['tasks']);
    expect(result.summary.tablesAltered).toEqual(['agents']);
    expect(result.summary.columnsAdded).toEqual(['task_count']);
    expect(result.summary.indexesCreated).toEqual(['idx_tasks_created']);
    expect(result.summary.hasDestructiveChanges).toBe(false);
  });

  it('validates the actual 0002_add_loop_columns.sql migration pattern', () => {
    const sql = `
-- AgentCTL Migration: Add loop-related columns
-- Phase 8.2: Loop checkpoint support

-- Add loop_config to agents table
ALTER TABLE "agents" ADD COLUMN "loop_config" jsonb DEFAULT NULL;

-- Add loop_iteration to agent_runs
ALTER TABLE "agent_runs" ADD COLUMN "loop_iteration" integer DEFAULT NULL;

-- Add parent_run_id to agent_runs
ALTER TABLE "agent_runs" ADD COLUMN "parent_run_id" text DEFAULT NULL;

-- Index for efficient lookup
CREATE INDEX IF NOT EXISTS "idx_agent_runs_parent_run_id" ON "agent_runs" ("parent_run_id");
    `;

    const result = validateMigration(sql);

    expect(result.valid).toBe(true);
    expect(result.summary.tablesAltered).toEqual(['agents', 'agent_runs']);
    expect(result.summary.columnsAdded).toEqual(['loop_config', 'loop_iteration', 'parent_run_id']);
    expect(result.summary.indexesCreated).toEqual(['idx_agent_runs_parent_run_id']);
    // Warning for missing transaction wrapper
    expect(result.warnings.some((w) => w.message.includes('transaction wrapper'))).toBe(true);
  });

  it('handles DELETE FROM with WHERE across multiple lines', () => {
    const sql = `
BEGIN;
DELETE FROM "sessions"
  WHERE "expired_at" < now()
  AND "status" = 'expired';
COMMIT;
    `;

    const result = validateMigration(sql);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// ============================================================================
// 6. hasDestructiveOperations (standalone function)
// ============================================================================

describe('hasDestructiveOperations', () => {
  it('returns true for DROP TABLE', () => {
    expect(hasDestructiveOperations('DROP TABLE "users";')).toBe(true);
  });

  it('returns true for DROP TABLE IF EXISTS', () => {
    expect(hasDestructiveOperations('DROP TABLE IF EXISTS "users";')).toBe(true);
  });

  it('returns true for TRUNCATE TABLE', () => {
    expect(hasDestructiveOperations('TRUNCATE TABLE "sessions";')).toBe(true);
  });

  it('returns true for ALTER TABLE DROP COLUMN', () => {
    expect(hasDestructiveOperations('ALTER TABLE "agents" DROP COLUMN "old";')).toBe(true);
  });

  it('returns true for DELETE FROM without WHERE', () => {
    expect(hasDestructiveOperations('DELETE FROM "sessions";')).toBe(true);
  });

  it('returns false for DELETE FROM with WHERE', () => {
    expect(hasDestructiveOperations('DELETE FROM "sessions" WHERE "id" = 1;')).toBe(false);
  });

  it('returns false for safe operations', () => {
    const sql = `
CREATE TABLE IF NOT EXISTS "test" ("id" serial PRIMARY KEY);
ALTER TABLE "test" ADD COLUMN "name" text;
CREATE INDEX "idx_test_name" ON "test" ("name");
    `;
    expect(hasDestructiveOperations(sql)).toBe(false);
  });

  it('ignores SQL comments', () => {
    const sql = `
-- DROP TABLE "users";
-- TRUNCATE TABLE "sessions";
CREATE TABLE IF NOT EXISTS "test" ("id" serial PRIMARY KEY);
    `;
    expect(hasDestructiveOperations(sql)).toBe(false);
  });
});

// ============================================================================
// 7. extractMigrationMetadata
// ============================================================================

describe('extractMigrationMetadata', () => {
  it('extracts metadata from SQL comments with colon syntax', () => {
    const sql = `
-- @author: developer
-- @description: Add loop columns for checkpoint support
-- @phase: 8.2

ALTER TABLE "agents" ADD COLUMN "loop_config" jsonb;
    `;

    const metadata = extractMigrationMetadata(sql);

    expect(metadata).toEqual({
      author: 'developer',
      description: 'Add loop columns for checkpoint support',
      phase: '8.2',
    });
  });

  it('extracts metadata from SQL comments with space syntax', () => {
    const sql = `
-- @author developer
-- @version 0002

ALTER TABLE "agents" ADD COLUMN "loop_config" jsonb;
    `;

    const metadata = extractMigrationMetadata(sql);

    expect(metadata).toEqual({
      author: 'developer',
      version: '0002',
    });
  });

  it('returns empty object when no metadata comments exist', () => {
    const sql = `
-- This is just a regular comment
CREATE TABLE IF NOT EXISTS "test" ("id" serial PRIMARY KEY);
    `;

    const metadata = extractMigrationMetadata(sql);

    expect(metadata).toEqual({});
  });

  it('handles empty input', () => {
    expect(extractMigrationMetadata('')).toEqual({});
  });

  it('handles mixed metadata and regular comments', () => {
    const sql = `
-- AgentCTL Migration
-- @author: system
-- This is a description
-- @ticket: AGENT-123
CREATE TABLE "test" ("id" serial);
    `;

    const metadata = extractMigrationMetadata(sql);

    expect(metadata).toEqual({
      author: 'system',
      ticket: 'AGENT-123',
    });
  });
});
