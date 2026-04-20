// ---------------------------------------------------------------------------
// scripts/peer-update.sh content guard.
//
// This bash script is invoked by the authenticated remote endpoint
// `POST /api/sync/peers/:peerId/update`. It is structurally simple but carries
// load-bearing safety steps that, when silently dropped, brick the target node
// (see docs/LESSONS_LEARNED.md — "Remote peer upgrade bricked macmini, 2026-04").
// A content-level regression test guards the invariants so future refactors
// cannot delete them without a loud red CI failure.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT_PATH = path.resolve(import.meta.dirname ?? __dirname, 'peer-update.sh');
const SOURCE = readFileSync(SCRIPT_PATH, 'utf8');

describe('scripts/peer-update.sh', () => {
  it('uses strict error handling (set -euo pipefail)', () => {
    expect(SOURCE).toMatch(/^set -euo pipefail$/m);
  });

  it('snapshots previous SHA before mutating the tree', () => {
    expect(SOURCE).toMatch(/PREVIOUS_SHA="\$\(git rev-parse HEAD\)"/);
  });

  it('runs the canonical psql migration applier before pm2 reload', () => {
    // Migrations must happen before the new CP boots, otherwise the new code
    // queries columns that do not exist in the old schema and crashes.
    const migrateIdx = SOURCE.indexOf('drizzle-migrate-apply.ts');
    const reloadIdx = SOURCE.lastIndexOf('pm2 reload');
    expect(migrateIdx).toBeGreaterThan(-1);
    expect(reloadIdx).toBeGreaterThan(-1);
    expect(migrateIdx).toBeLessThan(reloadIdx);
    const requiredDatabaseUrlLine =
      'DATABASE_URL="$' + '{DATABASE_URL:?DATABASE_URL is required for DB migrations}"';
    expect(SOURCE).toContain(requiredDatabaseUrlLine);
    expect(SOURCE).not.toMatch(/exec drizzle-kit migrate/);
  });

  it('allows skipping migrations via AGENTCTL_SKIP_MIGRATIONS=1', () => {
    // Escape hatch for operators who manage schema out-of-band.
    expect(SOURCE).toMatch(/AGENTCTL_SKIP_MIGRATIONS/);
  });

  it('probes /health after pm2 reload with a bounded deadline', () => {
    // pm2 reload returns immediately; the new CP may still crash on first query.
    // Without a probe the script exits 0 and the operator thinks it succeeded.
    expect(SOURCE).toMatch(/AGENTCTL_PEER_HEALTH_URL/);
    expect(SOURCE).toMatch(/AGENTCTL_PEER_HEALTH_TIMEOUT_SEC/);
    expect(SOURCE).toMatch(/curl --silent --fail/);
    expect(SOURCE).toMatch(/deadline=/);
  });

  it('redirects post-reload output before pm2 reload so pipe closure cannot kill rollback', () => {
    const redirectSnippet = 'exec >>"$' + '{POST_RELOAD_LOG}" 2>&1';
    const redirectIdx = SOURCE.indexOf(redirectSnippet);
    const reloadIdx = SOURCE.lastIndexOf('pm2 reload');
    expect(redirectIdx).toBeGreaterThan(-1);
    expect(reloadIdx).toBeGreaterThan(-1);
    expect(redirectIdx).toBeLessThan(reloadIdx);
    expect(SOURCE).toMatch(/AGENTCTL_PEER_POST_RELOAD_LOG/);
  });

  it('rolls back git + deps + build + pm2 reload on health-probe failure', () => {
    // A git-only rollback leaves node_modules and dist/ from the new version,
    // so the rollback must reinstall and rebuild to match the reverted tree.
    const rollbackFn = /rollback\(\)\s*\{[\s\S]*?^\}/m.exec(SOURCE)?.[0] ?? '';
    expect(rollbackFn).toMatch(/git reset --hard/);
    expect(rollbackFn).toMatch(/pnpm install --frozen-lockfile/);
    expect(rollbackFn).toMatch(/pnpm build/);
    expect(rollbackFn).toMatch(/pm2 reload/);
  });

  it('invokes rollback when the health probe times out', () => {
    expect(SOURCE).toMatch(/if \[ "\$\{healthy\}" -ne 1 \]; then\s*\n\s*rollback /);
  });

  it('honours AGENTCTL_PEER_MAX_VERSION_SKEW as a skew-guard exit', () => {
    expect(SOURCE).toMatch(/AGENTCTL_PEER_MAX_VERSION_SKEW/);
    expect(SOURCE).toMatch(/exceeds AGENTCTL_PEER_MAX_VERSION_SKEW/);
  });

  it('requires AGENTCTL_PM2_ECOSYSTEM and exits 2 otherwise', () => {
    expect(SOURCE).toMatch(/if \[ -z "\$\{PM2_ECOSYSTEM\}" \][\s\S]*?exit 2/m);
  });
});
