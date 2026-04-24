import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type {
  EntityType,
  FactSource,
  ImportJob,
  ImportJobSource,
  ImportPreview,
} from '@agentctl/shared';
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';
import type { Pool } from 'pg';

import { readRateLimitEnv } from '../rate-limit.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MEMORY_IMPORT_RATE_LIMIT = {
  max: 20,
  timeWindow: 60_000,
} as const;

const BATCH_SIZE = 200;

const JSONL_MAX_FILES = 1000;
const JSONL_SAMPLE_LIMIT = 5;
const JSONL_MAX_FILE_BYTES = 5 * 1024 * 1024;

const OBSERVATION_TYPE_TO_ENTITY: Record<string, EntityType> = {
  decision: 'decision',
  bugfix: 'error',
  feature: 'code_artifact',
  refactor: 'pattern',
  discovery: 'concept',
  change: 'code_artifact',
};

// ---------------------------------------------------------------------------
// SQLite row type (from claude-mem observations table)
// ---------------------------------------------------------------------------

type ObservationRow = {
  id: number;
  memory_session_id: string;
  project: string;
  text: string | null;
  type: string;
  title: string | null;
  subtitle: string | null;
  facts: string | null;
  narrative: string | null;
  concepts: string | null;
  files_read: string | null;
  files_modified: string | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function expandTilde(p: string): string {
  if (p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

function generateImportId(): string {
  const timestamp = Date.now().toString(36).padStart(10, '0');
  const random = Array.from({ length: 16 }, () => Math.floor(Math.random() * 36).toString(36)).join(
    '',
  );
  return `mf_${timestamp}${random}`;
}

function buildFactContent(row: ObservationRow): string {
  const parts: string[] = [];
  if (row.title) parts.push(row.title);
  if (row.narrative) parts.push(row.narrative);
  else if (row.text) parts.push(row.text);
  return parts.join('\n\n');
}

function buildTags(row: ObservationRow): string[] {
  const tags: string[] = [`import:claude-mem`, `obs-type:${row.type}`];
  if (row.project) tags.push(`project:${row.project}`);
  if (row.concepts) {
    try {
      const parsed = JSON.parse(row.concepts) as string[];
      if (Array.isArray(parsed)) {
        for (const c of parsed.slice(0, 10)) {
          tags.push(c);
        }
      }
    } catch {
      // not JSON, skip
    }
  }
  return tags;
}

function buildSource(row: ObservationRow): FactSource {
  return {
    session_id: row.memory_session_id,
    agent_id: null,
    machine_id: null,
    turn_index: null,
    extraction_method: 'import',
    import_source_id: `claude-mem:${row.id}`,
  };
}

function mapEntityType(obsType: string): EntityType {
  return OBSERVATION_TYPE_TO_ENTITY[obsType] ?? 'concept';
}

// ---------------------------------------------------------------------------
// JSONL history helpers
// ---------------------------------------------------------------------------

type JsonlMessage = {
  type?: string;
  message?: {
    role?: string;
    content?: string | Array<{ type: string; text?: string }>;
  };
  sessionId?: string;
};

type JsonlContentPreview = {
  sessionId: string;
  importSourceId: string;
  firstContent: string;
};

function walkJsonlFiles(dir: string, cap: number): string[] {
  const files: string[] = [];

  function walk(current: string): void {
    if (files.length >= cap) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= cap) break;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(fullPath);
      }
    }
  }

  walk(dir);
  return files;
}

function buildJsonlSessionId(filePath: string): string {
  return path.basename(filePath, '.jsonl');
}

function buildJsonlImportSourceId(sessionId: string): string {
  return `jsonl-history:${sessionId}`;
}

function readBoundedJsonlFile(filePath: string): string | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > JSONL_MAX_FILE_BYTES) return null;
    if (stat.size === 0) return '';

    const buffer = Buffer.allocUnsafe(Math.min(stat.size, JSONL_MAX_FILE_BYTES));
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString('utf-8');
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // best-effort close
      }
    }
  }
}

