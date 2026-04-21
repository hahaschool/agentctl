import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { pathToFileURL } from 'node:url';

import type {
  EntityType,
  FactSource,
  MemoryDrawer,
  MemoryDrawerBackfillSourceType,
  MemoryDrawerBackfillState,
  MemoryFact,
  MemoryScope,
} from '@agentctl/shared';
import pg from 'pg';

import { sanitizeMemoryDrawerContent } from '../packages/control-plane/src/memory/memory-drawer-sanitizer.js';
import { EmbeddingClient } from '../packages/control-plane/src/memory/embedding-client.js';
import type {
  WriteMemoryDrawerSourceInput,
  WriteMemoryDrawerSourceResult,
} from '../packages/control-plane/src/memory/memory-drawer-types.js';
import {
  MEMORY_EMBEDDING_MODEL,
  MEMORY_EMBEDDING_VERSION,
} from '../packages/shared/src/memory/constants.js';
import type {
  ClaudeMemDatabase,
  ClaudeMemObservation,
  ClaudeMemSessionSummary,
} from './claude-mem-migration-lib.js';
import {
  assembleObservationContent,
  buildImportedSource,
  computeObservationConfidence,
  loadBetterSqlite3,
  mapObservationType,
  parseStringArray,
  resolveDbPath,
} from './claude-mem-migration-lib.js';

type JsonObject = Record<string, unknown>;
type BackfillEnv = Record<string, string | undefined>;

export type BackfillLogger = {
  info?: (value: unknown, message?: string) => void;
  warn?: (value: unknown, message?: string) => void;
  error?: (value: unknown, message?: string) => void;
};

export type BackfillMemoryDrawersCliOptions = {
  sourceType: MemoryDrawerBackfillSourceType;
  sourceRoot: string;
  databaseUrl?: string;
  dryRun: boolean;
  json: boolean;
  scope: MemoryScope;
  topic: string;
  limit?: number;
  machineId?: string;
  embeddingUsdPer1MTokens: number;
};

export type DrawerStoreLike = {
  writeSource(input: WriteMemoryDrawerSourceInput): Promise<WriteMemoryDrawerSourceResult>;
};

export type AddFactSourceSpan = {
  drawerId: string;
  startOffset: number;
  endOffset: number;
  sourceJson?: Record<string, unknown>;
};

export type AddFactLikeInput = {
  scope: MemoryScope;
  content: string;
  embedding?: number[] | null;
  entity_type: EntityType;
  source: FactSource;
  confidence?: number;
  sourceSpans?: AddFactSourceSpan[];
};

export type MemoryStoreLike = {
  addFact(input: AddFactLikeInput): Promise<MemoryFact>;
  findFactBySourceKey(sourceKey: string): Promise<{ id: string } | null>;
  addFactSourceSpans?(factId: string, spans: AddFactSourceSpan[]): Promise<void>;
  backfillFactEmbedding?(input: {
    factId: string;
    content: string;
    embedding?: number[] | null;
  }): Promise<boolean>;
};

export type BackfillStateStoreLike = {
  startOrResume(input: {
    sourceType: MemoryDrawerBackfillSourceType;
    sourceRoot: string;
    cursorJson?: Record<string, unknown>;
  }): Promise<MemoryDrawerBackfillState>;
  updateCursor(
    stateId: string,
    cursorJson: Record<string, unknown>,
  ): Promise<MemoryDrawerBackfillState>;
  markPaused?(stateId: string): Promise<MemoryDrawerBackfillState>;
  markComplete(stateId: string): Promise<MemoryDrawerBackfillState>;
  markFailed(stateId: string, error: unknown): Promise<MemoryDrawerBackfillState>;
};

export type BackfillMemoryDrawersOptions = {
  sourceType?: MemoryDrawerBackfillSourceType;
  sourceRoot: string;
  dryRun: boolean;
  claudeMemDb?: ClaudeMemDatabase;
  drawerStore?: DrawerStoreLike;
  stateStore?: BackfillStateStoreLike;
  memoryStore?: MemoryStoreLike;
  factEmbeddingClient?: Pick<EmbeddingClient, 'embedBatch'>;
  machineId?: string | null;
  logger?: BackfillLogger;
  scope?: MemoryScope;
  topic?: string;
  limit?: number;
  embeddingUsdPer1MTokens?: number;
};

export type BackfillMemoryDrawersResult = {
  sourceType: MemoryDrawerBackfillSourceType;
  dryRun: boolean;
  sourceRoot: string;
  filesDiscovered: number;
  filesSeen: number;
  linesSeen: number;
  candidates: number;
  sanitizedCandidates: number;
  redactionCount: number;
  written: number;
  skipped: number;
  parseErrors: number;
  claudeMemObservationsSeen: number;
  claudeMemSessionSummariesSeen: number;
  factCandidates: number;
  factsWritten: number;
  factsSkipped: number;
  sessionSummaryFactCandidates: number;
  sessionSummaryFactsWritten: number;
  sessionSummaryFactsSkipped: number;
  estimatedDrawerChunks: number;
  estimatedEmbeddingTokens: number;
  estimatedEmbeddingCostUsd: number;
  estimatedStorageBytes: number;
  lastCursor: BackfillCursor | null;
};

type JsonlBackfillCursor = {
  filePath: string;
  line: number;
  byteOffset: number;
};

type ClaudeMemBackfillCursor = {
  table: 'observations' | 'session_summaries';
  id: number;
};

type BackfillCursor = JsonlBackfillCursor | ClaudeMemBackfillCursor;

type ParsedCursor = {
  filePath: string | null;
  line: number;
};

type JsonlCandidate = {
  content: string;
  sourceJson: Record<string, unknown>;
};

type ClaudeMemDrawerCandidate = {
  content: string;
  sourceType: WriteMemoryDrawerSourceInput['sourceType'];
  sourceId: string;
  sourceUri: string;
  sourceJson: Record<string, unknown>;
  sessionId?: string | null;
};

type StreamLine = {
  line: string;
  lineNumber: number;
  byteOffset: number;
};

const DEFAULT_SCOPE: MemoryScope = 'global';
const DEFAULT_TOPIC = 'claude-code-jsonl';
const DEFAULT_CURSOR_LINE = 1;
const DEFAULT_EMBEDDING_USD_PER_1M_TOKENS = 0.02;
const DEFAULT_EMBEDDING_BATCH_SIZE = 16;
const DEFAULT_EMBEDDING_MAX_ATTEMPTS = 4;
const DEFAULT_EMBEDDING_RETRY_BASE_DELAY_MS = 750;
const ESTIMATED_CHUNK_TARGET_CHARS = 1_200;
const VECTOR_AND_INDEX_BYTES_PER_DRAWER = 6 * 1024;
const POSTGRES_ROW_OVERHEAD_BYTES_PER_DRAWER = 512;
const EMBEDDING_BASE_URL_ENV_KEYS = [
  'EMBEDDING_API_URL',
  'LITELLM_PROXY_URL',
  'LITELLM_URL',
] as const;

