import type { Thread } from '@agentctl/shared';
import { ControlPlaneError } from '@agentctl/shared';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';
import { threads } from '../db/index.js';

type CreateThreadInput = {
  spaceId: string;
  type: string;
  title?: string | null;
};

export class ThreadStore {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  async createThread(input: CreateThreadInput): Promise<Thread> {
    const rows = await this.db
      .insert(threads)
      .values({
        spaceId: input.spaceId,
        type: input.type,
        title: input.title ?? null,
      })
      .returning();

    if (rows.length === 0) {
      throw new ControlPlaneError('THREAD_CREATE_FAILED', 'Failed to insert thread row', {
        input,
      });
    }

    this.logger.info({ threadId: rows[0].id, spaceId: input.spaceId }, 'Thread created');
    return this.toThread(rows[0]);
  }

  async getThread(id: string): Promise<Thread | undefined> {
    const rows = await this.db.select().from(threads).where(eq(threads.id, id));

    if (rows.length === 0) {
      return undefined;
    }

    return this.toThread(rows[0]);
  }

  async listThreads(spaceId: string): Promise<Thread[]> {
    const rows = await this.db.select().from(threads).where(eq(threads.spaceId, spaceId));
    return rows.map((row) => this.toThread(row));
  }

  async deleteThread(id: string): Promise<void> {
    const result = await this.db
      .delete(threads)
      .where(eq(threads.id, id))
      .returning({ id: threads.id });

    if (result.length === 0) {
      throw new ControlPlaneError('THREAD_NOT_FOUND', `Thread '${id}' does not exist`, { id });
    }

    this.logger.info({ threadId: id }, 'Thread deleted');
  }

  private toThread(row: typeof threads.$inferSelect): Thread {
    return {
      id: row.id,
      spaceId: row.spaceId,
      title: row.title ?? null,
      type: row.type as Thread['type'],
      createdAt: (row.createdAt ?? new Date()).toISOString(),
    };
  }
}
