import { and, eq, isNull, lt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import type { Database } from '../../db/index.js';
import { agentRuns } from '../../db/schema.js';

/**
 * How often to check for stale runs (every 60 seconds).
 */
const REAPER_INTERVAL_MS = 60_000;

/**
 * A run stuck in 'running' for longer than this is considered stale
 * and will be reaped. Default: 30 minutes.
 */
const STALE_RUN_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Registers a periodic background task that marks stale "running" agent runs
 * as failed. This covers cases where the worker crashes, loses connectivity,
 * or the completion callback is lost.
 */
export function registerRunReaper(app: FastifyInstance, db: Database): void {
  async function reapStaleRuns(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - STALE_RUN_TIMEOUT_MS);

      const staleRows = await db
        .update(agentRuns)
        .set({
          status: 'failure',
          finishedAt: new Date(),
          errorMessage:
            'Run timed out — no completion callback received from worker within 30 minutes',
        })
        .where(
          and(
            eq(agentRuns.status, 'running'),
            isNull(agentRuns.finishedAt),
            lt(agentRuns.startedAt, cutoff),
          ),
        )
        .returning({ id: agentRuns.id });

      if (staleRows.length > 0) {
        const ids = staleRows.map((row) => row.id);
        app.log.warn(
          { count: ids.length, runIds: ids },
          'Reaped stale agent runs stuck in "running" state',
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      app.log.error({ err: message }, 'Stale run reaper failed');
    }
  }

  const reaperTimer = setInterval(reapStaleRuns, REAPER_INTERVAL_MS);

  app.addHook('onClose', async () => {
    clearInterval(reaperTimer);
  });

  // Run once immediately on startup to clean up any stale runs from
  // before the server restarted.
  void reapStaleRuns();
}