function usage(): string {
  return `Usage: pnpm memory:backfill-drawers --source-root <path> [--dry-run|--execute] [options]

Backfills MemoryDrawer rows from Claude Code JSONL text entries or claude-mem SQLite rows.
Default mode is --dry-run. Use --execute with DATABASE_URL or --database-url to write drawers
and persist resume cursors in memory_drawer_backfill_state.

Options:
  --source-type <type>     session-jsonl or claude-mem. Default: session-jsonl.
  --source-root <path>     JSONL root directory or claude-mem SQLite database path.
  --dry-run                Estimate candidates only. This is the default.
  --execute                Write drawer rows and update resumable backfill state.
  --database-url <url>     PostgreSQL URL for execute mode. Defaults to DATABASE_URL.
  --scope <scope>          Memory scope for written drawers. Default: global.
  --topic <topic>          Drawer topic. Default: claude-code-jsonl.
  --limit <count>          Stop after count candidate entries.
  --machine-id <id>        Machine id tagged onto fact source metadata.
  --embedding-usd-per-1m-tokens <usd>
                           Estimate embedding spend. Default: ${DEFAULT_EMBEDDING_USD_PER_1M_TOKENS}.
  --json                   Print JSON summary.
  --help                   Show this message.`;
}

export function parseArgs(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): BackfillMemoryDrawersCliOptions {
  const options: BackfillMemoryDrawersCliOptions = {
    sourceType: 'session-jsonl',
    sourceRoot: '',
    databaseUrl: env.DATABASE_URL,
    dryRun: true,
    json: false,
    scope: DEFAULT_SCOPE,
    topic: DEFAULT_TOPIC,
    embeddingUsdPer1MTokens: DEFAULT_EMBEDDING_USD_PER_1M_TOKENS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (!arg || arg === '--') {
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }

    if (arg === '--source-root') {
      const value = argv[index + 1];
      if (!value) throw new Error('--source-root requires a path');
      options.sourceRoot = path.resolve(value);
      index += 1;
      continue;
    }

    if (arg === '--database-url') {
      const value = argv[index + 1];
      if (!value) throw new Error('--database-url requires a URL');
      options.databaseUrl = value;
      index += 1;
      continue;
    }

    if (arg === '--source-type') {
      const value = argv[index + 1];
      if (!value) throw new Error('--source-type requires a value');
      options.sourceType = parseBackfillSourceType(value);
      index += 1;
      continue;
    }

    if (arg === '--scope') {
      const value = argv[index + 1];
      if (!value) throw new Error('--scope requires a value');
      options.scope = parseMemoryScope(value);
      index += 1;
      continue;
    }

    if (arg === '--topic') {
      const value = argv[index + 1];
      if (!value) throw new Error('--topic requires a value');
      options.topic = value;
      index += 1;
      continue;
    }

    if (arg === '--limit') {
      const value = argv[index + 1];
      if (!value) throw new Error('--limit requires a positive integer');
      options.limit = parsePositiveInteger(value, '--limit');
      index += 1;
      continue;
    }

    if (arg === '--machine-id') {
      const value = argv[index + 1];
      if (!value) throw new Error('--machine-id requires a value');
      options.machineId = value;
      index += 1;
      continue;
    }

    if (arg === '--embedding-usd-per-1m-tokens') {
      const value = argv[index + 1];
      if (!value) throw new Error('--embedding-usd-per-1m-tokens requires a number');
      options.embeddingUsdPer1MTokens = parseNonNegativeNumber(
        value,
        '--embedding-usd-per-1m-tokens',
      );
      index += 1;
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--execute') {
      options.dryRun = false;
      continue;
    }

    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    options.sourceRoot = path.resolve(arg);
  }

  if (!options.sourceRoot) {
    throw new Error('--source-root is required');
  }

  return options;
}

function parseBackfillSourceType(value: string): MemoryDrawerBackfillSourceType {
  if (value === 'session-jsonl' || value === 'claude-mem') {
    return value;
  }

  throw new Error('--source-type must be session-jsonl or claude-mem');
}

function parsePositiveInteger(value: string, optionName: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} requires a positive integer`);
  }
  return parsed;
}

function parseNonNegativeNumber(value: string, optionName: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${optionName} requires a non-negative number`);
  }
  return parsed;
}

function parseMemoryScope(value: string): MemoryScope {
  if (
    value === 'global' ||
    value.startsWith('project:') ||
    value.startsWith('agent:') ||
    value.startsWith('session:')
  ) {
    return value as MemoryScope;
  }

  throw new Error('--scope must be global, project:<id>, agent:<id>, or session:<id>');
}

function estimateEmbeddingTokens(content: string): number {
  return Math.ceil(content.length / 4);
}

function recordCandidateEstimate(
  result: BackfillMemoryDrawersResult,
  sanitizedContent: string,
  embeddingUsdPer1MTokens: number,
): void {
  const normalizedContent = sanitizedContent.trim();
  if (normalizedContent.length === 0) {
    return;
  }

  const chunkCount = Math.max(
    1,
    Math.ceil(normalizedContent.length / ESTIMATED_CHUNK_TARGET_CHARS),
  );
  const tokenCount = estimateEmbeddingTokens(normalizedContent);
  const storageBytes =
    Buffer.byteLength(normalizedContent, 'utf8') +
    chunkCount * (VECTOR_AND_INDEX_BYTES_PER_DRAWER + POSTGRES_ROW_OVERHEAD_BYTES_PER_DRAWER);

  result.estimatedDrawerChunks += chunkCount;
  result.estimatedEmbeddingTokens += tokenCount;
  result.estimatedStorageBytes += storageBytes;
  result.estimatedEmbeddingCostUsd =
    Math.round((result.estimatedEmbeddingTokens / 1_000_000) * embeddingUsdPer1MTokens * 1e8) / 1e8;
}

export function findJsonlFiles(sourceRoot: string): string[] {
  const files: string[] = [];
  const resolvedRoot = path.resolve(sourceRoot);

  function walk(current: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(fullPath);
      }
    }
  }

  walk(resolvedRoot);
  return files.sort();
}

