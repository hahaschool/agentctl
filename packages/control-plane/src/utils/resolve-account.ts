import { eq } from 'drizzle-orm';

import type { Database } from '../db/index.js';
import { projectAccountMappings, settings } from '../db/schema.js';

export type Logger = {
  warn: (obj: Record<string, unknown>, msg: string) => void;
  info: (obj: Record<string, unknown>, msg: string) => void;
};

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
  // Security: avoid regex with unbounded quantifiers on user-controlled input
  // to prevent polynomial ReDoS. Use lastIndexOf instead.
  let end = pathStr.length;
  while (end > 0 && pathStr[end - 1] === '/') {
    end--;
  }
  const trimmed = pathStr.slice(0, end);
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
  logger?: Logger,
): Promise<string | null> {
  // Level 1: Session-level override
  if (ctx.sessionAccountId) {
    logger?.info({ accountId: ctx.sessionAccountId }, 'Account resolved from session override');
    return ctx.sessionAccountId;
  }

  // Level 2: Agent-level assignment
  if (ctx.agentAccountId) {
    logger?.info({ accountId: ctx.agentAccountId }, 'Account resolved from agent assignment');
    return ctx.agentAccountId;
  }

  // Level 3: Project-level mapping
  if (ctx.projectPath) {
    // 3a: Exact match
    const [exactMapping] = await db
      .select()
      .from(projectAccountMappings)
      .where(eq(projectAccountMappings.projectPath, ctx.projectPath));
    if (exactMapping) {
      logger?.info(
        {
          accountId: exactMapping.accountId,
          projectPath: ctx.projectPath,
          source: 'exact_path_match',
        },
        'Account resolved from project mapping (exact path)',
      );
      return exactMapping.accountId;
    }

    // 3b: Match by project name (basename) for cross-machine portability
    const projectName = extractProjectName(ctx.projectPath);
    if (projectName) {
      const allMappings = await db.select().from(projectAccountMappings);
      const nameMatch = allMappings.find((m) => extractProjectName(m.projectPath) === projectName);
      if (nameMatch) {
        logger?.info(
          { accountId: nameMatch.accountId, projectName, source: 'project_name_match' },
          'Account resolved from project mapping (project name)',
        );
        return nameMatch.accountId;
      }
    }
  }

  // Level 4: Global default
  const [setting] = await db.select().from(settings).where(eq(settings.key, 'default_account_id'));
  const defaultAccountId = (setting?.value as { value?: string })?.value ?? null;

  if (defaultAccountId) {
    logger?.info({ accountId: defaultAccountId }, 'Account resolved from global default');
    return defaultAccountId;
  }

  // No account found
  logger?.warn(
    { projectPath: ctx.projectPath },
    'No API account resolved — session will use system default credentials',
  );
  return null;
}
