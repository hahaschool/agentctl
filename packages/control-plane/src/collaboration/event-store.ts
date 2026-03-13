import type { CrossSpaceQueryResultEvent, SpaceEvent } from '@agentctl/shared';
import { ControlPlaneError } from '@agentctl/shared';
import { and, eq, gt, gte, inArray, lte, sql } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';
import { extractRows, spaceEvents, spaces } from '../db/index.js';

type AppendEventInput = {
  spaceId: string;
  threadId: string;
  idempotencyKey: string;
  correlationId?: string;
  type: string;
  senderType: string;
  senderId: string;
  payload: Record<string, unknown>;
  visibility?: string;
};

type GetEventsOptions = {
  after?: number;
  limit?: number;
};

type CrossSpaceQueryOptions = {
  readonly spaceIds: readonly string[];
  readonly eventTypes?: readonly string[];
  readonly timeRange?: { readonly start?: string; readonly end?: string };
  readonly textQuery?: string;
  readonly limit?: number;
};

export class EventStore {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  /**
   * Append an event to a thread with an atomically incremented sequence number.
   *
   * Uses a single INSERT ... SELECT to compute the next sequence_num from
   * existing events in the same thread, providing gap-free ordering without
   * requiring an explicit transaction or advisory lock.
   *
   * Idempotency is guaranteed by the unique constraint on idempotency_key.
   * If the key already exists, the existing event is returned instead.
   */
  async appendEvent(input: AppendEventInput): Promise<SpaceEvent> {
    // Check idempotency first
    const existing = await this.getEventByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      return existing;
    }

    // Atomically compute next sequence_num and insert
    const result = await this.db.execute(sql`
      INSERT INTO space_events (
        space_id, thread_id, sequence_num, idempotency_key, correlation_id,
        type, sender_type, sender_id, payload, visibility
      )
      VALUES (
        ${input.spaceId},
        ${input.threadId},
        COALESCE(
          (SELECT MAX(sequence_num) FROM space_events WHERE thread_id = ${input.threadId}),
          0
        ) + 1,
        ${input.idempotencyKey},
        ${input.correlationId ?? ''},
        ${input.type},
        ${input.senderType},
        ${input.senderId},
        ${JSON.stringify(input.payload)}::jsonb,
        ${input.visibility ?? 'public'}
      )
      RETURNING id, space_id, thread_id, sequence_num, idempotency_key,
                correlation_id, type, sender_type, sender_id, payload,
                visibility, created_at
    `);

    type EventRow = {
      id: string;
      space_id: string;
      thread_id: string;
      sequence_num: number;
      idempotency_key: string;
      correlation_id: string;
      type: string;
      sender_type: string;
      sender_id: string;
      payload: Record<string, unknown>;
      visibility: string;
      created_at: Date;
    };

    const rows = extractRows<EventRow>(result);
    if (rows.length === 0) {
      throw new ControlPlaneError('EVENT_APPEND_FAILED', 'Failed to insert event row', { input });
    }

    const row = rows[0];
    this.logger.info(
      { eventId: row.id, threadId: input.threadId, sequenceNum: row.sequence_num },
      'Event appended',
    );