export async function backfillMemoryDrawers(
  options: BackfillMemoryDrawersOptions,
): Promise<BackfillMemoryDrawersResult> {
  const sourceRoot = path.resolve(options.sourceRoot);
  const sourceType = options.sourceType ?? 'session-jsonl';
  const dryRun = options.dryRun;
  const scope = options.scope ?? DEFAULT_SCOPE;
  const topic = options.topic ?? DEFAULT_TOPIC;
  const embeddingUsdPer1MTokens =
    options.embeddingUsdPer1MTokens ?? DEFAULT_EMBEDDING_USD_PER_1M_TOKENS;
  const files = sourceType === 'session-jsonl' ? findJsonlFiles(sourceRoot) : [];
  const state = dryRun
    ? null
    : await requireStateStore(options).startOrResume({
        sourceType,
        sourceRoot,
      });
  const cursor = parseCursor(state?.cursorJson);
  const result: BackfillMemoryDrawersResult = {
    sourceType,
    dryRun,
    sourceRoot,
    filesDiscovered: files.length,
    filesSeen: 0,
    linesSeen: 0,
    candidates: 0,
    sanitizedCandidates: 0,
    redactionCount: 0,
    written: 0,
    skipped: 0,
    parseErrors: 0,
    claudeMemObservationsSeen: 0,
    claudeMemSessionSummariesSeen: 0,
    factCandidates: 0,
    factsWritten: 0,
    factsSkipped: 0,
    sessionSummaryFactCandidates: 0,
    sessionSummaryFactsWritten: 0,
    sessionSummaryFactsSkipped: 0,
    estimatedDrawerChunks: 0,
    estimatedEmbeddingTokens: 0,
    estimatedEmbeddingCostUsd: 0,
    estimatedStorageBytes: 0,
    lastCursor: null,
  };

  if (sourceType === 'claude-mem') {
    return backfillClaudeMemDrawers({
      options,
      dryRun,
      scope,
      topic,
      state,
      result,
    });
  }

  try {
    for (const filePath of files) {
      const relativeFilePath = normalizeRelativePath(sourceRoot, filePath);
      if (shouldSkipFile(relativeFilePath, cursor)) {
        continue;
      }

      result.filesSeen += 1;
      const startLine = relativeFilePath === cursor.filePath ? cursor.line : DEFAULT_CURSOR_LINE;

      for await (const streamLine of streamJsonlLines(filePath, startLine)) {
        result.linesSeen += 1;
        const nextCursor = {
          filePath: relativeFilePath,
          line: streamLine.lineNumber + 1,
          byteOffset: streamLine.byteOffset,
        };
        result.lastCursor = nextCursor;

        const trimmed = streamLine.line.trim();
        if (!trimmed) {
          result.skipped += 1;
          await updateCursorAfterLine(options, state, dryRun, nextCursor);
          continue;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          result.parseErrors += 1;
          warnParseError(options.logger, relativeFilePath, streamLine.lineNumber);
          await updateCursorAfterLine(options, state, dryRun, nextCursor);
          continue;
        }

        const candidate = extractJsonlCandidate(parsed, relativeFilePath, streamLine.lineNumber);
        if (!candidate) {
          result.skipped += 1;
          await updateCursorAfterLine(options, state, dryRun, nextCursor);
          continue;
        }

        result.candidates += 1;
        const sanitized = sanitizeMemoryDrawerContent(candidate.content);
        result.redactionCount += sanitized.redactionCount;
        if (sanitized.redactionStatus !== 'unreviewed') {
          result.sanitizedCandidates += 1;
        }
        recordCandidateEstimate(result, sanitized.content, embeddingUsdPer1MTokens);

        if (!dryRun) {
          const drawerStore = requireDrawerStore(options);
          await drawerStore.writeSource({
            scope,
            topic,
            sourceType: 'session-jsonl',
            sourceId: `${relativeFilePath}:${streamLine.lineNumber}`,
            sourceUri: null,
            content: candidate.content,
            sourceJson: candidate.sourceJson,
            syncVisibility: 'local',
          });
          result.written += 1;
        }

        await updateCursorAfterLine(options, state, dryRun, nextCursor);

        if (options.limit !== undefined && result.candidates >= options.limit) {
          if (!dryRun && state) {
            await options.stateStore?.markPaused?.(state.id);
          }
          return result;
        }
      }
    }

    if (!dryRun && state) {
      await options.stateStore?.markComplete(state.id);
    }
    return result;
  } catch (error: unknown) {
    if (!dryRun && state) {
      await options.stateStore?.markFailed(state.id, error);
    }
    throw error;
  }
}

async function backfillClaudeMemDrawers(params: {
  options: BackfillMemoryDrawersOptions;
  dryRun: boolean;
  scope: MemoryScope;
  topic: string;
  state: MemoryDrawerBackfillState | null;
  result: BackfillMemoryDrawersResult;
}): Promise<BackfillMemoryDrawersResult> {
  const { options, dryRun, scope, topic, state, result } = params;
  const db = requireClaudeMemDb(options);
  const cursor = parseClaudeMemCursor(state?.cursorJson);

  try {
    const observations = readClaudeMemRows<ClaudeMemObservation>(
      db,
      'observations',
      'ORDER BY created_at_epoch ASC, id ASC',
    );

    for (const observation of observations) {
      if (shouldSkipClaudeMemRow('observations', observation.id, cursor)) {
        continue;
      }

      result.claudeMemObservationsSeen += 1;
      const nextCursor: ClaudeMemBackfillCursor = {
        table: 'observations',
        id: observation.id + 1,
      };
      result.lastCursor = nextCursor;

      const candidate = buildClaudeMemObservationCandidate(observation);
      const shouldStop = await processClaudeMemCandidate({
        options,
        state,
        dryRun,
        scope,
        topic,
        result,
        candidate,
        observation,
        nextCursor,
      });
      if (shouldStop) {
        return result;
      }
    }

    const summaries = readClaudeMemRows<ClaudeMemSessionSummary>(
      db,
      'session_summaries',
      'ORDER BY created_at ASC, id ASC',
    );

    for (const summary of summaries) {
      if (shouldSkipClaudeMemRow('session_summaries', summary.id, cursor)) {
        continue;
      }

      result.claudeMemSessionSummariesSeen += 1;
      const nextCursor: ClaudeMemBackfillCursor = {
        table: 'session_summaries',
        id: summary.id + 1,
      };
      result.lastCursor = nextCursor;

      const candidate = buildClaudeMemSessionSummaryCandidate(summary);
      const shouldStop = await processClaudeMemCandidate({
        options,
        state,
        dryRun,
        scope,
        topic,
        result,
        candidate,
        sessionSummary: summary,
        nextCursor,
      });
      if (shouldStop) {
        return result;
      }
    }

    if (!dryRun && state) {
      await options.stateStore?.markComplete(state.id);
    }

    return result;
  } catch (error: unknown) {
    if (!dryRun && state) {
      await options.stateStore?.markFailed(state.id, error);
    }
    throw error;
  }
}