function extractJsonlContentPreview(filePath: string): JsonlContentPreview {
  const sessionId = buildJsonlSessionId(filePath);
  const importSourceId = buildJsonlImportSourceId(sessionId);
  const content = readBoundedJsonlFile(filePath);
  if (content === null) {
    return { sessionId, importSourceId, firstContent: '' };
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: JsonlMessage;
    try {
      parsed = JSON.parse(trimmed) as JsonlMessage;
    } catch {
      continue;
    }
    const role =
      parsed.type === 'human'
        ? 'user'
        : parsed.type === 'assistant'
          ? 'assistant'
          : parsed.message?.role;
    if (role !== 'user') continue;
    const msg = parsed.message;
    if (!msg) continue;
    let text = '';
    if (typeof msg.content === 'string') {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      text = msg.content
        .filter((b) => b.type === 'text' && b.text)
        .map((b) => b.text ?? '')
        .join('\n');
    }
    if (text.trim()) {
      return {
        sessionId,
        importSourceId,
        firstContent: text.trim().slice(0, 500),
      };
    }
  }

  return { sessionId, importSourceId, firstContent: '' };
}

async function loadExistingImportSourceIds(
  pool: Pool | null,
  importSourceIds: string[],
): Promise<Set<string>> {
  if (!pool || importSourceIds.length === 0) return new Set();

  const result = await pool.query<{ src_id: string }>(
    `SELECT source_json->>'import_source_id' AS src_id
     FROM memory_facts
     WHERE source_json->>'import_source_id' = ANY($1::text[])`,
    [importSourceIds],
  );
  return new Set(result.rows.map((r) => r.src_id).filter(Boolean));
}

async function runJsonlImport(pool: Pool, dirPath: string, jobId: string): Promise<void> {
  const allFiles = walkJsonlFiles(dirPath, JSONL_MAX_FILES + 1);
  if (allFiles.length > JSONL_MAX_FILES) {
    if (activeJob?.id === jobId) {
      activeJob = updateJobStatus(activeJob, {
        status: 'failed',
        errors: 1,
        completedAt: new Date().toISOString(),
      });
    }
    return;
  }

  const total = allFiles.length;
  const importSourceIds = allFiles.map((filePath) =>
    buildJsonlImportSourceId(buildJsonlSessionId(filePath)),
  );
  const existingIds = await loadExistingImportSourceIds(pool, importSourceIds);

  if (activeJob?.id === jobId) {
    activeJob = updateJobStatus(activeJob, { progress: { current: 0, total } });
  }

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < allFiles.length; i++) {
    if (cancelRequested || !activeJob || activeJob.id !== jobId) break;

    const filePath = allFiles[i] as string;
    const contentPreview = extractJsonlContentPreview(filePath);
    const { sessionId, importSourceId, firstContent } = contentPreview;

    if (existingIds.has(importSourceId) || !firstContent) {
      skipped++;
    } else {
      const id = generateImportId();
      const source: FactSource = {
        session_id: sessionId,
        agent_id: null,
        machine_id: null,
        turn_index: null,
        extraction_method: 'import',
        import_source_id: importSourceId,
      };
      try {
        const result = await pool.query(
          `INSERT INTO memory_facts (
             id, scope, content, content_model, entity_type,
             confidence, strength, source_json, valid_from, created_at, accessed_at,
             tags
           )
           SELECT
             $1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW(), NOW(), NOW(),
             $9::text[]
           WHERE NOT EXISTS (
             SELECT 1 FROM memory_facts
             WHERE source_json->>'import_source_id' = $10
           )`,
          [
            id,
            'global',
            firstContent,
            'none',
            'concept' as EntityType,
            0.6,
            1.0,
            source,
            [`import:jsonl-history`, `session:${sessionId}`],
            importSourceId,
          ],
        );
        if ((result.rowCount ?? 0) > 0) {
          imported++;
          existingIds.add(importSourceId);
        } else {
          skipped++;
        }
      } catch {
        errors++;
      }
    }

    if (activeJob?.id === jobId) {
      activeJob = updateJobStatus(activeJob, {
        progress: { current: i + 1, total },
        imported,
        skipped,
        errors,
      });
    }
  }

  if (activeJob?.id === jobId && activeJob.status === 'running') {
    activeJob = updateJobStatus(activeJob, {
      status: 'completed',
      progress: { current: total, total },
      imported,
      skipped,
      errors,
      completedAt: new Date().toISOString(),
    });
  }
}

// ---------------------------------------------------------------------------
// In-memory singleton job state (one active job at a time)
// ---------------------------------------------------------------------------

let activeJob: ImportJob | null = null;
let cancelRequested = false;

function createJob(source: ImportJobSource, total: number): ImportJob {
  return {
    id: `import-${Date.now()}`,
    source,
    status: 'running',
    progress: { current: 0, total },
    imported: 0,
    skipped: 0,
    errors: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
  };
}

function updateJobStatus(job: ImportJob, updates: Partial<ImportJob>): ImportJob {
  return { ...job, ...updates };
}

