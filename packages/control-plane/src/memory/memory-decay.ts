// ---------------------------------------------------------------------------
// Memory Decay — §3.6 Knowledge Engineering
//
// Applies Ebbinghaus-inspired exponential decay to memory fact strength.
//
// Formula: new_strength = strength * e^(-t / τ)
//   where t = days since last access, τ = 30 (half-life ≈ 21 days)
//
// Pinned facts are exempt from decay. Facts whose strength drops below
// the archive threshold (0.1) are soft-deleted via valid_until.
// ---------------------------------------------------------------------------

import type { Pool } from 'pg';
import type { Logger } from 'pino';

/** τ (tau) — time constant in days. Half-life ≈ τ * ln(2) ≈ 20.8 days. */
const TAU_DAYS = 30;

/** Facts with strength below this threshold are archived (soft-deleted). */
const ARCHIVE_THRESHOLD = 0.1;

/** Facts updated/accessed within this window (hours) are skipped. */
const COOLDOWN_HOURS = 24;

export type DecayResult = {
  decayed: number;
  archived: number;
  skipped: number;
};

export type StrengthBucket = {
  low: number;
  mediumLow: number;
  mediumHigh: number;
  high: number;
};

export type DecayStats = {
  strengthDistribution: StrengthBucket;
  pinnedCount: number;
  archivedCount: number;
};

export type MemoryDecayOptions = {
  pool: Pool;
  logger: Logger;
};

export class MemoryDecay {
  private readonly pool: Pool;
  private readonly logger: Logger;

  constructor(options: MemoryDecayOptions) {
    this.pool = options.pool;
    this.logger = options.logger;
  }

  /**
   * Apply Ebbinghaus-curve decay to all eligible (non-pinned, non-recent) facts.
   *
   * Runs in two phases within a single transaction:
   *  1. UPDATE strength using the exponential retention formula.
   *  2. Archive (soft-delete) any facts whose strength fell below the threshold.
   */
  async runDecay(): Promise<DecayResult> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Phase 1: Apply exponential decay.
      // new_strength = strength * exp(- days_since_access / τ)
      // Only touch facts that are:
      //   - active (valid_until IS NULL)
      //   - not pinned
      //   - not accessed within the cooldown window
      const decayResult = await client.query(
        `UPDATE memory_facts
         SET strength = (strength::double precision * exp(
           -1.0 * EXTRACT(EPOCH FROM (now() - accessed_at)) / 86400.0 / $1
         ))::numeric(4,3)
         WHERE valid_until IS NULL
           AND COALESCE(pinned, false) = false
           AND accessed_at < now() - interval '${COOLDOWN_HOURS} hours'
           AND strength::double precision * exp(
             -1.0 * EXTRACT(EPOCH FROM (now() - accessed_at)) / 86400.0 / $1
           ) < strength::double precision`,
        [TAU_DAYS],
      );

      const decayed = decayResult.rowCount ?? 0;

      // Phase 2: Archive facts that have decayed below the threshold.
      const archiveResult = await client.query(
        `UPDATE memory_facts
         SET valid_until = now()
         WHERE valid_until IS NULL
           AND COALESCE(pinned, false) = false
           AND strength::double precision < $1`,
        [ARCHIVE_THRESHOLD],
      );

      const archived = archiveResult.rowCount ?? 0;

      // Count skipped (pinned + recently accessed) for reporting.
      const skippedResult = await client.query(
        `SELECT COUNT(*)::int AS cnt
         FROM memory_facts
         WHERE valid_until IS NULL
           AND (
             COALESCE(pinned, false) = true
             OR accessed_at >= now() - interval '${COOLDOWN_HOURS} hours'
           )`,
      );

      const skipped = (skippedResult.rows[0] as { cnt: number } | undefined)?.cnt ?? 0;

      await client.query('COMMIT');

      this.logger.info(
        { decayed, archived, skipped },
        'Memory decay cycle complete',
      );

      return { decayed, archived, skipped };
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error({ err: error }, 'Memory decay cycle failed');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Return strength distribution buckets and counts of pinned / archived facts.
   */
  async getDecayStats(): Promise<DecayStats> {
    const [distributionResult, pinnedResult, archivedResult] = await Promise.all([
      this.pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE strength::double precision < 0.25)::int                                       AS low,
           COUNT(*) FILTER (WHERE strength::double precision >= 0.25 AND strength::double precision < 0.5)::int  AS medium_low,
           COUNT(*) FILTER (WHERE strength::double precision >= 0.5  AND strength::double precision < 0.75)::int AS medium_high,
           COUNT(*) FILTER (WHERE strength::double precision >= 0.75)::int                                       AS high
         FROM memory_facts
         WHERE valid_until IS NULL`,
      ),
      this.pool.query(
        `SELECT COUNT(*)::int AS cnt
         FROM memory_facts
         WHERE valid_until IS NULL
           AND COALESCE(pinned, false) = true`,
      ),
      this.pool.query(
        `SELECT COUNT(*)::int AS cnt
         FROM memory_facts
         WHERE valid_until IS NOT NULL`,
      ),
    ]);

    const dist = distributionResult.rows[0] as Record<string, number> | undefined;
    const pinnedRow = pinnedResult.rows[0] as { cnt: number } | undefined;
    const archivedRow = archivedResult.rows[0] as { cnt: number } | undefined;

    return {
      strengthDistribution: {
        low: dist?.low ?? 0,
        mediumLow: dist?.medium_low ?? 0,
        mediumHigh: dist?.medium_high ?? 0,
        high: dist?.high ?? 0,
      },
      pinnedCount: pinnedRow?.cnt ?? 0,
      archivedCount: archivedRow?.cnt ?? 0,
    };
  }
}