function requireDrawerStore(options: BackfillMemoryDrawersOptions): DrawerStoreLike {
  if (!options.drawerStore) {
    throw new Error('drawerStore is required in execute mode');
  }
  return options.drawerStore;
}

function requireStateStore(options: BackfillMemoryDrawersOptions): BackfillStateStoreLike {
  if (!options.stateStore) {
    throw new Error('stateStore is required in execute mode');
  }
  return options.stateStore;
}

function requireClaudeMemDb(options: BackfillMemoryDrawersOptions): ClaudeMemDatabase {
  if (!options.claudeMemDb) {
    throw new Error('claudeMemDb is required for claude-mem backfills');
  }
  return options.claudeMemDb;
}

function parseCursor(cursorJson: Record<string, unknown> | undefined): ParsedCursor {
  const filePath =
    typeof cursorJson?.filePath === 'string' && cursorJson.filePath.length > 0
      ? cursorJson.filePath
      : null;
  const line =
    typeof cursorJson?.line === 'number' &&
    Number.isSafeInteger(cursorJson.line) &&
    cursorJson.line > 0
      ? cursorJson.line
      : DEFAULT_CURSOR_LINE;
  return { filePath, line };
}

function parseClaudeMemCursor(
  cursorJson: Record<string, unknown> | undefined,
): ClaudeMemBackfillCursor {
  const table = cursorJson?.table;
  const id = cursorJson?.id;

  if (
    (table === 'observations' || table === 'session_summaries') &&
    typeof id === 'number' &&
    Number.isSafeInteger(id) &&
    id > 0
  ) {
    return { table, id };
  }

  return { table: 'observations', id: 1 };
}

function shouldSkipFile(relativeFilePath: string, cursor: ParsedCursor): boolean {
  return Boolean(cursor.filePath && relativeFilePath < cursor.filePath);
}

function shouldSkipClaudeMemRow(
  table: ClaudeMemBackfillCursor['table'],
  id: number,
  cursor: ClaudeMemBackfillCursor,
): boolean {
  if (cursor.table === 'session_summaries' && table === 'observations') {
    return true;
  }

  if (cursor.table !== table) {
    return false;
  }

  return id < cursor.id;
}

function normalizeRelativePath(sourceRoot: string, filePath: string): string {
  return path.relative(sourceRoot, filePath);
}

async function* streamJsonlLines(filePath: string, startLine: number): AsyncGenerator<StreamLine> {
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  let lineNumber = 0;
  let byteOffset = 0;

  for await (const line of rl) {
    lineNumber += 1;
    byteOffset += Buffer.byteLength(line, 'utf8') + 1;
    if (lineNumber < startLine) {
      continue;
    }
    yield { line, lineNumber, byteOffset };
  }
}

async function updateCursorAfterLine(
  options: BackfillMemoryDrawersOptions,
  state: MemoryDrawerBackfillState | null,
  dryRun: boolean,
  cursor: BackfillCursor,
): Promise<void> {
  if (dryRun || !state) {
    return;
  }
  await options.stateStore?.updateCursor(state.id, cursor);
}

async function processClaudeMemCandidate(params: {
  options: BackfillMemoryDrawersOptions;
  state: MemoryDrawerBackfillState | null;
  dryRun: boolean;
  scope: MemoryScope;
  topic: string;
  result: BackfillMemoryDrawersResult;
  candidate: ClaudeMemDrawerCandidate | null;
  observation?: ClaudeMemObservation;
  sessionSummary?: ClaudeMemSessionSummary;
  nextCursor: ClaudeMemBackfillCursor;
}): Promise<boolean> {
  const {
    options,
    state,
    dryRun,
    scope,
    topic,
    result,
    candidate,
    observation,
    sessionSummary,
    nextCursor,
  } = params;

  if (!candidate) {
    result.skipped += 1;
    await updateCursorAfterLine(options, state, dryRun, nextCursor);
    return false;
  }

  result.candidates += 1;
  const sanitized = sanitizeMemoryDrawerContent(candidate.content);
  result.redactionCount += sanitized.redactionCount;
  if (sanitized.redactionStatus !== 'unreviewed') {
    result.sanitizedCandidates += 1;
  }
  recordCandidateEstimate(
    result,
    sanitized.content,
    options.embeddingUsdPer1MTokens ?? DEFAULT_EMBEDDING_USD_PER_1M_TOKENS,
  );

  if (observation) {
    const factPlan = planObservationFactWrites(observation);
    result.factCandidates += factPlan.length;
  }

  if (sessionSummary) {
    const summaryPlan = planSessionSummaryFactWrites(sessionSummary);
    result.sessionSummaryFactCandidates += summaryPlan.length;
  }

  if (!dryRun) {
    const drawerStore = requireDrawerStore(options);
    const writeResult = await drawerStore.writeSource({
      scope,
      topic,
      sessionId: candidate.sessionId,
      sourceType: candidate.sourceType,
      sourceId: candidate.sourceId,
      sourceUri: candidate.sourceUri,
      content: candidate.content,
      sourceJson: candidate.sourceJson,
      syncVisibility: 'local',
    });
    result.written += 1;

    if (observation && options.memoryStore) {
      await writeObservationFacts({
        observation,
        drawers: writeResult.drawers ?? [],
        memoryStore: options.memoryStore,
        factEmbeddingClient: options.factEmbeddingClient,
        scope,
        machineId: options.machineId ?? null,
        logger: options.logger,
        result,
      });
    }

    if (sessionSummary && options.memoryStore) {
      await writeSessionSummaryFacts({
        sessionSummary,
        drawers: writeResult.drawers ?? [],
        memoryStore: options.memoryStore,
        factEmbeddingClient: options.factEmbeddingClient,
        scope,
        machineId: options.machineId ?? null,
        logger: options.logger,
        result,
      });
    }
  }

  await updateCursorAfterLine(options, state, dryRun, nextCursor);

  if (options.limit !== undefined && result.candidates >= options.limit) {
    if (!dryRun && state) {
      await options.stateStore?.markPaused?.(state.id);
    }
    return true;
  }

  return false;
}

function warnParseError(
  logger: BackfillLogger | undefined,
  relativeFilePath: string,
  lineNumber: number,
): void {
  logger?.warn?.({
    event: 'memory_drawer_backfill_parse_error',
    sourceType: 'session-jsonl',
    filePath: relativeFilePath,
    line: lineNumber,
    error: 'invalid_json',
  });
}

