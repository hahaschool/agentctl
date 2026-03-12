import type { SpaceEvent } from '@agentctl/shared';
import { eq, sql } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';
import { spaceEvents } from '../db/index.js';

import type { EventBus } from './event-bus.js';

const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_BATCH_SIZE = 100;

export type OutboxPublisherOptions = {
  readonly pollIntervalMs?: number;
  readonly batchSize?: number;
};

/**
 * Polls the space_events outbox for unpublished events and publishes them
 * to the EventBus, then marks them as published.
 *
 * This implements the transactional outbox pattern:
 *   1. Events are written to Postgres with published=false (by EventStore)
 *   2. This publisher polls for unpublished events
 *   3. Publishes each event to the EventBus (NATS or mock)
 *   4. Marks the event as published=true
 *
 * If the publisher crashes, unpublished events remain in Postgres and will
 * be picked up on restart. At-least-once delivery is guaranteed; consumers
 * must dedupe using idempotencyKey.
 */
export class OutboxPublisher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;

  constructor(
    private readonly db: Database,
    private readonly eventBus: EventBus,
    private readonly logger: Logger,
    options: OutboxPublisherOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  }

  /**
   * Start the polling loop.
   */
  start(): void {
    if (this.timer) {
      return;
    }

    this.running = true;
    this.logger.info(
      { pollIntervalMs: this.pollIntervalMs, batchSize: this.batchSize },
      'Outbox publisher started',
    );

    // Run immediately on start, then at interval
    void this.pollOnce();
    this.timer = setInterval(() => {
      void this.pollOnce();
    }, this.pollIntervalMs);
  }

  /**
   * Stop the polling loop gracefully.
   */
  async stop(): Promise<void> {
    this.running = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.logger.info('Outbox publisher stopped');
  }

  /**
   * Single poll iteration: fetch unpublished events, publish, mark published.
   * Exposed for testing.
   */
  async pollOnce(): Promise<number> {
    if (!this.running) {
      return 0;
    }

    try {
      const rows = await this.db
        .select()
        .from(spaceEvents)
        .where(eq(spaceEvents.published, false))
        .orderBy(spaceEvents.createdAt)
        .limit(this.batchSize);

      if (rows.length === 0) {
        return 0;
      }

      let publishedCount = 0;

      for (const row of rows) {
        const event = this.toSpaceEvent(row);

        try {
          await this.eventBus.publish(event);
          await this.markPublished(row.id);
          publishedCount++;
        } catch (err) {
          this.logger.error(
            { err, eventId: row.id },
            'Failed to publish event, will retry next poll',
          );
          // Stop processing this batch on error to preserve ordering
          break;
        }
      }

      if (publishedCount > 0) {
        this.logger.info({ publishedCount }, 'Outbox batch published');
      }

      return publishedCount;
    } catch (err) {
      this.logger.error({ err }, 'Outbox poll failed');
      return 0;
    }
  }

  private async markPublished(eventId: string): Promise<void> {
    await this.db.update(spaceEvents).set({ published: true }).where(eq(spaceEvents.id, eventId));
  }

  private toSpaceEvent(row: typeof spaceEvents.$inferSelect): SpaceEvent {
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

  /**
   * Get the count of unpublished events (for monitoring).
   */
  async getBacklogCount(): Promise<number> {
    const result = await this.db.execute(
      sql`SELECT COUNT(*) as count FROM space_events WHERE published = false`,
    );
    const rows = result.rows as Array<{ count: string }>;
    return rows.length > 0 ? Number(rows[0].count) : 0;
  }
}
