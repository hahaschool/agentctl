import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TierConfig } from '@agentctl/shared';
import { parse } from 'dotenv';

/** Pattern for env var names that may contain secrets. */
const SECRET_PATTERN = /KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL/i;

/** Known tier definitions with their .env file names and display labels. */
const TIER_DEFS = [
  { file: '.env.dev-1', name: 'dev-1', label: 'Dev 1' },
  { file: '.env.dev-2', name: 'dev-2', label: 'Dev 2' },
  { file: '.env.beta', name: 'beta', label: 'Beta' },
] as const;

/** Cache: repoRoot -> TierConfig[] */
const configCache = new Map<string, readonly TierConfig[]>();

/**
 * Extract the database name from a PostgreSQL connection URL.
 *
 * E.g. `postgresql://user@host:5433/agentctl` -> `"agentctl"`
 */
function extractDbName(url: string): string {
  try {
    const parsed = new URL(url);
    // pathname is "/dbname" — strip leading slash
    return parsed.pathname.replace(/^\//, '');
  } catch {
    // Fallback: grab text after last '/'
    const idx = url.lastIndexOf('/');
    return idx >= 0 ? url.slice(idx + 1) : '';
  }
}

/**
 * Extract the Redis DB number from a Redis URL.
 *
 * E.g. `redis://localhost:6379/1` -> `1`
 */
function extractRedisDb(url: string): number {
  try {
    const parsed = new URL(url);
    const db = parsed.pathname.replace(/^\//, '');
    const num = Number.parseInt(db, 10);
    return Number.isNaN(num) ? 0 : num;
  } catch {
    return 0;
  }
}

/**
 * Filter out secret-bearing env vars from a parsed env object.
 * Returns a new object (immutable pattern).
 */
function filterSecrets(env: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!SECRET_PATTERN.test(key)) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Parse a single .env file into a TierConfig, or null if the file does not exist
 * or lacks required keys.
 */
function parseTierEnv(repoRoot: string, def: (typeof TIER_DEFS)[number]): TierConfig | null {
  const filePath = join(repoRoot, def.file);
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  const env = filterSecrets(parse(raw));

  const cpPort = Number.parseInt(env.CP_PORT ?? env.CONTROL_PLANE_PORT ?? '', 10);
  const workerPort = Number.parseInt(env.WORKER_PORT ?? '', 10);
  const webPort = Number.parseInt(env.WEB_PORT ?? '', 10);

  if (Number.isNaN(cpPort) || Number.isNaN(workerPort) || Number.isNaN(webPort)) {
    return null;
  }

  const databaseUrl = env.DATABASE_URL ?? '';
  const redisUrl = env.REDIS_URL ?? '';

  return {
    name: def.name,
    label: def.label,
    cpPort,
    workerPort,
    webPort,
    database: extractDbName(databaseUrl),
    redisDb: extractRedisDb(redisUrl),
  };
}

/**
 * Load tier configurations from `.env.beta`, `.env.dev-1`, `.env.dev-2`
 * in the given repo root directory.
 *
 * Results are memoized per repoRoot.
 */
export function loadTierConfigs(repoRoot: string): readonly TierConfig[] {
  const cached = configCache.get(repoRoot);
  if (cached) {
    return cached;
  }

  const configs: TierConfig[] = [];
  for (const def of TIER_DEFS) {
    const config = parseTierEnv(repoRoot, def);
    if (config) {
      configs.push(config);
    }
  }

  const frozen = Object.freeze(configs);
  configCache.set(repoRoot, frozen);
  return frozen;
}

/**
 * Clear the memoized config cache (useful in tests).
 */
export function clearTierConfigCache(): void {
  configCache.clear();
}

/**
 * Validate that a source tier name is a valid dev tier AND exists in the
 * provided configs.
 *
 * Source tiers must match `/^dev-\d+$/` (e.g. "dev-1", "dev-2") — the beta
 * tier is always the promotion target, never the source.
 */
export function isValidSourceTier(source: string, configs: readonly TierConfig[]): boolean {
  if (!/^dev-\d+$/.test(source)) {
    return false;
  }
  return configs.some((c) => c.name === source);
}