function extractJsonlCandidate(
  parsed: unknown,
  relativeFilePath: string,
  lineNumber: number,
): JsonlCandidate | null {
  if (!isJsonObject(parsed)) {
    return null;
  }

  const entryType = readString(parsed.type);
  const role = entryTypeToRole(entryType);
  if (!role) {
    return null;
  }

  const message = isJsonObject(parsed.message) ? parsed.message : null;
  if (!message) {
    return null;
  }

  const content = extractMessageText(message.content, role);
  if (!content) {
    return null;
  }

  const sessionId = readString(parsed.sessionId) ?? readString(parsed.session_id);
  const agentId = readString(parsed.agentId) ?? readString(parsed.agent_id);
  const machineId = readString(parsed.machineId) ?? readString(parsed.machine_id);
  const timestamp = readString(parsed.timestamp);
  const uuid = readString(parsed.uuid);
  const parentMessageId = readString(parsed.parentMessageId);

  return {
    content,
    sourceJson: compactJson({
      source: 'claude-code-jsonl',
      filePath: relativeFilePath,
      line: lineNumber,
      entryType,
      role,
      sessionId,
      agentId,
      machineId,
      timestamp,
      uuid,
      parentMessageId,
    }),
  };
}

function buildClaudeMemObservationCandidate(
  observation: ClaudeMemObservation,
): ClaudeMemDrawerCandidate | null {
  const content = assembleClaudeMemObservationDrawerContent(observation);
  if (!content) {
    return null;
  }

  const filesModified = parseStringArray(observation.files_modified);
  const factsCount = parseStringArray(observation.facts).length;
  const sourceId = `observations:${observation.id}`;

  return {
    content,
    sourceType: 'claude-mem-observation',
    sourceId,
    sourceUri: `claude-mem://observations/${observation.id}`,
    sourceJson: compactJson({
      source: 'claude-mem',
      sourceTable: 'observations',
      sourceId: String(observation.id),
      sourceKey: sourceId,
      observationType: observation.type,
      memorySessionId: observation.memory_session_id,
      project: observation.project,
      filesModified,
      factsCount,
      originalCreatedAt: observation.created_at,
      createdAtEpoch: observation.created_at_epoch,
    }),
  };
}

function buildClaudeMemSessionSummaryCandidate(
  summary: ClaudeMemSessionSummary,
): ClaudeMemDrawerCandidate | null {
  const content = summary.summary?.trim() ?? '';
  if (!content) {
    return null;
  }

  const sourceId = `session_summaries:${summary.id}`;
  return {
    content,
    sourceType: 'claude-mem-session-summary',
    sourceId,
    sourceUri: `claude-mem://session_summaries/${summary.id}`,
    sessionId: summary.session_id,
    sourceJson: compactJson({
      source: 'claude-mem',
      sourceTable: 'session_summaries',
      sourceId: String(summary.id),
      sourceKey: sourceId,
      sessionId: summary.session_id,
      originalCreatedAt: summary.created_at,
    }),
  };
}

function assembleClaudeMemObservationDrawerContent(observation: ClaudeMemObservation): string {
  const parts = [assembleObservationContent(observation)];
  const facts = parseStringArray(observation.facts);

  if (facts.length > 0) {
    parts.push(['Facts:', ...facts.map((fact) => `- ${fact}`)].join('\n'));
  }

  return parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join('\n\n');
}

type ObservationFactPlan = {
  kind: 'title' | 'fact';
  index: number;
  sourceKey: string;
  rawText: string;
};

function planObservationFactWrites(observation: ClaudeMemObservation): ObservationFactPlan[] {
  const plans: ObservationFactPlan[] = [];

  const title = observation.title?.trim() ?? '';
  if (title.length > 0) {
    plans.push({
      kind: 'title',
      index: 0,
      sourceKey: `observations:${observation.id}:parent`,
      rawText: title,
    });
  }

  const facts = parseStringArray(observation.facts);
  for (const [index, fact] of facts.entries()) {
    plans.push({
      kind: 'fact',
      index,
      sourceKey: `observations:${observation.id}:fact:${index}`,
      rawText: fact,
    });
  }

  return plans;
}

async function writeObservationFacts(params: {
  observation: ClaudeMemObservation;
  drawers: MemoryDrawer[];
  memoryStore: MemoryStoreLike;
  factEmbeddingClient?: Pick<EmbeddingClient, 'embedBatch'>;
  scope: MemoryScope;
  machineId: string | null;
  logger: BackfillLogger | undefined;
  result: BackfillMemoryDrawersResult;
}): Promise<void> {
  const {
    observation,
    drawers,
    memoryStore,
    factEmbeddingClient,
    scope,
    machineId,
    logger,
    result,
  } = params;

  if (drawers.length === 0) {
    return;
  }

  const plans = planObservationFactWrites(observation);
  if (plans.length === 0) {
    return;
  }

  const confidence = computeObservationConfidence(observation);
  const filesModified = parseStringArray(observation.files_modified);
  const importedAt = new Date().toISOString();
  const entityType = mapObservationType(observation.type);
  const preparedFacts: PreparedObservationFactWrite[] = [];

  for (const plan of plans) {
    const sanitizedFact = sanitizeMemoryDrawerContent(plan.rawText).content.trim();
    if (sanitizedFact.length === 0) {
      result.factsSkipped += 1;
      continue;
    }

    preparedFacts.push({
      plan,
      sanitizedFact,
      sourceSpans: computeFactSourceSpans(sanitizedFact, drawers),
    });
  }

  const embeddings = await embedPreparedFacts(preparedFacts, factEmbeddingClient, logger);

  for (const [index, fact] of preparedFacts.entries()) {
    const existing = await memoryStore.findFactBySourceKey(fact.plan.sourceKey);
    if (existing) {
      await repairExistingFactSourceSpans(memoryStore, existing.id, fact.sourceSpans);
      await backfillExistingFactEmbedding(
        memoryStore,
        existing.id,
        fact.sanitizedFact,
        embeddings[index] ?? null,
      );
      result.factsSkipped += 1;
      continue;
    }

    const source = buildImportedSource({
      sourceTable: 'observations',
      sourceId: observation.id,
      sourceKey: fact.plan.sourceKey,
      sessionId: observation.memory_session_id,
      memorySessionId: observation.memory_session_id,
      machineId,
      importedAt,
      filesModified,
      originalCreatedAt: observation.created_at,
    });

    try {
      await memoryStore.addFact({
        scope,
        content: fact.sanitizedFact,
        embedding: embeddings[index] ?? null,
        entity_type: entityType,
        source,
        confidence:
          fact.plan.kind === 'title' ? confidence : Math.max(0.6, confidence - 0.05),
        sourceSpans: fact.sourceSpans,
      });
      result.factsWritten += 1;
    } catch (error: unknown) {
      logger?.warn?.({
        event: 'memory_fact_backfill_write_failed',
        sourceKey: fact.plan.sourceKey,
        error: summarizeBackfillError(error),
      });
      throw error;
    }
  }
}

type SessionSummaryFactPlan = {
  sourceKey: string;
  lookupSourceKeys: string[];
  rawText: string;
};

