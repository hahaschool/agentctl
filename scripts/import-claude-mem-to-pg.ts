#!/usr/bin/env npx tsx

import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import type {
  EntityType,
  FactSource,
  MemoryEdge,
  MemoryFact,
  MemoryScope,
} from '@agentctl/shared';
import { Pool } from 'pg';
import type {
  ClaudeMemDatabase,
  ClaudeMemObservation,
  ClaudeMemSessionSummary,
  ImportedFactSource,
} from './claude-mem-migration-lib.js';
import {
  assembleObservationContent,
  buildImportedSource,
  computeObservationConfidence,
  loadBetterSqlite3,
  mapObservationType,
  parseStringArray,
  resolveDbPath,
  resolveObservationScope,
} from './claude-mem-migration-lib.js';

export type ImportArgs = {
  dbPath: string;
  databaseUrl: string;
  dryRun: boolean;
  skipDedup: boolean;
  batchSize: number;
  project: string | null;
  machineId: string | null;
  checkpointFile: string;
  embeddingBaseUrl: string;
  embeddingModel: string;
};

export type ImportCheckpoint = {
  lastObservationId: number;
  lastSessionSummaryId: number;
  updatedAt: string;
};

export type ExistingImportedFact = {
  id: string;
};

export type SimilarFactMatch = {
  id: string;
  similarity: number;
};

export type ImportedFactStore = {
  addFact(input: {
    scope: MemoryScope;
    content: string;
    entity_type: EntityType;
    source: FactSource;
    confidence?: number;
  }): Promise<MemoryFact>;
  addEdge(input: {
    source_fact_id: string;
    target_fact_id: string;
    relation: 'summarizes';
    weight?: number;
  }): Promise<MemoryEdge>;
  findImportedFactBySourceKey(sourceKey: string): Promise<ExistingImportedFact | null>;
  findSimilarFact(
    scope: MemoryScope,
    content: string,
    threshold: number,
  ): Promise<SimilarFactMatch | null>;
};

export type ImportObservationOptions = {
  dryRun: boolean;
  skipDedup: boolean;
  machineId: string | null;
  projectOverride: string | null;
  sessionIdMap: Map<string, string>;
  importedAt: string;
};

export type ImportObservationResult = {
  status:
    | 'imported'
    | 'dry_run'
    | 'skipped_existing'
    | 'skipped_duplicate'
    | 'skipped_empty';
  parentScope: MemoryScope | null;
  importedChildren: number;
};

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_EMBEDDING_BASE_URL = 'http://localhost:4000';
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
const DUPLICATE_THRESHOLD = 0.92;

function createScriptLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };
}

