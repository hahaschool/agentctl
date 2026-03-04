import { eq } from 'drizzle-orm';

import type { Database } from '../db/index.js';
import { projectAccountMappings, settings } from '../db/schema.js';

export type AccountResolutionContext = {
  sessionAccountId?: string | null;
  agentAccountId?: string | null;
  projectPath?: string | null;
};

/**
 * Extract the project name from an absolute or relative path.
 * E.g. `/Users/someone/agentctl` → `agentctl`, `my-project` → `my-project`.
 */
export function extractProjectName(pathStr: string): string {
  const trimmed = pathStr.replace(/\/+$/, '');
  const lastSlash = trimmed.lastIndexOf('/');
  return lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed;
}

/**
 * Resolve which API account to use following the priority cascade:
 *
 *   1. Session-level override  (`ctx.sessionAccountId`)
 *   2. Agent-level assignment  (`ctx.agentAccountId`)
 *   3. Project-level mapping   (looked up from `project_account_mappings`)
 *      - First tries exact match on `projectPath`
 *      - Then tries matching by project name (last path segment) to support
 *        cross-machine portability where absolute paths differ
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
    // 3a: Exact match
    const [exactMapping] = await db
      .select()
      .from(projectAccountMappings)
      .where(eq(projectAccountMappings.projectPath, ctx.projectPath));
    if (exactMapping) return exactMapping.accountId;

    // 3b: Match by project name (basename) for cross-machine portability
    const projectName = extractProjectName(ctx.projectPath);
    if (projectName) {
      const allMappings = await db.select().from(projectAccountMappings);
      const nameMatch = allMappings.find(
        (m) => extractProjectName(m.projectPath) === projectName,
      );
      if (nameMatch) return nameMatch.accountId;
    }
  }

  // Level 4: Global default
  const [setting] = await db.select().from(settings).where(eq(settings.key, 'default_account_id'));
  return (setting?.value as { value?: string })?.value ?? null;
}
