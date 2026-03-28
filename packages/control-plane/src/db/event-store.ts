import type { EventSenderType, EventVisibility, SpaceEventType } from '@agentctl/shared';
import { and, eq, gt, sql } from 'drizzle-orm';

import type { Database } from './connection.js';
import { extractRows } from './index.js';
import { spaceEvents } from './schema-collaboration.js';

export type AppendEventInput = {
  readonly spaceId: string;
  readonly threadId: string;
  readonly type: SpaceEventType;
  readonly senderType: EventSenderType;
  readonly senderId: string;
  readonly payload: Record<string, unknown>;
  readonly visibility: EventVisibility;
  readonly idempotencyKey: string;
  readonly correlationId: string;
};

export type SpaceEventRecord = {
  readonly id: string;
  readonly spaceId: string;
  readonly threadId: string;
  readonly sequenceNum: number;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly type: string;
  readonly senderType: string;
  readonly senderId: string;
  readonly payload: unknown;
  readonly visibility: string | null;
  readonly published: boolean | null;
  readonly createdAt: Date | null;
};

export type EventStore = {
  appendEvent(input: AppendEventInput): Promise<SpaceEventRecord>;
  listEvents(
    threadId: string,
    opts?: { afterSequence?: number; limit?: number },
  ): Promise<readonly SpaceEventRecord[]>;
  getUnpublished(limit?: number): Promise<readonly SpaceEventRecord[]>;
  markPublished(eventId: string): Promise<void>;
};

export function createEventStore(db: Database): EventStore {
  return {
    async appendEvent(input) {
      // Use a single atomic SQL statement to avoid the read-then-write race condition.
      // COALESCE(MAX(...), 0) + 1 is computed inside the INSERT. If idempotency_key
      // conflicts, fetch and return the existing row.
      const result = await db.execute(sql`
        INSERT INTO space_events (
          id, space_id, thread_id, sequence_num, idempotency_key, correlation_id,
          type, sender_type, sender_id, payload, visibility, published, created_at
        )
        VALUES (
          gen_random_uuid(),
          ${input.spaceId},
          ${input.threadId},
          COALESCE((SELECT MAX(sequence_num) FROM space_events WHERE thread_id = ${input.threadId}), 0) + 1,
          ${input.idempotencyKey},
          ${input.correlationId},
          ${input.type},
          ${input.senderType},
          ${input.senderId},
          ${JSON.stringify(input.payload)}::jsonb,
          ${input.visibility},
          FALSE,
          now()
        )
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING
          id,
          space_id AS "spaceId",
          thread_id AS "threadId",
          sequence_num AS "sequenceNum",
          idempotency_key AS "idempotencyKey",
          correlation_id AS "correlationId",
          type,
          sender_type AS "senderType",
          sender_id AS "senderId",
          payload,
          visibility,
          published,
          created_at AS "createdAt"
      `);

      const insertedRows = extractRows<SpaceEventRecord>(result);
      if (insertedRows.length > 0) {
        return insertedRows[0] as SpaceEventRecord;
      }

      const existing = await db
        .select()
        .from(spaceEvents)
        .where(eq(spaceEvents.idempotencyKey, input.idempotencyKey));
      return toSpaceEventRecord(existing[0] as (typeof existing)[0]);
    },

    async listEvents(threadId, opts) {
      const limit = opts?.limit ?? 100;
      const afterSeq = opts?.afterSequence ?? 0;

      const rows = await db
        .select()
        .from(spaceEvents)
        .where(and(eq(spaceEvents.threadId, threadId), gt(spaceEvents.sequenceNum, afterSeq)))
        .orderBy(spaceEvents.sequenceNum)
        .limit(limit);

      return rows.map(toSpaceEventRecord);
    },

    async getUnpublished(limit = 100) {
      const rows = await db
        .select()
        .from(spaceEvents)
        .where(eq(spaceEvents.published, false))
        .orderBy(spaceEvents.createdAt)
        .limit(limit);

      return rows.map(toSpaceEventRecord);
    },

    async markPublished(eventId) {
      await db.update(spaceEvents).set({ published: true }).where(eq(spaceEvents.id, eventId));
    },
  };
}

function toSpaceEventRecord(row: typeof spaceEvents.$inferSelect): SpaceEventRecord {
  return {
    id: row.id,
    spaceId: row.spaceId,
    threadId: row.threadId,
    sequenceNum: row.sequenceNum,
    idempotencyKey: row.idempotencyKey,
    correlationId: row.correlationId,
    type: row.type,
    senderType: row.senderType,
    senderId: row.senderId,
    payload: row.payload,
    visibility: row.visibility ?? null,
    published: row.published ?? null,
    createdAt: row.createdAt ?? null,
  };
}