export function parseImportArgs(argv: string[]): ImportArgs {
  const args = argv.slice(2);
  let dbPath = '';
  let databaseUrl = process.env.DATABASE_URL ?? '';
  let dryRun = false;
  let skipDedup = false;
  let batchSize = DEFAULT_BATCH_SIZE;
  let project: string | null = null;
  let machineId: string | null = null;
  let checkpointFile = '';
  let embeddingBaseUrl =
    process.env.EMBEDDING_API_URL ??
    process.env.LITELLM_PROXY_URL ??
    process.env.LITELLM_URL ??
    DEFAULT_EMBEDDING_BASE_URL;
  let embeddingModel = process.env.EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg) continue;

    if (arg === '--database-url' && args[index + 1]) {
      databaseUrl = args[index + 1] ?? databaseUrl;
      index++;
      continue;
    }
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--skip-dedup') {
      skipDedup = true;
      continue;
    }
    if (arg === '--batch-size' && args[index + 1]) {
      batchSize = Number(args[index + 1]) || DEFAULT_BATCH_SIZE;
      index++;
      continue;
    }
    if (arg === '--project' && args[index + 1]) {
      project = args[index + 1] ?? null;
      index++;
      continue;
    }
    if (arg === '--machine-id' && args[index + 1]) {
      machineId = args[index + 1] ?? null;
      index++;
      continue;
    }
    if (arg === '--checkpoint-file' && args[index + 1]) {
      checkpointFile = path.resolve(args[index + 1] ?? '');
      index++;
      continue;
    }
    if (arg === '--embedding-base-url' && args[index + 1]) {
      embeddingBaseUrl = args[index + 1] ?? embeddingBaseUrl;
      index++;
      continue;
    }
    if (arg === '--embedding-model' && args[index + 1]) {
      embeddingModel = args[index + 1] ?? embeddingModel;
      index++;
      continue;
    }

    if (!arg.startsWith('--')) {
      dbPath = arg;
    }
  }

  if (!dbPath || !databaseUrl) {
    console.error(
      'Usage: pnpm tsx scripts/import-claude-mem-to-pg.ts <path-to-claude-mem.db> --database-url <postgresql-url> [options]',
    );
    console.error('Options:');
    console.error('  --dry-run');
    console.error('  --skip-dedup');
    console.error(`  --batch-size <n>        Default: ${DEFAULT_BATCH_SIZE}`);
    console.error('  --project <name>');
    console.error('  --machine-id <id>');
    console.error('  --checkpoint-file <path>');
    console.error(`  --embedding-base-url <url>  Default: ${embeddingBaseUrl}`);
    console.error(`  --embedding-model <name>    Default: ${embeddingModel}`);
    process.exit(1);
  }

  const resolvedDbPath = resolveDbPath(dbPath);
  return {
    dbPath: resolvedDbPath,
    databaseUrl,
    dryRun,
    skipDedup,
    batchSize,
    project,
    machineId,
    checkpointFile:
      checkpointFile || path.join(path.dirname(resolvedDbPath), '.claude-mem-import-checkpoint.json'),
    embeddingBaseUrl,
    embeddingModel,
  };
}

export function shouldSkipByCheckpoint(
  table: 'observations' | 'session_summaries',
  id: number,
  checkpoint: ImportCheckpoint,
): boolean {
  if (table === 'observations') {
    return id <= checkpoint.lastObservationId;
  }
  return id <= checkpoint.lastSessionSummaryId;
}

function createInitialCheckpoint(): ImportCheckpoint {
  return {
    lastObservationId: 0,
    lastSessionSummaryId: 0,
    updatedAt: new Date(0).toISOString(),
  };
}

export function loadCheckpoint(filePath: string): ImportCheckpoint {
  if (!fs.existsSync(filePath)) {
    return createInitialCheckpoint();
  }

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<ImportCheckpoint>;
    return {
      lastObservationId: Number(raw.lastObservationId ?? 0),
      lastSessionSummaryId: Number(raw.lastSessionSummaryId ?? 0),
      updatedAt:
        typeof raw.updatedAt === 'string' ? raw.updatedAt : createInitialCheckpoint().updatedAt,
    };
  } catch {
    return createInitialCheckpoint();
  }
}

export function saveCheckpoint(filePath: string, checkpoint: ImportCheckpoint): void {
  fs.writeFileSync(filePath, JSON.stringify(checkpoint, null, 2), 'utf-8');
}

