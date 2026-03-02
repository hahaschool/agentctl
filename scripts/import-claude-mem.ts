#!/usr/bin/env npx tsx

/**
 * Import claude-mem SQLite data into Mem0.
 *
 * Usage:
 *   pnpm tsx scripts/import-claude-mem.ts <path-to-claude-mem.db> [--mem0-url http://localhost:8000]
 *
 * Reads the claude-mem SQLite database tables:
 *   - observations: individual facts extracted from conversations
 *   - session_summaries: summaries of entire sessions
 *
 * Each record is posted to Mem0 with userId='system' and source metadata.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

type Database = {
  prepare(sql: string): { all(): Record<string, unknown>[] };
  close(): void;
};

type BetterSqlite3Module = {
  default: new (path: string, options?: { readonly?: boolean }) => Database;
};

type Observation = {
  id: number;
  content: string;
  obs_type: string;
  subject: string | null;
  tags: string | null;
  created_at: string;
  session_id: string | null;
};

type SessionSummary = {
  id: number;
  session_id: string;
  summary: string;
  created_at: string;
};

function parseArgs(argv: string[]): { dbPath: string; mem0Url: string } {
  const args = argv.slice(2);
  let dbPath = '';
  let mem0Url = 'http://localhost:8000';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mem0-url' && i + 1 < args.length) {
      mem0Url = args[i + 1] ?? mem0Url;
      i++;
    } else if (!args[i]?.startsWith('--')) {
      dbPath = args[i] ?? '';
    }
  }

  if (!dbPath) {
    console.error(
      'Usage: pnpm tsx scripts/import-claude-mem.ts <path-to-claude-mem.db> [--mem0-url URL]',
    );
    console.error('');
    console.error('Arguments:');
    console.error('  <path>       Path to the claude-mem SQLite database');
    console.error('  --mem0-url   Mem0 API base URL (default: http://localhost:8000)');
    process.exit(1);
  }

  return { dbPath: path.resolve(dbPath), mem0Url };
}

async function loadBetterSqlite3(): Promise<BetterSqlite3Module> {
  try {
    return (await import('better-sqlite3')) as unknown as BetterSqlite3Module;
  } catch {
    console.error('Error: better-sqlite3 is not installed.');
    console.error('');
    console.error('Install it with:');
    console.error('  pnpm add -D better-sqlite3 @types/better-sqlite3');
    console.error('');
    console.error('Or from the monorepo root:');
    console.error('  pnpm add -Dw better-sqlite3 @types/better-sqlite3');
    process.exit(1);
  }
}

async function addMemory(
  mem0Url: string,
  messages: Array<{ role: string; content: string }>,
  metadata: Record<string, unknown>,
): Promise<boolean> {
  const url = `${mem0Url.replace(/\/+$/, '')}/v1/memories/`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        user_id: 'system',
        metadata,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '<unreadable>');
      console.error(`  Mem0 API error (${response.status}): ${body.slice(0, 200)}`);
      return false;
    }

    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  Connection error: ${message}`);
    return false;
  }
}

async function importObservations(
  db: Database,
  mem0Url: string,
): Promise<{ imported: number; total: number; failed: number }> {
  let rows: Record<string, unknown>[];
  try {
    rows = db.prepare('SELECT * FROM observations ORDER BY created_at').all();
  } catch {
    console.warn('Warning: "observations" table not found or unreadable. Skipping.');
    return { imported: 0, total: 0, failed: 0 };
  }

  const total = rows.length;
  let imported = 0;
  let failed = 0;

  console.log(`Found ${total} observations to import.`);

  for (const row of rows) {
    const obs = row as unknown as Observation;
    const content = obs.content || '';
    if (!content.trim()) {
      continue;
    }

    const metadata: Record<string, unknown> = {
      source: 'claude-mem',
      sourceTable: 'observations',
      sourceId: obs.id,
      obsType: obs.obs_type || 'unknown',
      importedAt: new Date().toISOString(),
    };

    if (obs.subject) metadata.subject = obs.subject;
    if (obs.tags) metadata.tags = obs.tags;
    if (obs.session_id) metadata.sessionId = obs.session_id;
    if (obs.created_at) metadata.originalCreatedAt = obs.created_at;

    const success = await addMemory(mem0Url, [{ role: 'assistant', content }], metadata);

    if (success) {
      imported++;
    } else {
      failed++;
    }

    // Print progress every 50 records
    if ((imported + failed) % 50 === 0 || imported + failed === total) {
      process.stdout.write(
        `\r  Progress: ${imported + failed}/${total} (${imported} imported, ${failed} failed)`,
      );
    }
  }

  console.log(''); // newline after progress
  return { imported, total, failed };
}

async function importSessionSummaries(
  db: Database,
  mem0Url: string,
): Promise<{ imported: number; total: number; failed: number }> {
  let rows: Record<string, unknown>[];
  try {
    rows = db.prepare('SELECT * FROM session_summaries ORDER BY created_at').all();
  } catch {
    console.warn('Warning: "session_summaries" table not found or unreadable. Skipping.');
    return { imported: 0, total: 0, failed: 0 };
  }

  const total = rows.length;
  let imported = 0;
  let failed = 0;

  console.log(`Found ${total} session summaries to import.`);

  for (const row of rows) {
    const summary = row as unknown as SessionSummary;
    const content = summary.summary || '';
    if (!content.trim()) {
      continue;
    }

    const metadata: Record<string, unknown> = {
      source: 'claude-mem',
      sourceTable: 'session_summaries',
      sourceId: summary.id,
      sessionId: summary.session_id,
      importedAt: new Date().toISOString(),
    };

    if (summary.created_at) metadata.originalCreatedAt = summary.created_at;

    const success = await addMemory(
      mem0Url,
      [{ role: 'assistant', content: `Session summary: ${content}` }],
      metadata,
    );

    if (success) {
      imported++;
    } else {
      failed++;
    }

    if ((imported + failed) % 50 === 0 || imported + failed === total) {
      process.stdout.write(
        `\r  Progress: ${imported + failed}/${total} (${imported} imported, ${failed} failed)`,
      );
    }
  }

  console.log(''); // newline after progress
  return { imported, total, failed };
}

async function main(): Promise<void> {
  const { dbPath, mem0Url } = parseArgs(process.argv);

  if (!fs.existsSync(dbPath)) {
    console.error(`Error: Database file not found: ${dbPath}`);
    process.exit(1);
  }

  console.log(`Importing from: ${dbPath}`);
  console.log(`Mem0 URL:       ${mem0Url}`);
  console.log('');

  // Verify Mem0 is reachable
  try {
    const healthResponse = await fetch(`${mem0Url.replace(/\/+$/, '')}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!healthResponse.ok) {
      console.error(
        `Warning: Mem0 health check returned ${healthResponse.status}. Proceeding anyway.`,
      );
    } else {
      console.log('Mem0 health check: OK');
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: Cannot reach Mem0 at ${mem0Url}: ${message}`);
    console.error('Make sure Mem0 is running (e.g., docker run -p 8000:8000 mem0/mem0:latest)');
    process.exit(1);
  }

  const betterSqlite3 = await loadBetterSqlite3();
  const db = new betterSqlite3.default(dbPath, { readonly: true });

  try {
    console.log('');
    console.log('--- Importing observations ---');
    const obsResult = await importObservations(db, mem0Url);

    console.log('');
    console.log('--- Importing session summaries ---');
    const summaryResult = await importSessionSummaries(db, mem0Url);

    console.log('');
    console.log('=== Import complete ===');
    console.log(
      `Observations:      ${obsResult.imported}/${obsResult.total} imported (${obsResult.failed} failed)`,
    );
    console.log(
      `Session summaries: ${summaryResult.imported}/${summaryResult.total} imported (${summaryResult.failed} failed)`,
    );

    const totalFailed = obsResult.failed + summaryResult.failed;
    if (totalFailed > 0) {
      console.warn(
        `\nWarning: ${totalFailed} record(s) failed to import. Check the output above for details.`,
      );
      process.exit(2);
    }
  } finally {
    db.close();
  }
}

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