/**
 * Session summaries carry a single free-form text blob in `summary`, with no
 * atomic facts array. Following the observation precedent (title → parent
 * source key), we map the whole sanitized summary into exactly one atomic fact
 * keyed `session_summaries:<id>` for compatibility with the older claude-mem
 * importer. The PR #703-only `:parent` key remains a lookup alias so a retry
 * does not duplicate rows written by that short-lived format. If the summary is
 * empty after sanitization, no atomic fact is emitted.
 */
function planSessionSummaryFactWrites(summary: ClaudeMemSessionSummary): SessionSummaryFactPlan[] {
  const content = summary.summary?.trim() ?? '';
  if (content.length === 0) {
    return [];
  }

  return [
    {
      sourceKey: `session_summaries:${summary.id}`,
      lookupSourceKeys: [
        `session_summaries:${summary.id}`,
        `session_summaries:${summary.id}:parent`,
      ],
      rawText: content,
    },
  ];
}

async function writeSessionSummaryFacts(params: {
  sessionSummary: ClaudeMemSessionSummary;
  drawers: MemoryDrawer[];
  memoryStore: MemoryStoreLike;
  factEmbeddingClient?: Pick<EmbeddingClient, 'embedBatch'>;
  scope: MemoryScope;
  machineId: string | null;
  logger: BackfillLogger | undefined;
  result: BackfillMemoryDrawersResult;
}): Promise<void> {
  const {
    sessionSummary,
    drawers,
    memoryStore,
    factEmbeddingClient,
    scope,
    machineId,
    logger,
    result,
  } = params;

  if (drawers.length === 0) {
    return;
  }

  const plans = planSessionSummaryFactWrites(sessionSummary);
  if (plans.length === 0) {
    return;
  }

  const importedAt = new Date().toISOString();
  const preparedFacts: PreparedSessionSummaryFactWrite[] = [];

  for (const plan of plans) {
    const sanitizedFact = sanitizeMemoryDrawerContent(plan.rawText).content.trim();
    if (sanitizedFact.length === 0) {
      result.sessionSummaryFactsSkipped += 1;
      continue;
    }

    preparedFacts.push({
      plan,
      sanitizedFact,
      sourceSpans: computeFactSourceSpans(sanitizedFact, drawers),
    });
  }

  const embeddings = await embedPreparedFacts(preparedFacts, factEmbeddingClient, logger);

  for (const [index, fact] of preparedFacts.entries()) {
    const existing = await findExistingFactBySourceKeys(memoryStore, fact.plan.lookupSourceKeys);
    if (existing) {
      await repairExistingFactSourceSpans(memoryStore, existing.id, fact.sourceSpans);
      await backfillExistingFactEmbedding(
        memoryStore,
        existing.id,
        fact.sanitizedFact,
        embeddings[index] ?? null,
      );
      result.sessionSummaryFactsSkipped += 1;
      continue;
    }

    const source = buildImportedSource({
      sourceTable: 'session_summaries',
      sourceId: sessionSummary.id,
      sourceKey: fact.plan.sourceKey,
      sessionId: sessionSummary.session_id,
      memorySessionId: null,
      machineId,
      importedAt,
      originalCreatedAt: sessionSummary.created_at,
    });

    try {
      await memoryStore.addFact({
        scope,
        content: fact.sanitizedFact,
        embedding: embeddings[index] ?? null,
        entity_type: 'concept',
        source,
        confidence: 0.85,
        sourceSpans: fact.sourceSpans,
      });
      result.sessionSummaryFactsWritten += 1;
    } catch (error: unknown) {
      logger?.warn?.({
        event: 'memory_fact_backfill_write_failed',
        sourceKey: fact.plan.sourceKey,
        error: summarizeBackfillError(error),
      });
      throw error;
    }
  }
}

async function findExistingFactBySourceKeys(
  memoryStore: MemoryStoreLike,
  sourceKeys: string[],
): Promise<{ id: string } | null> {
  for (const sourceKey of sourceKeys) {
    const existing = await memoryStore.findFactBySourceKey(sourceKey);
    if (existing) {
      return existing;
    }
  }
  return null;
}

async function repairExistingFactSourceSpans(
  memoryStore: MemoryStoreLike,
  factId: string,
  sourceSpans: AddFactSourceSpan[],
): Promise<void> {
  if (sourceSpans.length === 0 || !memoryStore.addFactSourceSpans) {
    return;
  }
  await memoryStore.addFactSourceSpans(factId, sourceSpans);
}

async function backfillExistingFactEmbedding(
  memoryStore: MemoryStoreLike,
  factId: string,
  content: string,
  embedding: number[] | null,
): Promise<void> {
  if (!memoryStore.backfillFactEmbedding) {
    return;
  }
  await memoryStore.backfillFactEmbedding({
    factId,
    content,
    embedding,
  });
}

type PreparedObservationFactWrite = {
  plan: ObservationFactPlan;
  sanitizedFact: string;
  sourceSpans: AddFactSourceSpan[];
};

type PreparedSessionSummaryFactWrite = {
  plan: SessionSummaryFactPlan;
  sanitizedFact: string;
  sourceSpans: AddFactSourceSpan[];
};

async function embedPreparedFacts(
  facts: ReadonlyArray<{ sanitizedFact: string }>,
  factEmbeddingClient: Pick<EmbeddingClient, 'embedBatch'> | undefined,
  logger: BackfillLogger | undefined,
) : Promise<number[][]> {
  if (!factEmbeddingClient || facts.length === 0) {
    return [];
  }

  try {
    const embeddings = await factEmbeddingClient.embedBatch(
      facts.map((entry) => entry.sanitizedFact),
    );
    if (embeddings.length !== facts.length) {
      throw new Error(
        `Embedding API returned ${embeddings.length} embeddings for ${facts.length} facts`,
      );
    }

    return embeddings;
  } catch (error: unknown) {
    logger?.warn?.({
      event: 'memory_fact_backfill_embedding_failed',
      error: summarizeBackfillError(error),
      count: facts.length,
    });
    return [];
  }
}

function computeFactSourceSpans(
  sanitizedFact: string,
  drawers: MemoryDrawer[],
): AddFactSourceSpan[] {
  const spans: AddFactSourceSpan[] = [];

  for (const drawer of drawers) {
    const chunkContent = drawer.content;
    const needle = sanitizedFact;
    const index = needle.length > 0 ? chunkContent.indexOf(needle) : -1;

    if (index >= 0) {
      spans.push({
        drawerId: drawer.id,
        startOffset: index,
        endOffset: index + needle.length,
        sourceJson: {
          match: 'exact',
          chunkIndex: drawer.chunkIndex,
        },
      });
    }
  }

  if (spans.length > 0) {
    return spans;
  }

  return drawers.map((drawer) => ({
    drawerId: drawer.id,
    startOffset: 0,
    endOffset: drawer.content.length,
    sourceJson: {
      match: 'fallback_full_drawer',
      chunkIndex: drawer.chunkIndex,
    },
  }));
}