export async function importObservation(
  observation: ClaudeMemObservation,
  store: ImportedFactStore,
  options: ImportObservationOptions,
): Promise<ImportObservationResult> {
  const content = assembleObservationContent(observation);
  const parentScope = resolveObservationScope(observation, options.projectOverride);

  if (!content) {
    return { status: 'skipped_empty', parentScope: null, importedChildren: 0 };
  }

  const parentSourceKey = `observations:${observation.id}:parent`;
  const existing = await store.findImportedFactBySourceKey(parentSourceKey);
  if (existing) {
    return { status: 'skipped_existing', parentScope, importedChildren: 0 };
  }

  if (!options.skipDedup) {
    const duplicate = await store.findSimilarFact(parentScope, content, DUPLICATE_THRESHOLD);
    if (duplicate) {
      return { status: 'skipped_duplicate', parentScope, importedChildren: 0 };
    }
  }

  const sessionId = observation.memory_session_id
    ? options.sessionIdMap.get(observation.memory_session_id) ?? observation.memory_session_id
    : null;
  const parsedFacts = parseStringArray(observation.facts);
  const parsedFiles = parseStringArray(observation.files_modified);
  const confidence = computeObservationConfidence(observation);

  if (options.dryRun) {
    return {
      status: 'dry_run',
      parentScope,
      importedChildren: parsedFacts.length,
    };
  }

  const parentSource = buildImportedSource({
    sourceTable: 'observations',
    sourceId: observation.id,
    sourceKey: parentSourceKey,
    sessionId,
    memorySessionId: observation.memory_session_id,
    machineId: options.machineId,
    importedAt: options.importedAt,
    filesModified: parsedFiles,
    originalCreatedAt: observation.created_at,
  });

  const parent = await store.addFact({
    scope: parentScope,
    content,
    entity_type: mapObservationType(observation.type),
    source: parentSource,
    confidence,
  });

  let importedChildren = 0;
  for (const [index, factText] of parsedFacts.entries()) {
    const childSourceKey = `observations:${observation.id}:fact:${index}`;
    const existingChild = await store.findImportedFactBySourceKey(childSourceKey);
    if (existingChild) {
      continue;
    }

    const childSource: ImportedFactSource = buildImportedSource({
      sourceTable: 'observations',
      sourceId: observation.id,
      sourceKey: childSourceKey,
      sessionId,
      memorySessionId: observation.memory_session_id,
      machineId: options.machineId,
      importedAt: options.importedAt,
      filesModified: parsedFiles,
      originalCreatedAt: observation.created_at,
    });

    const child = await store.addFact({
      scope: parentScope,
      content: factText,
      entity_type: mapObservationType(observation.type),
      source: childSource,
      confidence: Math.max(0.6, confidence - 0.05),
    });
    await store.addEdge({
      source_fact_id: child.id,
      target_fact_id: parent.id,
      relation: 'summarizes',
      weight: 0.8,
    });
    importedChildren++;
  }

  return { status: 'imported', parentScope, importedChildren };
}

export async function importSessionSummary(
  summary: ClaudeMemSessionSummary,
  store: ImportedFactStore,
  options: Omit<ImportObservationOptions, 'projectOverride'>,
): Promise<'imported' | 'dry_run' | 'skipped_existing' | 'skipped_empty'> {
  const content = summary.summary?.trim() ?? '';
  if (!content) {
    return 'skipped_empty';
  }

  const sourceKey = `session_summaries:${summary.id}`;
  const existing = await store.findImportedFactBySourceKey(sourceKey);
  if (existing) {
    return 'skipped_existing';
  }

  if (options.dryRun) {
    return 'dry_run';
  }

  const source = buildImportedSource({
    sourceTable: 'session_summaries',
    sourceId: summary.id,
    sourceKey,
    sessionId: summary.session_id,
    memorySessionId: null,
    machineId: options.machineId,
    importedAt: options.importedAt,
    originalCreatedAt: summary.created_at,
  });

  await store.addFact({
    scope: 'global',
    content,
    entity_type: 'concept',
    source,
    confidence: 0.85,
  });

  return 'imported';
}

function readRows<T extends Record<string, unknown>>(
  db: ClaudeMemDatabase,
  table: string,
  orderClause: string,
): T[] {
  try {
    return db.prepare(`SELECT * FROM ${table} ${orderClause}`).all() as T[];
  } catch {
    return [];
  }
}

function loadSessionIdMap(db: ClaudeMemDatabase): Map<string, string> {
  const rows = readRows<Record<string, unknown>>(db, 'sdk_sessions', 'ORDER BY memory_session_id');
  return new Map(
    rows
      .map((row) => [row.memory_session_id, row.content_session_id] as const)
      .filter(
        (entry): entry is [string, string] =>
          typeof entry[0] === 'string' && entry[0].length > 0 && typeof entry[1] === 'string',
      ),
  );
}

