// ---------------------------------------------------------------------------
// Build info — appVersion, gitSha, schemaVersion surfaced on /health
//
// Roadmap: docs/ROADMAP.md §33.9 Mesh Version Observability. Peers ping each
// other's /health and persist these fields on sync_nodes so operators can see
// version drift across the mesh before automated rollouts (33.11) land.
// ---------------------------------------------------------------------------

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CURRENT_FILE_DIR = dirname(fileURLToPath(import.meta.url));

const MIGRATION_FILENAME_PATTERN = /^(\d{4,})_.+\.sql$/;

let cachedAppVersion: string | null = null;
let cachedSchemaVersion: number | null = null;

/**
 * Highest numeric prefix across drizzle migration files shipped with this
 * build (e.g. `0024_sync_nodes_peer_version.sql` → 24). Represents the
 * producer's schema version, not the database's applied state.
 */
export function getSchemaVersion(): number {
  if (cachedSchemaVersion !== null) return cachedSchemaVersion;

  const candidateDirs = [
    join(CURRENT_FILE_DIR, 'drizzle'),
    join(CURRENT_FILE_DIR, '..', 'drizzle'),
  ];

  for (const dir of candidateDirs) {
    if (!existsSync(dir)) continue;
    try {
      const entries = readdirSync(dir);
      let max = 0;
      for (const entry of entries) {
        const match = MIGRATION_FILENAME_PATTERN.exec(entry);
        if (!match) continue;
        const n = Number.parseInt(match[1], 10);
        if (Number.isFinite(n) && n > max) max = n;
      }
      cachedSchemaVersion = max;
      return cachedSchemaVersion;
    } catch {
      // fall through to next candidate
    }
  }

  cachedSchemaVersion = 0;
  return cachedSchemaVersion;
}

/** The control-plane's semver appVersion from its package.json. */
export function getAppVersion(): string {
  if (cachedAppVersion !== null) return cachedAppVersion;

  const candidates = [
    join(CURRENT_FILE_DIR, '..', 'package.json'),
    join(CURRENT_FILE_DIR, '..', '..', 'package.json'),
    join(CURRENT_FILE_DIR, 'package.json'),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const parsed = JSON.parse(readFileSync(candidate, 'utf-8')) as {
        name?: string;
        version?: string;
      };
      if (parsed.name === '@agentctl/control-plane' && typeof parsed.version === 'string') {
        cachedAppVersion = parsed.version;
        return cachedAppVersion;
      }
    } catch {
      // keep looking
    }
  }

  cachedAppVersion = 'unknown';
  return cachedAppVersion;
}

/**
 * Short git SHA at build time. Sourced from `GIT_SHA` env (written by
 * `scripts/version-bump.sh` or CI) or `GITHUB_SHA` in CI runs. Falls back
 * to `'unknown'` so the /health endpoint never fails to answer.
 */
export function getGitSha(): string {
  const fromBuild = process.env.GIT_SHA?.trim();
  if (fromBuild) return fromBuild;
  const fromCi = process.env.GITHUB_SHA?.trim();
  if (fromCi) return fromCi.slice(0, 7);
  return 'unknown';
}

/** Test-only: reset cached values between specs. */
export function __resetBuildInfoCacheForTests(): void {
  cachedAppVersion = null;
  cachedSchemaVersion = null;
}