function summarizeBackfillError(error: unknown): string {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(code)) {
      return code;
    }
  }
  if (error instanceof Error && /^[A-Za-z0-9_.:-]{1,128}$/.test(error.name)) {
    return error.name;
  }
  return 'unknown_error';
}

function readClaudeMemRows<T>(
  db: ClaudeMemDatabase,
  table: 'observations' | 'session_summaries',
  orderClause: string,
): T[] {
  try {
    return db.prepare(`SELECT * FROM ${table} ${orderClause}`).all() as T[];
  } catch {
    return [];
  }
}

function entryTypeToRole(entryType: string | null): 'user' | 'assistant' | null {
  if (entryType === 'user' || entryType === 'human') {
    return 'user';
  }
  if (entryType === 'assistant') {
    return 'assistant';
  }
  return null;
}

function extractMessageText(value: unknown, role: 'user' | 'assistant'): string | null {
  if (typeof value === 'string') {
    return normalizeCandidateContent(value);
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const parts: string[] = [];
  for (const block of value) {
    if (!isJsonObject(block)) {
      continue;
    }
    const blockType = readString(block.type);
    if (blockType !== 'text') {
      continue;
    }
    const text = readString(block.text);
    if (!text) {
      continue;
    }
    if (role === 'user' && isSystemInjectedText(text)) {
      continue;
    }
    const normalized = normalizeCandidateContent(text);
    if (normalized) {
      parts.push(normalized);
    }
  }

  return parts.length > 0 ? parts.join('\n\n') : null;
}

function normalizeCandidateContent(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isSystemInjectedText(value: string): boolean {
  const trimmed = value.trimStart();
  return (
    trimmed.startsWith('<') && (trimmed.includes('system-reminder') || trimmed.includes('ide_'))
  );
}

function compactJson(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue != null));
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function createConsoleLogger(): BackfillLogger {
  return {
    info: (value) => console.log(JSON.stringify(value)),
    warn: (value) => console.warn(JSON.stringify(value)),
    error: (value) => console.error(JSON.stringify(value)),
  };
}

function createStoreLogger(logger: BackfillLogger): BackfillLogger {
  return {
    warn: (_value, message) => logger.warn?.({ event: 'memory_drawer_store_warning', message }),
  };
}

function createEmbeddingClientLogger(logger: BackfillLogger) {
  const adapter = {
    debug(_value?: unknown, _message?: string) {},
    info(value?: unknown, message?: string) {
      if (value !== undefined) {
        logger.info?.(value, message);
      }
    },
    warn(value?: unknown, message?: string) {
      if (value !== undefined) {
        logger.warn?.(value, message);
      }
    },
    error(value?: unknown, message?: string) {
      if (value !== undefined) {
        logger.error?.(value, message);
      }
    },
    child() {
      return adapter;
    },
  };

  return adapter;
}

class BackfillEmbeddingClient {
  private readonly client: EmbeddingClient;
  private readonly logger: BackfillLogger;
  private readonly batchSize: number;
  private readonly maxAttempts: number;
  private readonly retryBaseDelayMs: number;

  constructor(options: {
    baseUrl: string;
    model: string;
    logger: BackfillLogger;
    batchSize?: number;
    maxAttempts?: number;
    retryBaseDelayMs?: number;
  }) {
    this.client = new EmbeddingClient({
      baseUrl: options.baseUrl,
      model: options.model,
      logger: createEmbeddingClientLogger(options.logger) as never,
      maxAttempts: 1,
    });
    this.logger = options.logger;
    this.batchSize = Math.max(1, options.batchSize ?? DEFAULT_EMBEDDING_BATCH_SIZE);
    this.maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_EMBEDDING_MAX_ATTEMPTS);
    this.retryBaseDelayMs = Math.max(
      1,
      options.retryBaseDelayMs ?? DEFAULT_EMBEDDING_RETRY_BASE_DELAY_MS,
    );
  }

  async embed(text: string): Promise<number[]> {
    const [embedding] = await this.embedBatch([text]);
    if (!embedding) {
      throw new Error('Embedding API returned no embedding for single-text request');
    }
    return embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const embeddings: number[][] = [];
    for (let index = 0; index < texts.length; index += this.batchSize) {
      const batch = texts.slice(index, index + this.batchSize);
      embeddings.push(...(await this.embedBatchWithRetry(batch)));
    }
    return embeddings;
  }

  private async embedBatchWithRetry(texts: string[]): Promise<number[][]> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return await this.client.embedBatch(texts);
      } catch (error: unknown) {
        if (attempt >= this.maxAttempts) {
          throw error;
        }

        const delayMs = this.retryBaseDelayMs * 2 ** (attempt - 1);
        this.logger.warn?.({
          event: 'memory_backfill_embedding_retry',
          error: summarizeBackfillError(error),
          attempt,
          delayMs,
          count: texts.length,
        });
        await sleep(delayMs);
      }
    }

    return [];
  }
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function createCliStores(
  pool: pg.Pool,
  logger: BackfillLogger,
  env: BackfillEnv = process.env,
): Promise<{
  drawerStore: DrawerStoreLike;
  stateStore: BackfillStateStoreLike;
  memoryStore: MemoryStoreLike;
  factEmbeddingClient?: Pick<EmbeddingClient, 'embedBatch'>;
}> {
  const [{ MemoryDrawerBackfillStateStore }, { MemoryDrawerStore }, { MemoryStore }] =
    await Promise.all([
      import('../packages/control-plane/src/memory/memory-drawer-backfill-state-store.js'),
      import('../packages/control-plane/src/memory/memory-drawer-store.js'),
      import('../packages/control-plane/src/memory/memory-store.js'),
    ]);

  const embeddingClient = createBackfillEmbeddingClient(env, logger);

  const internalStore = new MemoryStore({
    pool,
    embeddingClient: embeddingClient as EmbeddingClient | undefined,
    logger: createStoreLogger(logger) as never,
  });

  const memoryStore: MemoryStoreLike = {
    addFact: (input) => internalStore.addFact(input),
    async findFactBySourceKey(sourceKey: string) {
      const result = await pool.query<{ id: string }>(
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
    async addFactSourceSpans(factId: string, spans: AddFactSourceSpan[]) {
      const createdAt = new Date().toISOString();
      for (const span of spans) {
        await pool.query(
          `INSERT INTO memory_fact_sources (
             id, fact_id, drawer_id, start_offset, end_offset, source_json, created_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7
           )
           ON CONFLICT (fact_id, drawer_id, start_offset, end_offset)
           DO UPDATE SET source_json = EXCLUDED.source_json`,
          [
            `mem_${crypto.randomUUID().replace(/-/g, '')}`,
            factId,
            span.drawerId,
            Math.max(0, Math.trunc(span.startOffset)),
            Math.max(0, Math.trunc(span.endOffset)),
            span.sourceJson ?? {},
            createdAt,
          ],
        );
      }
    },
    async backfillFactEmbedding(input) {
      if (!embeddingClient) {
        return false;
      }

      const embedding =
        Array.isArray(input.embedding) && input.embedding.length > 0
          ? input.embedding
          : await embeddingClient.embed(input.content);
      if (embedding.length === 0) {
        return false;
      }

      const result = await pool.query(
        `UPDATE memory_facts
         SET embedding = $2::vector,
             content_model = $3,
             embedding_version = $4
         WHERE id = $1
           AND (
             embedding IS NULL
             OR content_model IS DISTINCT FROM $3
             OR embedding_version IS DISTINCT FROM $4
           )`,
        [
          input.factId,
          `[${embedding.join(',')}]`,
          MEMORY_EMBEDDING_MODEL,
          MEMORY_EMBEDDING_VERSION,
        ],
      );
      return (result.rowCount ?? 0) > 0;
    },
  };

  return {
    stateStore: new MemoryDrawerBackfillStateStore({ pool }),
    drawerStore: new MemoryDrawerStore({
      pool,
      embeddingClient: embeddingClient as EmbeddingClient | undefined,
      logger: createStoreLogger(logger) as never,
    }),
    memoryStore,
    factEmbeddingClient: embeddingClient,
  };
}

export function createBackfillEmbeddingClient(
  env: BackfillEnv,
  logger: BackfillLogger,
): Pick<EmbeddingClient, 'embed' | 'embedBatch'> | undefined {
  const baseUrl = readFirstEnv(env, EMBEDDING_BASE_URL_ENV_KEYS);
  if (!baseUrl) {
    return undefined;
  }

  return new BackfillEmbeddingClient({
    baseUrl,
    model: env.EMBEDDING_MODEL?.trim() || 'text-embedding-3-small',
    logger,
  });
}

function readFirstEnv(env: BackfillEnv, names: readonly string[]): string | null {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return null;
}

function formatSummary(result: BackfillMemoryDrawersResult): string {
  return [
    '# Memory Drawer Backfill',
    '',
    `Mode: ${result.dryRun ? 'dry-run' : 'execute'}`,
    `Source type: ${result.sourceType}`,
    `Source root: ${result.sourceRoot}`,
    `Files discovered: ${result.filesDiscovered}`,
    `Files seen: ${result.filesSeen}`,
    `Lines seen: ${result.linesSeen}`,
    `claude-mem observations seen: ${result.claudeMemObservationsSeen}`,
    `claude-mem session summaries seen: ${result.claudeMemSessionSummariesSeen}`,
    `Candidate entries: ${result.candidates}`,
    `Sanitized candidates: ${result.sanitizedCandidates}`,
    `Parse errors: ${result.parseErrors}`,
    `Estimated drawer chunks: ${result.estimatedDrawerChunks}`,
    `Estimated embedding tokens: ${result.estimatedEmbeddingTokens}`,
    `Estimated embedding cost USD: ${result.estimatedEmbeddingCostUsd.toFixed(8)}`,
    `Estimated storage bytes: ${result.estimatedStorageBytes}`,
    `Drawers written: ${result.written}`,
    `Fact candidates (observations): ${result.factCandidates}`,
    `Facts written (observations): ${result.factsWritten}`,
    `Facts skipped (observations idempotent/empty): ${result.factsSkipped}`,
    `Fact candidates (session summaries): ${result.sessionSummaryFactCandidates}`,
    `Facts written (session summaries): ${result.sessionSummaryFactsWritten}`,
    `Facts skipped (session summaries idempotent/empty): ${result.sessionSummaryFactsSkipped}`,
    `Skipped: ${result.skipped}`,
  ].join('\n');
}

function summarizeCliError(error: unknown): string {
  if (error && typeof error === 'object') {
    const code = readString((error as { code?: unknown }).code);
    if (code && /^[A-Za-z0-9_.:-]{1,128}$/.test(code)) {
      return code;
    }
  }
  if (error instanceof Error && /^[A-Za-z0-9_.:-]{1,128}$/.test(error.name)) {
    return error.name;
  }
  return 'unknown_error';
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  const logger = createConsoleLogger();
  let pool: pg.Pool | null = null;
  let claudeMemDb: ClaudeMemDatabase | null = null;

  try {
    let drawerStore: DrawerStoreLike | undefined;
    let stateStore: BackfillStateStoreLike | undefined;
    let memoryStore: MemoryStoreLike | undefined;

    if (options.sourceType === 'claude-mem') {
      const sqlite = await loadBetterSqlite3();
      claudeMemDb = new sqlite.default(resolveDbPath(options.sourceRoot), { readonly: true });
    }

    if (!options.dryRun) {
      if (!options.databaseUrl) {
        throw new Error('DATABASE_URL is required in --execute mode');
      }
      pool = new pg.Pool({ connectionString: options.databaseUrl });
      const stores = await createCliStores(pool, logger);
      stateStore = stores.stateStore;
      drawerStore = stores.drawerStore;
      memoryStore = stores.memoryStore;
      const factEmbeddingClient = stores.factEmbeddingClient;
      const result = await backfillMemoryDrawers({
        sourceType: options.sourceType,
        sourceRoot: options.sourceRoot,
        dryRun: options.dryRun,
        claudeMemDb: claudeMemDb ?? undefined,
        drawerStore,
        stateStore,
        memoryStore,
        factEmbeddingClient,
        machineId: options.machineId ?? null,
        logger,
        scope: options.scope,
        topic: options.topic,
        limit: options.limit,
        embeddingUsdPer1MTokens: options.embeddingUsdPer1MTokens,
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(formatSummary(result));
      return;
    }

    const result = await backfillMemoryDrawers({
      sourceType: options.sourceType,
      sourceRoot: options.sourceRoot,
      dryRun: options.dryRun,
      claudeMemDb: claudeMemDb ?? undefined,
      drawerStore,
      stateStore,
      memoryStore,
      machineId: options.machineId ?? null,
      logger,
      scope: options.scope,
      topic: options.topic,
      limit: options.limit,
      embeddingUsdPer1MTokens: options.embeddingUsdPer1MTokens,
    });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(formatSummary(result));
  } finally {
    claudeMemDb?.close();
    await pool?.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: 'memory_drawer_backfill_failed',
        error: summarizeCliError(error),
      }),
    );
    process.exit(1);
  });
}