/** Reset active job — exported for test isolation only. */
export function resetActiveJobForTest(): void {
  activeJob = null;
  cancelRequested = false;
}

// ---------------------------------------------------------------------------
// SQLite access (lazy import to keep module loadable without better-sqlite3)
// ---------------------------------------------------------------------------

type SqliteDb = {
  prepare(sql: string): {
    all(...params: unknown[]): Record<string, unknown>[];
    get(...params: unknown[]): Record<string, unknown> | undefined;
  };
  close(): void;
};

async function openSqlite(dbPath: string): Promise<SqliteDb> {
  // Dynamic import so module loads even if better-sqlite3 isn't available at parse time
  const BetterSqlite3 = (await import('better-sqlite3')).default;
  return new BetterSqlite3(dbPath, { readonly: true }) as unknown as SqliteDb;
}

// ---------------------------------------------------------------------------
// Import engine
// ---------------------------------------------------------------------------

async function runImport(pool: Pool, dbPath: string, jobId: string): Promise<void> {
  let sqliteDb: SqliteDb | null = null;
  try {
    sqliteDb = await openSqlite(dbPath);

    const totalRow = sqliteDb.prepare('SELECT COUNT(*) as cnt FROM observations').get();
    const total = (totalRow?.cnt as number) ?? 0;
    if (activeJob?.id === jobId) {
      activeJob = updateJobStatus(activeJob, { progress: { current: 0, total } });
    }

    // Fetch existing import_source_ids to skip duplicates
    const existingResult = await pool.query<{ src_id: string }>(
      `SELECT source_json->>'import_source_id' AS src_id
       FROM memory_facts
       WHERE source_json->>'import_source_id' LIKE 'claude-mem:%'`,
    );
    const existingIds = new Set(existingResult.rows.map((r) => r.src_id));

    let offset = 0;
    let imported = 0;
    let skipped = 0;
    let errors = 0;

    while (true) {
      if (cancelRequested || !activeJob || activeJob.id !== jobId) break;

      const rows = sqliteDb
        .prepare('SELECT * FROM observations ORDER BY id ASC LIMIT ? OFFSET ?')
        .all(BATCH_SIZE, offset) as ObservationRow[];

      if (rows.length === 0) break;

      for (const row of rows) {
        if (cancelRequested) break;

        const sourceId = `claude-mem:${row.id}`;
        if (existingIds.has(sourceId)) {
          skipped++;
          continue;
        }

        const content = buildFactContent(row);
        if (!content.trim()) {
          skipped++;
          continue;
        }

        const id = generateImportId();
        const tags = buildTags(row);
        const source = buildSource(row);
        const entityType = mapEntityType(row.type);
        const createdAt = row.created_at;

        try {
          await pool.query(
            `INSERT INTO memory_facts (
               id, scope, content, content_model, entity_type,
               confidence, strength, source_json, valid_from, created_at, accessed_at,
               tags
             ) VALUES (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $9,
               $10
             )`,
            [
              id,
              `project:${row.project}` as const,
              content,
              'none',
              entityType,
              0.7,
              1.0,
              source,
              createdAt,
              tags,
            ],
          );
          imported++;
          existingIds.add(sourceId);
        } catch {
          errors++;
        }
      }

      offset += rows.length;

      // Update progress
      if (activeJob?.id === jobId) {
        activeJob = updateJobStatus(activeJob, {
          progress: { current: offset, total },
          imported,
          skipped,
          errors,
        });
      }
    }

    // Finalize
    if (activeJob?.id === jobId && activeJob.status === 'running') {
      activeJob = updateJobStatus(activeJob, {
        status: 'completed',
        progress: { current: total, total },
        imported,
        skipped,
        errors,
        completedAt: new Date().toISOString(),
      });
    }
  } catch (err: unknown) {
    if (activeJob?.id === jobId) {
      activeJob = updateJobStatus(activeJob, {
        status: 'failed',
        errors: (activeJob.errors ?? 0) + 1,
        completedAt: new Date().toISOString(),
      });
    }
    throw err;
  } finally {
    sqliteDb?.close();
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

type StartImportBody = {
  source: ImportJobSource;
  dbPath: string;
};

type PreviewBody = {
  source: ImportJobSource;
  dbPath: string;
};

export type MemoryImportRouteOptions = {
  pool?: Pool;
};

export const memoryImportRoutes: FastifyPluginAsync<MemoryImportRouteOptions> = async (
  app,
  opts,
) => {
  const pool = opts.pool ?? null;

  const memoryImportRateLimitMax = readRateLimitEnv(
    'MEMORY_IMPORT_RATE_LIMIT_MAX',
    MEMORY_IMPORT_RATE_LIMIT.max,
  );
  const memoryImportRateLimitWindowMs = readRateLimitEnv(
    'MEMORY_IMPORT_RATE_LIMIT_WINDOW_MS',
    MEMORY_IMPORT_RATE_LIMIT.timeWindow,
  );
  const memoryImportRateLimitError = () => ({
    statusCode: 429,
    error: 'RATE_LIMITED',
    message: 'Too many memory import requests',
  });
  const memoryImportFastifyRateLimit = {
    max: memoryImportRateLimitMax,
    timeWindow: memoryImportRateLimitWindowMs,
    errorResponseBuilder: memoryImportRateLimitError,
  } as const;

  await app.register(rateLimit, {
    global: false,
    keyGenerator: (request) =>
      request.ip ??
      (typeof request.headers['x-forwarded-for'] === 'string'
        ? request.headers['x-forwarded-for']
        : 'unknown'),
    errorResponseBuilder: memoryImportRateLimitError,
  });

  /** POST /api/memory/import/preview — validate path and return stats */
  app.post<{ Body: PreviewBody }>('/import/preview', {
    schema: {
      body: {
        type: 'object',
        required: ['source', 'dbPath'],
        properties: {
          source: { type: 'string', enum: ['claude-mem', 'jsonl-history'] },
          dbPath: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { source, dbPath } = request.body;

      if (source === 'jsonl-history') {
        const resolved = expandTilde(dbPath);
        if (!fs.existsSync(resolved)) {
          return reply.status(400).send({ ok: false, error: `Directory not found: ${dbPath}` });
        }
        const stat = fs.statSync(resolved);
        if (!stat.isDirectory()) {
          return reply.status(400).send({ ok: false, error: `Path is not a directory: ${dbPath}` });
        }

        const files = walkJsonlFiles(resolved, JSONL_MAX_FILES + 1);
        if (files.length > JSONL_MAX_FILES) {
          return reply.status(400).send({
            ok: false,
            error: `Too many JSONL files (${files.length}). Maximum is ${JSONL_MAX_FILES}.`,
          });
        }

        const previews = files.map((f) => extractJsonlContentPreview(f));
        const importable = previews.filter((p) => p.firstContent);
        const existingIds = await loadExistingImportSourceIds(
          pool,
          importable.map((p) => p.importSourceId),
        );
        const alreadyImported = importable.filter((p) => existingIds.has(p.importSourceId)).length;
        const sample = importable.slice(0, JSONL_SAMPLE_LIMIT).map((p) => `${p.sessionId}.jsonl`);
        const preview: ImportPreview = {
          totalObservations: files.length,
          byType: { 'jsonl-session': importable.length },
          alreadyImported,
          newToImport: Math.max(0, importable.length - alreadyImported),
          sampleTitles: sample,
        };

        return reply.send({ ok: true, preview });
      }

      if (source !== 'claude-mem') {
        return reply
          .status(400)
          .send({ ok: false, error: 'Only claude-mem imports are supported currently' });
      }

      const resolved = expandTilde(dbPath);
      if (!fs.existsSync(resolved)) {
        return reply.status(400).send({ ok: false, error: `File not found: ${dbPath}` });
      }

      let sqliteDb: SqliteDb | null = null;
      try {
        sqliteDb = await openSqlite(resolved);

        const totalRow = sqliteDb.prepare('SELECT COUNT(*) as cnt FROM observations').get();
        const totalObservations = (totalRow?.cnt as number) ?? 0;

        // Count observations with importable content (non-empty title or narrative or text)
        const importableRow = sqliteDb
          .prepare(
            `SELECT COUNT(*) as cnt FROM observations
             WHERE COALESCE(TRIM(title), '') != '' OR COALESCE(TRIM(narrative), '') != '' OR COALESCE(TRIM(text), '') != ''`,
          )
          .get();
        const importableCount = (importableRow?.cnt as number) ?? 0;

        const typeRows = sqliteDb
          .prepare('SELECT type, COUNT(*) as cnt FROM observations GROUP BY type ORDER BY cnt DESC')
          .all() as Array<{ type: string; cnt: number }>;
        const byType: Record<string, number> = {};
        for (const r of typeRows) {
          byType[r.type] = r.cnt;
        }

        const sampleRows = sqliteDb
          .prepare(
            'SELECT title FROM observations WHERE title IS NOT NULL ORDER BY id DESC LIMIT 5',
          )
          .all() as Array<{ title: string }>;
        const sampleTitles = sampleRows.map((r) => r.title);

        // Count already-imported if pool is available
        let alreadyImported = 0;
        if (pool) {
          const result = await pool.query<{ cnt: string }>(
            `SELECT COUNT(*) as cnt FROM memory_facts
             WHERE source_json->>'import_source_id' LIKE 'claude-mem:%'`,
          );
          alreadyImported = Number.parseInt(result.rows[0]?.cnt ?? '0', 10);
        }

        const preview: ImportPreview = {
          totalObservations,
          byType,
          alreadyImported,
          newToImport: Math.max(0, importableCount - alreadyImported),
          sampleTitles,
        };

        return reply.send({ ok: true, preview });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error reading database';
        return reply.status(400).send({ ok: false, error: message });
      } finally {
        sqliteDb?.close();
      }
    },
  });

  /** POST /api/memory/import — start a new import job */
  app.post<{ Body: StartImportBody }>('/import', {
    schema: {
      body: {
        type: 'object',
        required: ['source', 'dbPath'],
        properties: {
          source: { type: 'string', enum: ['claude-mem', 'jsonl-history'] },
          dbPath: { type: 'string' },
        },
      },
    },
    config: { rateLimit: memoryImportFastifyRateLimit },
    preHandler: [app.rateLimit(memoryImportFastifyRateLimit)],
    handler: async (request, reply) => {
      if (activeJob && activeJob.status === 'running') {
        return reply.status(409).send({ ok: false, error: 'An import job is already running' });
      }
      const { source, dbPath } = request.body;

      if (!pool) {
        return reply.status(503).send({ ok: false, error: 'Database not configured for imports' });
      }

      if (source === 'jsonl-history') {
        const resolved = expandTilde(dbPath);
        if (!fs.existsSync(resolved)) {
          return reply.status(400).send({ ok: false, error: `Directory not found: ${dbPath}` });
        }
        const stat = fs.statSync(resolved);
        if (!stat.isDirectory()) {
          return reply.status(400).send({ ok: false, error: `Path is not a directory: ${dbPath}` });
        }

        // Check file count before starting
        const probe = walkJsonlFiles(resolved, JSONL_MAX_FILES + 1);
        if (probe.length > JSONL_MAX_FILES) {
          return reply.status(400).send({
            ok: false,
            error: `Too many JSONL files (${probe.length}). Maximum is ${JSONL_MAX_FILES}.`,
          });
        }

        cancelRequested = false;
        activeJob = createJob(source, 0);
        const jobId = activeJob.id;

        runJsonlImport(pool, resolved, jobId).catch((err) => {
          app.log.error({ err, jobId }, 'JSONL import job failed');
        });

        return reply.status(202).send({ ok: true, job: activeJob });
      }

      if (source !== 'claude-mem') {
        return reply
          .status(400)
          .send({ ok: false, error: 'Only claude-mem imports are supported currently' });
      }

      const resolved = expandTilde(dbPath);
      if (!fs.existsSync(resolved)) {
        return reply.status(400).send({ ok: false, error: `File not found: ${dbPath}` });
      }

      cancelRequested = false;
      activeJob = createJob(source, 0);
      const jobId = activeJob.id;

      // Run import in background (don't await)
      runImport(pool, resolved, jobId).catch((err) => {
        app.log.error({ err, jobId }, 'Import job failed');
      });

      return reply.status(202).send({ ok: true, job: activeJob });
    },
  });

  /** GET /api/memory/import/status — poll the active job */
  app.get('/import/status', {
    handler: async (_request, reply) => {
      if (!activeJob) {
        return reply.status(404).send({ ok: false, error: 'No active import job' });
      }
      return reply.send({ ok: true, job: activeJob });
    },
  });

  /** DELETE /api/memory/import/:id — cancel a running import */
  app.delete<{ Params: { id: string } }>('/import/:id', {
    config: { rateLimit: memoryImportFastifyRateLimit },
    preHandler: [app.rateLimit(memoryImportFastifyRateLimit)],
    handler: async (request, reply) => {
      const { id } = request.params;
      if (!activeJob || activeJob.id !== id) {
        return reply.status(404).send({ ok: false, error: 'Import job not found' });
      }
      cancelRequested = true;
      activeJob = updateJobStatus(activeJob, {
        status: 'cancelled',
        completedAt: new Date().toISOString(),
      });
      return reply.send({ ok: true, job: activeJob });
    },
  });
};