    return this.rawRowToEvent(row);
  }

  async getEvents(threadId: string, options: GetEventsOptions = {}): Promise<SpaceEvent[]> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const after = options.after ?? 0;

    const conditions = [eq(spaceEvents.threadId, threadId)];
    if (after > 0) {
      conditions.push(gt(spaceEvents.sequenceNum, after));
    }

    const rows = await this.db
      .select()
      .from(spaceEvents)
      .where(and(...conditions))
      .orderBy(spaceEvents.sequenceNum)
      .limit(limit);

    return rows.map((row) => this.toEvent(row));
  }

  async getEventByIdempotencyKey(key: string): Promise<SpaceEvent | undefined> {
    const rows = await this.db
      .select()
      .from(spaceEvents)
      .where(eq(spaceEvents.idempotencyKey, key));

    if (rows.length === 0) {
      return undefined;
    }

    return this.toEvent(rows[0]);
  }

  /**
   * Query events across multiple spaces with filtering by event type,
   * time range, and text content.  Returns events in chronological order
   * enriched with the originating space name.
   */
  async queryAcrossSpaces(
    options: CrossSpaceQueryOptions,
  ): Promise<{ events: CrossSpaceQueryResultEvent[]; totalMatched: number }> {
    const MAX_LIMIT = 200;
    const DEFAULT_LIMIT = 50;
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

    // Build dynamic WHERE conditions
    const conditions = [inArray(spaceEvents.spaceId, [...options.spaceIds])];

    // Only non-silent events are visible to cross-space queries
    conditions.push(sql`${spaceEvents.visibility} != 'silent'`);

    if (options.eventTypes && options.eventTypes.length > 0) {
      conditions.push(inArray(spaceEvents.type, [...options.eventTypes]));
    }

    if (options.timeRange?.start) {
      conditions.push(gte(spaceEvents.createdAt, new Date(options.timeRange.start)));
    }

    if (options.timeRange?.end) {
      conditions.push(lte(spaceEvents.createdAt, new Date(options.timeRange.end)));
    }

    if (options.textQuery && options.textQuery.trim().length > 0) {
      // Search in the JSONB payload for text content
      conditions.push(sql`${spaceEvents.payload}::text ILIKE ${`%${options.textQuery.trim()}%`}`);
    }

    // Count total matches before applying LIMIT
    const countResult = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(spaceEvents)
      .where(and(...conditions));

    const totalMatched = countResult[0]?.count ?? 0;

    // Fetch the actual events joined with space names, ordered chronologically
    const rows = await this.db
      .select({
        id: spaceEvents.id,
        spaceId: spaceEvents.spaceId,
        spaceName: spaces.name,
        threadId: spaceEvents.threadId,
        sequenceNum: spaceEvents.sequenceNum,
        type: spaceEvents.type,
        senderType: spaceEvents.senderType,
        senderId: spaceEvents.senderId,
        payload: spaceEvents.payload,
        visibility: spaceEvents.visibility,
        createdAt: spaceEvents.createdAt,
      })
      .from(spaceEvents)
      .innerJoin(spaces, eq(spaceEvents.spaceId, spaces.id))
      .where(and(...conditions))
      .orderBy(spaceEvents.createdAt)
      .limit(limit);

    const events: CrossSpaceQueryResultEvent[] = rows.map((row) => ({
      id: row.id,
      spaceId: row.spaceId,
      spaceName: row.spaceName,
      threadId: row.threadId,
      sequenceNum: Number(row.sequenceNum),
      type: row.type,
      senderType: row.senderType,
      senderId: row.senderId,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      visibility: (row.visibility ?? 'public') as string,
      createdAt: (row.createdAt ?? new Date()).toISOString(),
    }));

    return { events, totalMatched };
  }

  private toEvent(row: typeof spaceEvents.$inferSelect): SpaceEvent {
    return {
      id: row.id,
      spaceId: row.spaceId,
      threadId: row.threadId,
      sequenceNum: Number(row.sequenceNum),
      type: row.type as SpaceEvent['type'],
      senderType: row.senderType as SpaceEvent['senderType'],
      senderId: row.senderId,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      visibility: (row.visibility ?? 'public') as SpaceEvent['visibility'],
      createdAt: (row.createdAt ?? new Date()).toISOString(),
    };
  }

  private rawRowToEvent(row: {
    id: string;
    space_id: string;
    thread_id: string;
    sequence_num: number;
    type: string;
    sender_type: string;
    sender_id: string;
    payload: Record<string, unknown>;
    visibility: string;
    created_at: Date;
  }): SpaceEvent {
    return {
      id: row.id,
      spaceId: row.space_id,
      threadId: row.thread_id,
      sequenceNum: Number(row.sequence_num),
      type: row.type as SpaceEvent['type'],
      senderType: row.sender_type as SpaceEvent['senderType'],
      senderId: row.sender_id,
      payload: row.payload ?? {},
      visibility: (row.visibility ?? 'public') as SpaceEvent['visibility'],
      createdAt: (row.created_at ?? new Date()).toISOString(),
    };
  }
}
