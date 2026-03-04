import { eq } from 'drizzle-orm';

import type { Database } from '../db/index.js';
import { projectAccountMappings, settings } from '../db/schema.js';

export type AccountResolutionContext = {
  sessionAccountId?: string | null;
  agentAccountId?: string | null;
  projectPath?: string | null;
};

/**
 * Resolve which API account to use following the priority cascade:
 *
 *   1. Session-level override  (`ctx.sessionAccountId`)
 *   2. Agent-level assignment  (`ctx.agentAccountId`)
 *   3. Project-level mapping   (looked up from `project_account_mappings`)
 *   4. Global default          (looked up from `settings` table, key `default_account_id`)
 *
 * Returns `null` when no account can be resolved.
 */
export async function resolveAccountId(
  ctx: AccountResolutionContext,
  db: Database,
): Promise<string | null> {
  // Level 1: Session-level override
  if (ctx.sessionAccountId) return ctx.sessionAccountId;

  // Level 2: Agent-level assignment
  if (ctx.agentAccountId) return ctx.agentAccountId;

  // Level 3: Project-level mapping
  if (ctx.projectPath) {
    const [mapping] = await db
      .select()
      .from(projectAccountMappings)
      .where(eq(projectAccountMappings.projectPath, ctx.projectPath));
    if (mapping) return mapping.accountId;
  }

  // Level 4: Global default
  const [setting] = await db.select().from(settings).where(eq(settings.key, 'default_account_id'));
  return (setting?.value as { value?: string })?.value ?? null;
}
