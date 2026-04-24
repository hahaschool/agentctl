import type { MemoryOpsProgress } from '@agentctl/shared';
import type { Pool, PoolClient } from 'pg';

export type MemoryOpsEventType =
  | 'started'
  | 'progress'
  | 'log'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'cancelling';

export type MemoryOpsEventLevel = 'info' | 'warn' | 'error';

export type MemoryOpsJobEvent = {
  eventId: string;
  jobId: string;
  eventType: MemoryOpsEventType;
  level: MemoryOpsEventLevel | null;
  message: string | null;
  progress: MemoryOpsProgress | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
};

export type InsertJobEventInput = {
  jobId: string;
  eventType: MemoryOpsEventType;
  level?: MemoryOpsEventLevel | null;
  message?: string | null;
  progress?: MemoryOpsProgress | null;
  payload?: Record<string, unknown> | null;
};

type JobEventRow = {
  event_id?: string | number | bigint;
  eventId?: string | number | bigint;
  job_id?: string;
  jobId?: string;
  event_type?: MemoryOpsEventType;
  eventType?: MemoryOpsEventType;
  level: MemoryOpsEventLevel | null;
  message: string | null;
  progress: unknown | null;
  payload: unknown | null;
  created_at?: Date | string;
  createdAt?: Date | string;
};

export class JobEventsRepository {
  constructor(private readonly pool: Pool) {}

  async insert(input: InsertJobEventInput): Promise<MemoryOpsJobEvent> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<JobEventRow>(
        `INSERT INTO memory_ops_job_events (
           job_id,
           event_type,
           level,
           message,
           progress,
           payload
         )
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
         RETURNING *`,
        [
          input.jobId,
          input.eventType,
          input.level ?? null,
          input.message ?? null,
          input.progress ? JSON.stringify(input.progress) : null,
          input.payload ? JSON.stringify(input.payload) : null,
        ],
      );
      await notifyJob(client, input.jobId);
      await client.query('COMMIT');
      return rowToEvent(result.rows[0]);
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async list(jobId: string, afterEventId?: string, limit = 100): Promise<MemoryOpsJobEvent[]> {
    const cursor = /^\d+$/.test(afterEventId ?? '') ? (afterEventId as string) : '0';
    const result = await this.pool.query<JobEventRow>(
      `SELECT *
         FROM memory_ops_job_events
        WHERE job_id = $1
          AND event_id > $2::bigint
        ORDER BY event_id ASC
        LIMIT $3`,
      [jobId, cursor, Math.max(1, Math.min(limit, 500))],
    );
    return result.rows.map(rowToEvent);
  }
}

function rowToEvent(row: JobEventRow): MemoryOpsJobEvent {
  const createdAt = row.created_at ?? row.createdAt ?? new Date(0).toISOString();
  return {
    eventId: String(row.event_id ?? row.eventId),
    jobId: row.job_id ?? row.jobId ?? '',
    eventType: row.event_type ?? row.eventType ?? 'log',
    level: row.level,
    message: row.message,
    progress: row.progress ? (parseRecord(row.progress) as MemoryOpsProgress) : null,
    payload: row.payload ? parseRecord(row.payload) : null,
    createdAt: createdAt instanceof Date ? createdAt.toISOString() : String(createdAt),
  };
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function notifyJob(client: Pick<PoolClient, 'query'>, jobId: string): Promise<void> {
  await client.query("SELECT pg_notify('memory_ops_events', $1)", [jobId]);
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original failure.
  }
}
