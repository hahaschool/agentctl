import type {
  MemoryDrawerBackfillSourceType,
  MemoryDrawerBackfillState,
  MemoryDrawerBackfillStatus,
} from '@agentctl/shared';
import type { Pool } from 'pg';
import type { Logger } from 'pino';

export type MemoryDrawerBackfillStateStoreOptions = {
  pool: Pool;
  logger?: Logger;
};

export type StartMemoryDrawerBackfillInput = {
  sourceType: MemoryDrawerBackfillSourceType;
  sourceRoot: string;
  cursorJson?: Record<string, unknown>;
};

type MemoryDrawerBackfillStateRow = {
  id: string;
  source_type: string;
  source_root: string;
  cursor_json: Record<string, unknown> | null;
  status: string;
  last_error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function generateMemoryDrawerBackfillStateId(): string {
  const timestamp = Date.now().toString(36).padStart(10, '0');
  const random = Array.from({ length: 16 }, () => Math.floor(Math.random() * 36).toString(36)).join(
    '',
  );
  return `${timestamp}${random}`;
}

function toIso(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

function rowToBackfillState(row: MemoryDrawerBackfillStateRow): MemoryDrawerBackfillState {
  return {
    id: row.id,
    sourceType: row.source_type as MemoryDrawerBackfillSourceType,
    sourceRoot: row.source_root,
    cursorJson: row.cursor_json ?? {},
    status: row.status as MemoryDrawerBackfillStatus,
    lastError: row.last_error,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function requireBackfillStateRow(
  row: MemoryDrawerBackfillStateRow | undefined,
  stateId: string,
): MemoryDrawerBackfillStateRow {
  if (!row) {
    throw new Error(`Memory drawer backfill state not found: ${stateId}`);
  }
  return row;
}

function safeErrorToken(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  return /^[A-Za-z0-9_.:-]{1,128}$/.test(value) ? value : null;
}

function summarizeBackfillError(error: unknown): string {
  if (error && typeof error === 'object') {
    const code = safeErrorToken((error as { code?: unknown }).code);
    if (code) {
      return code;
    }
  }

  if (error instanceof Error) {
    const name = safeErrorToken(error.name);
    if (name) {
      return name;
    }
  }

  return 'unknown_error';
}

export class MemoryDrawerBackfillStateStore {
  private readonly pool: Pool;

  constructor(options: MemoryDrawerBackfillStateStoreOptions) {
    this.pool = options.pool;
  }

  async startOrResume(input: StartMemoryDrawerBackfillInput): Promise<MemoryDrawerBackfillState> {
    const stateId = generateMemoryDrawerBackfillStateId();
    const result = await this.pool.query<MemoryDrawerBackfillStateRow>(
      `INSERT INTO memory_drawer_backfill_state (
         id, source_type, source_root, cursor_json, status, last_error
       ) VALUES (
         $1, $2, $3, $4, 'running', NULL
       )
       ON CONFLICT (source_type, source_root)
       DO UPDATE SET
         status = 'running',
         last_error = NULL,
         updated_at = now()
       RETURNING id, source_type, source_root, cursor_json, status, last_error,
         created_at, updated_at`,
      [stateId, input.sourceType, input.sourceRoot, input.cursorJson ?? {}],
    );

    return rowToBackfillState(requireBackfillStateRow(result.rows[0], stateId));
  }

  async getBySource(input: {
    sourceType: MemoryDrawerBackfillSourceType;
    sourceRoot: string;
  }): Promise<MemoryDrawerBackfillState | null> {
    const result = await this.pool.query<MemoryDrawerBackfillStateRow>(
      `SELECT id, source_type, source_root, cursor_json, status, last_error,
         created_at, updated_at
       FROM memory_drawer_backfill_state
       WHERE source_type = $1 AND source_root = $2`,
      [input.sourceType, input.sourceRoot],
    );

    const row = result.rows[0];
    return row ? rowToBackfillState(row) : null;
  }

  async updateCursor(
    stateId: string,
    cursorJson: Record<string, unknown>,
  ): Promise<MemoryDrawerBackfillState> {
    const result = await this.pool.query<MemoryDrawerBackfillStateRow>(
      `UPDATE memory_drawer_backfill_state
       SET cursor_json = $2,
         status = 'running',
         last_error = NULL,
         updated_at = now()
       WHERE id = $1
       RETURNING id, source_type, source_root, cursor_json, status, last_error,
         created_at, updated_at`,
      [stateId, cursorJson],
    );

    return rowToBackfillState(requireBackfillStateRow(result.rows[0], stateId));
  }

  async markPaused(stateId: string): Promise<MemoryDrawerBackfillState> {
    return this.markStatus(stateId, 'paused', null);
  }

  async markComplete(stateId: string): Promise<MemoryDrawerBackfillState> {
    return this.markStatus(stateId, 'complete', null);
  }

  async markFailed(stateId: string, error: unknown): Promise<MemoryDrawerBackfillState> {
    return this.markStatus(stateId, 'failed', summarizeBackfillError(error));
  }

  private async markStatus(
    stateId: string,
    status: MemoryDrawerBackfillStatus,
    lastError: string | null,
  ): Promise<MemoryDrawerBackfillState> {
    const result = await this.pool.query<MemoryDrawerBackfillStateRow>(
      `UPDATE memory_drawer_backfill_state
       SET status = $2,
         last_error = $3,
         updated_at = now()
       WHERE id = $1
       RETURNING id, source_type, source_root, cursor_json, status, last_error,
         created_at, updated_at`,
      [stateId, status, lastError],
    );

    return rowToBackfillState(requireBackfillStateRow(result.rows[0], stateId));
  }
}
