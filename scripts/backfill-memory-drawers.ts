import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { pathToFileURL } from 'node:url';

import type { MemoryDrawerBackfillState, MemoryScope } from '@agentctl/shared';
import pg from 'pg';

import { sanitizeMemoryDrawerContent } from '../packages/control-plane/src/memory/memory-drawer-sanitizer.js';
import type { WriteMemoryDrawerSourceInput } from '../packages/control-plane/src/memory/memory-drawer-types.js';

type JsonObject = Record<string, unknown>;

export type BackfillLogger = {
  info?: (value: unknown, message?: string) => void;
  warn?: (value: unknown, message?: string) => void;
  error?: (value: unknown, message?: string) => void;
};

export type BackfillMemoryDrawersCliOptions = {
  sourceRoot: string;
  databaseUrl?: string;
  dryRun: boolean;
  json: boolean;
  scope: MemoryScope;
  topic: string;
  limit?: number;
};

export type DrawerStoreLike = {
  writeSource(input: WriteMemoryDrawerSourceInput): Promise<unknown>;
};

export type BackfillStateStoreLike = {
  startOrResume(input: {
    sourceType: 'session-jsonl';
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
  sourceRoot: string;
  dryRun: boolean;
  drawerStore?: DrawerStoreLike;
  stateStore?: BackfillStateStoreLike;
  logger?: BackfillLogger;
  scope?: MemoryScope;
  topic?: string;
  limit?: number;
};

export type BackfillMemoryDrawersResult = {
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
  lastCursor: BackfillCursor | null;
};

type BackfillCursor = {
  filePath: string;
  line: number;
  byteOffset: number;
};

type ParsedCursor = {
  filePath: string | null;
  line: number;
};

type JsonlCandidate = {
  content: string;
  sourceJson: Record<string, unknown>;
};

type StreamLine = {
  line: string;
  lineNumber: number;
  byteOffset: number;
};

const DEFAULT_SCOPE: MemoryScope = 'global';
const DEFAULT_TOPIC = 'claude-code-jsonl';
const DEFAULT_CURSOR_LINE = 1;

function usage(): string {
  return `Usage: pnpm memory:backfill-drawers --source-root <path> [--dry-run|--execute] [options]

Backfills MemoryDrawer rows from Claude Code JSONL text entries.
Default mode is --dry-run. Use --execute with DATABASE_URL or --database-url to write drawers
and persist resume cursors in memory_drawer_backfill_state.

Options:
  --source-root <path>     Root directory containing Claude Code .jsonl files.
  --dry-run                Estimate candidates only. This is the default.
  --execute                Write drawer rows and update resumable backfill state.
  --database-url <url>     PostgreSQL URL for execute mode. Defaults to DATABASE_URL.
  --scope <scope>          Memory scope for written drawers. Default: global.
  --topic <topic>          Drawer topic. Default: claude-code-jsonl.
  --limit <count>          Stop after count candidate entries.
  --json                   Print JSON summary.
  --help                   Show this message.`;
}

export function parseArgs(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): BackfillMemoryDrawersCliOptions {
  const options: BackfillMemoryDrawersCliOptions = {
    sourceRoot: '',
    databaseUrl: env.DATABASE_URL,
    dryRun: true,
    json: false,
    scope: DEFAULT_SCOPE,
    topic: DEFAULT_TOPIC,
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

function parsePositiveInteger(value: string, optionName: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} requires a positive integer`);
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
  const dryRun = options.dryRun;
  const scope = options.scope ?? DEFAULT_SCOPE;
  const topic = options.topic ?? DEFAULT_TOPIC;
  const files = findJsonlFiles(sourceRoot);
  const state = dryRun
    ? null
    : await requireStateStore(options).startOrResume({
        sourceType: 'session-jsonl',
        sourceRoot,
      });
  const cursor = parseCursor(state?.cursorJson);
  const result: BackfillMemoryDrawersResult = {
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
    lastCursor: null,
  };

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

function shouldSkipFile(relativeFilePath: string, cursor: ParsedCursor): boolean {
  return Boolean(cursor.filePath && relativeFilePath < cursor.filePath);
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

async function createCliStores(
  pool: pg.Pool,
  logger: BackfillLogger,
): Promise<{
  drawerStore: DrawerStoreLike;
  stateStore: BackfillStateStoreLike;
}> {
  const [{ MemoryDrawerBackfillStateStore }, { MemoryDrawerStore }] = await Promise.all([
    import('../packages/control-plane/dist/memory/memory-drawer-backfill-state-store.js'),
    import('../packages/control-plane/dist/memory/memory-drawer-store.js'),
  ]);

  return {
    stateStore: new MemoryDrawerBackfillStateStore({ pool }),
    drawerStore: new MemoryDrawerStore({
      pool,
      logger: createStoreLogger(logger) as never,
    }),
  };
}

function formatSummary(result: BackfillMemoryDrawersResult): string {
  return [
    '# Memory Drawer Backfill',
    '',
    `Mode: ${result.dryRun ? 'dry-run' : 'execute'}`,
    `Source root: ${result.sourceRoot}`,
    `Files discovered: ${result.filesDiscovered}`,
    `Files seen: ${result.filesSeen}`,
    `Lines seen: ${result.linesSeen}`,
    `Candidate entries: ${result.candidates}`,
    `Sanitized candidates: ${result.sanitizedCandidates}`,
    `Parse errors: ${result.parseErrors}`,
    `Written: ${result.written}`,
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

  try {
    let drawerStore: DrawerStoreLike | undefined;
    let stateStore: BackfillStateStoreLike | undefined;

    if (!options.dryRun) {
      if (!options.databaseUrl) {
        throw new Error('DATABASE_URL is required in --execute mode');
      }
      pool = new pg.Pool({ connectionString: options.databaseUrl });
      const stores = await createCliStores(pool, logger);
      stateStore = stores.stateStore;
      drawerStore = stores.drawerStore;
    }

    const result = await backfillMemoryDrawers({
      sourceRoot: options.sourceRoot,
      dryRun: options.dryRun,
      drawerStore,
      stateStore,
      logger,
      scope: options.scope,
      topic: options.topic,
      limit: options.limit,
    });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(formatSummary(result));
  } finally {
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