export async function createPgImportedFactStore(params: {
  pool: Pool;
  embeddingBaseUrl: string;
  embeddingModel: string;
}): Promise<ImportedFactStore> {
  const [{ EmbeddingClient }, { MemoryStore }] = await Promise.all([
    import('../packages/control-plane/src/memory/embedding-client.js'),
    import('../packages/control-plane/src/memory/memory-store.js'),
  ]);
  const logger = createScriptLogger();
  const embeddingClient = new EmbeddingClient({
    baseUrl: params.embeddingBaseUrl,
    model: params.embeddingModel,
    logger,
  });
  const memoryStore = new MemoryStore({
    pool: params.pool,
    embeddingClient,
    logger,
  });

  return {
    addFact: (input) => memoryStore.addFact(input),
    addEdge: (input) => memoryStore.addEdge(input),
    async findImportedFactBySourceKey(sourceKey) {
      const result = await params.pool.query<{ id: string }>(
        `SELECT id
         FROM memory_facts
         WHERE source_json->>'source' = 'claude-mem'
           AND source_json->>'source_key' = $1
         LIMIT 1`,
        [sourceKey],
      );

      const row = result.rows[0];
      return row ? { id: row.id } : null;
    },
    async findSimilarFact(scope, content, threshold) {
      const embedding = await embeddingClient.embed(content);
      const embeddingLiteral = `[${embedding.join(',')}]`;
      const result = await params.pool.query<{ id: string; similarity: number }>(
        `SELECT id, (1 - (embedding <=> $2::vector))::real AS similarity
         FROM memory_facts
         WHERE scope = $1
           AND embedding IS NOT NULL
         ORDER BY embedding <=> $2::vector ASC
         LIMIT 1`,
        [scope, embeddingLiteral],
      );

      const row = result.rows[0];
      if (!row || row.similarity < threshold) {
        return null;
      }
      return { id: row.id, similarity: Number(row.similarity) };
    },
  };
}

export async function main(): Promise<void> {
  const args = parseImportArgs(process.argv);
  if (!fs.existsSync(args.dbPath)) {
    console.error(`Error: Database file not found: ${args.dbPath}`);
    process.exit(1);
  }

  const sqlite = await loadBetterSqlite3();
  const db = new sqlite.default(args.dbPath, { readonly: true });
  const pool = new Pool({ connectionString: args.databaseUrl });
  const store = await createPgImportedFactStore({
    pool,
    embeddingBaseUrl: args.embeddingBaseUrl,
    embeddingModel: args.embeddingModel,
  });
  const checkpoint = loadCheckpoint(args.checkpointFile);
  const sessionIdMap = loadSessionIdMap(db);
  const importedAt = new Date().toISOString();

  let imported = 0;
  let dryRun = 0;
  let skipped = 0;

  try {
    const observations = readRows<ClaudeMemObservation>(
      db,
      'observations',
      'ORDER BY created_at_epoch ASC, id ASC',
    );
    for (const observation of observations) {
      if (shouldSkipByCheckpoint('observations', observation.id, checkpoint)) {
        continue;
      }

      const result = await importObservation(observation, store, {
        dryRun: args.dryRun,
        skipDedup: args.skipDedup,
        machineId: args.machineId,
        projectOverride: args.project,
        sessionIdMap,
        importedAt,
      });

      if (result.status === 'imported') {
        imported++;
      } else if (result.status === 'dry_run') {
        dryRun++;
      } else {
        skipped++;
      }

      checkpoint.lastObservationId = observation.id;
      checkpoint.updatedAt = new Date().toISOString();
      saveCheckpoint(args.checkpointFile, checkpoint);
    }

    const summaries = readRows<ClaudeMemSessionSummary>(
      db,
      'session_summaries',
      'ORDER BY created_at ASC, id ASC',
    );
    for (const summary of summaries) {
      if (shouldSkipByCheckpoint('session_summaries', summary.id, checkpoint)) {
        continue;
      }

      const result = await importSessionSummary(summary, store, {
        dryRun: args.dryRun,
        skipDedup: args.skipDedup,
        machineId: args.machineId,
        sessionIdMap,
        importedAt,
      });

      if (result === 'imported') {
        imported++;
      } else if (result === 'dry_run') {
        dryRun++;
      } else {
        skipped++;
      }

      checkpoint.lastSessionSummaryId = summary.id;
      checkpoint.updatedAt = new Date().toISOString();
      saveCheckpoint(args.checkpointFile, checkpoint);
    }

    console.log(`Import complete. imported=${imported} dryRun=${dryRun} skipped=${skipped}`);
    console.log(`Checkpoint: ${args.checkpointFile}`);
    console.log(`Batch size setting: ${args.batchSize}`);
  } finally {
    db.close();
    await pool.end();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  void main();
}
