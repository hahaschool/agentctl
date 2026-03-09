import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Database } from './connection.js';
import { extractRows } from './index.js';

type ExistsRow = {
  exists: boolean | 't' | 'f' | 1 | 0 | '1' | '0';
};

function toBoolean(value: ExistsRow['exists'] | undefined): boolean {
  return value === true || value === 't' || value === 1 || value === '1';
}

async function hasAgentsRuntimeColumn(db: Database): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'agents'
        AND column_name = 'runtime'
    ) AS exists
  `);

  const rows = extractRows<ExistsRow>(result);
  return toBoolean(rows[0]?.exists);
}

/**
 * Ensure DB schema remains compatible with runtime fields required by the API.
 * This is intentionally idempotent and safe to run on every startup.
 */
export async function ensureSchemaCompatibility(db: Database, logger: Logger): Promise<void> {
  const hasRuntimeColumn = await hasAgentsRuntimeColumn(db);
  if (hasRuntimeColumn) return;

  logger.warn(
    'Schema drift detected: agents.runtime is missing; applying compatibility patch on startup',
  );

  try {
    await db.execute(
      sql`ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "runtime" text DEFAULT 'claude-code'`,
    );
  } catch (err) {
    logger.error(
      { err },
      'Failed to apply compatibility patch for agents.runtime (run DB migrations manually)',
    );
    throw err;
  }

  const hasRuntimeAfterPatch = await hasAgentsRuntimeColumn(db);
  if (!hasRuntimeAfterPatch) {
    throw new Error(
      'Schema compatibility check failed: agents.runtime is still missing after patch attempt',
    );
  }

  logger.info('Schema compatibility patch applied: agents.runtime');
}
