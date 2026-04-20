import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BackfillLogger } from './backfill-memory-drawers.js';
import { backfillMemoryDrawers, findJsonlFiles, parseArgs } from './backfill-memory-drawers.js';
import type {
  ClaudeMemDatabase,
  ClaudeMemObservation,
  ClaudeMemSessionSummary,
} from './claude-mem-migration-lib.js';

type MockDrawerStore = {
  writeSource: ReturnType<typeof vi.fn>;
};

type MockStateStore = {
  startOrResume: ReturnType<typeof vi.fn>;
  updateCursor: ReturnType<typeof vi.fn>;
  markComplete: ReturnType<typeof vi.fn>;
  markFailed: ReturnType<typeof vi.fn>;
};

type MockMemoryStore = {
  addFact: ReturnType<typeof vi.fn>;
  findFactBySourceKey: ReturnType<typeof vi.fn>;
};

type MockMemoryDrawer = {
  id: string;
  chunkIndex: number;
  content: string;
};

function makeDrawer(overrides: Partial<MockMemoryDrawer> = {}): MockMemoryDrawer {
  return {
    id: 'drawer-1',
    chunkIndex: 0,
    content: 'default drawer content',
    ...overrides,
  };
}

function createMemoryStore(existingKeys: string[] = []): MockMemoryStore {
  const existing = new Set(existingKeys);
  const store: MockMemoryStore = {
    addFact: vi.fn(async (input: { content: string }) => ({
      id: `fact-${existing.size}`,
      scope: 'global',
      content: input.content,
      content_model: 'text-embedding-3-small',
      entity_type: 'concept',
      confidence: 0.8,
      strength: 1,
      source: {},
      valid_from: '2026-04-20T00:00:00.000Z',
      valid_until: null,
      created_at: '2026-04-20T00:00:00.000Z',
      accessed_at: '2026-04-20T00:00:00.000Z',
      tags: [],
      usage_count: 0,
    })),
    findFactBySourceKey: vi.fn(async (sourceKey: string) => {
      return existing.has(sourceKey) ? { id: `existing-${sourceKey}` } : null;
    }),
  };
  return store;
}

let tmpDir: string;

function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'backfill-memory-drawers-test-'));
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function jsonlLine(value: Record<string, unknown>): string {
  return `${JSON.stringify(value)}\n`;
}

function claudeUserLine(text: string, overrides: Record<string, unknown> = {}): string {
  return jsonlLine({
    type: 'user',
    sessionId: 'session-a',
    timestamp: '2026-04-20T00:00:00.000Z',
    message: {
      role: 'user',
      content: [{ type: 'text', text }],
    },
    ...overrides,
  });
}

function createDrawerStore(): MockDrawerStore {
  return {
    writeSource: vi.fn().mockResolvedValue({ drawers: [], redactionStatus: 'unreviewed' }),
  };
}

function createStateStore(cursorJson: Record<string, unknown> = {}): MockStateStore {
  return {
    startOrResume: vi.fn().mockResolvedValue({
      id: 'state-1',
      sourceType: 'session-jsonl',
      sourceRoot: tmpDir,
      cursorJson,
      status: 'running',
      lastError: null,
      createdAt: '2026-04-20T00:00:00.000Z',
      updatedAt: '2026-04-20T00:00:00.000Z',
    }),
    updateCursor: vi.fn().mockResolvedValue({
      id: 'state-1',
      sourceType: 'session-jsonl',
      sourceRoot: tmpDir,
      cursorJson,
      status: 'running',
      lastError: null,
      createdAt: '2026-04-20T00:00:00.000Z',
      updatedAt: '2026-04-20T00:00:00.000Z',
    }),
    markComplete: vi.fn().mockResolvedValue({
      id: 'state-1',
      sourceType: 'session-jsonl',
      sourceRoot: tmpDir,
      cursorJson,
      status: 'complete',
      lastError: null,
      createdAt: '2026-04-20T00:00:00.000Z',
      updatedAt: '2026-04-20T00:00:00.000Z',
    }),
    markFailed: vi.fn().mockResolvedValue({
      id: 'state-1',
      sourceType: 'session-jsonl',
      sourceRoot: tmpDir,
      cursorJson,
      status: 'failed',
      lastError: 'Error',
      createdAt: '2026-04-20T00:00:00.000Z',
      updatedAt: '2026-04-20T00:00:00.000Z',
    }),
  };
}

function createClaudeMemObservation(
  overrides: Partial<ClaudeMemObservation> = {},
): ClaudeMemObservation {
  return {
    id: 42,
    type: 'decision',
    title: 'Prefer Biome for formatting',
    subtitle: 'Keep formatting and linting unified',
    facts: '["Biome replaces ESLint formatting", "Run focused Biome on touched files"]',
    narrative: 'Repeated lint drift made a single formatter easier to enforce.',
    files_modified: '["package.json", "scripts/backfill-memory-drawers.ts"]',
    project: 'agentctl',
    created_at: '2026-04-20T12:00:00.000Z',
    created_at_epoch: 1776686400,
    memory_session_id: 'memory-session-1',
    ...overrides,
  };
}

function createClaudeMemSessionSummary(
  overrides: Partial<ClaudeMemSessionSummary> = {},
): ClaudeMemSessionSummary {
  return {
    id: 7,
    session_id: 'claude-session-1',
    summary: 'The session chose a conservative drawer backfill slice.',
    created_at: '2026-04-20T13:00:00.000Z',
    ...overrides,
  };
}

function createClaudeMemDb(
  observations: ClaudeMemObservation[] = [],
  sessionSummaries: ClaudeMemSessionSummary[] = [],
): ClaudeMemDatabase {
  return {
    prepare: vi.fn((sql: string) => ({
      all: vi.fn(() => {
        if (sql.includes('observations')) {
          return observations;
        }
        if (sql.includes('session_summaries')) {
          return sessionSummaries;
        }
        return [];
      }),
    })),
    close: vi.fn(),
  };
}

function createLogger(): BackfillLogger & { entries: string[] } {
  const entries: string[] = [];
  return {
    entries,
    info: (value: unknown) => entries.push(JSON.stringify(value)),
    warn: (value: unknown) => entries.push(JSON.stringify(value)),
    error: (value: unknown) => entries.push(JSON.stringify(value)),
  };
}

beforeEach(() => {
  tmpDir = createTmpDir();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('parseArgs', () => {
  it('defaults to dry-run and requires --execute for writes', () => {
    const options = parseArgs(['--source-root', '/tmp/claude']);

    expect(options.sourceRoot).toBe(path.resolve('/tmp/claude'));
    expect(options.dryRun).toBe(true);
  });

  it('parses execute mode and conservative limits', () => {
    const options = parseArgs([
      '--source-root',
      '/tmp/claude',
      '--execute',
      '--database-url',
      'postgres://example',
      '--scope',
      'project:agentctl',
      '--topic',
      'mempalace',
      '--limit',
      '25',
      '--json',
    ]);

    expect(options).toMatchObject({
      sourceRoot: path.resolve('/tmp/claude'),
      dryRun: false,
      databaseUrl: 'postgres://example',
      scope: 'project:agentctl',
      topic: 'mempalace',
      limit: 25,
      json: true,
    });
  });

  it('parses claude-mem source selection without changing JSONL defaults', () => {
    const options = parseArgs([
      '--source-type',
      'claude-mem',
      '--source-root',
      '/tmp/claude-mem.db',
      '--dry-run',
    ]);

    expect(options.sourceType).toBe('claude-mem');
    expect(options.sourceRoot).toBe(path.resolve('/tmp/claude-mem.db'));
    expect(options.dryRun).toBe(true);
  });
});

describe('findJsonlFiles', () => {
  it('finds JSONL files recursively in stable order', () => {
    writeFile(path.join(tmpDir, 'b', 'session-b.jsonl'), '{}\n');
    writeFile(path.join(tmpDir, 'a', 'session-a.jsonl'), '{}\n');
    writeFile(path.join(tmpDir, 'a', 'ignore.txt'), '{}\n');

    const files = findJsonlFiles(tmpDir);

    expect(files.map((file) => path.relative(tmpDir, file))).toEqual([
      path.join('a', 'session-a.jsonl'),
      path.join('b', 'session-b.jsonl'),
    ]);
  });
});

describe('backfillMemoryDrawers', () => {
  it('stream-parses large JSONL inputs for dry-run estimates without reading whole files', async () => {
    const lines = Array.from({ length: 2500 }, (_value, index) =>
      claudeUserLine(`memory drawer line ${index}`),
    ).join('');
    writeFile(path.join(tmpDir, 'project', 'session.jsonl'), lines);
    const readFileSpy = vi.spyOn(fs.promises, 'readFile');
    const drawerStore = createDrawerStore();
    const stateStore = createStateStore();

    const result = await backfillMemoryDrawers({
      sourceRoot: tmpDir,
      dryRun: true,
      drawerStore: drawerStore as never,
      stateStore: stateStore as never,
    });

    expect(result).toMatchObject({
      dryRun: true,
      filesSeen: 1,
      linesSeen: 2500,
      candidates: 2500,
      written: 0,
      skipped: 0,
      parseErrors: 0,
    });
    expect(readFileSpy).not.toHaveBeenCalled();
    expect(drawerStore.writeSource).not.toHaveBeenCalled();
    expect(stateStore.startOrResume).not.toHaveBeenCalled();
  });

  it('uses the saved cursor to resume after a write failure without replaying completed lines', async () => {
    const sessionPath = path.join(tmpDir, 'project', 'session.jsonl');
    writeFile(
      sessionPath,
      [
        claudeUserLine('line 1'),
        claudeUserLine('line 2'),
        claudeUserLine('line 3'),
        claudeUserLine('line 4'),
      ].join(''),
    );

    const drawerStore = createDrawerStore();
    const firstStateStore = createStateStore();
    drawerStore.writeSource.mockImplementation(async (input: { sourceId: string }) => {
      if (input.sourceId.endsWith(':3')) {
        throw new Error('simulated crash');
      }
      return { drawers: [], redactionStatus: 'unreviewed' };
    });

    await expect(
      backfillMemoryDrawers({
        sourceRoot: tmpDir,
        dryRun: false,
        drawerStore: drawerStore as never,
        stateStore: firstStateStore as never,
      }),
    ).rejects.toThrow('simulated crash');

    expect(firstStateStore.updateCursor).toHaveBeenLastCalledWith(
      'state-1',
      expect.objectContaining({
        filePath: path.join('project', 'session.jsonl'),
        line: 3,
      }),
    );
    expect(firstStateStore.markFailed).toHaveBeenCalledWith('state-1', expect.any(Error));

    drawerStore.writeSource.mockClear();
    drawerStore.writeSource.mockResolvedValue({ drawers: [], redactionStatus: 'unreviewed' });
    const resumeStateStore = createStateStore({
      filePath: path.join('project', 'session.jsonl'),
      line: 3,
    });

    const result = await backfillMemoryDrawers({
      sourceRoot: tmpDir,
      dryRun: false,
      drawerStore: drawerStore as never,
      stateStore: resumeStateStore as never,
    });

    expect(result.written).toBe(2);
    expect(drawerStore.writeSource).toHaveBeenCalledTimes(2);
    expect(drawerStore.writeSource.mock.calls.map(([input]) => input.sourceId)).toEqual([
      `${path.join('project', 'session.jsonl')}:3`,
      `${path.join('project', 'session.jsonl')}:4`,
    ]);
    expect(resumeStateStore.markComplete).toHaveBeenCalledWith('state-1');
  });

  it('does not write drawers or state during dry-run', async () => {
    writeFile(path.join(tmpDir, 'session.jsonl'), claudeUserLine('dry run only'));
    const drawerStore = createDrawerStore();
    const stateStore = createStateStore();

    const result = await backfillMemoryDrawers({
      sourceRoot: tmpDir,
      dryRun: true,
      drawerStore: drawerStore as never,
      stateStore: stateStore as never,
    });

    expect(result.candidates).toBe(1);
    expect(result.written).toBe(0);
    expect(drawerStore.writeSource).not.toHaveBeenCalled();
    expect(stateStore.startOrResume).not.toHaveBeenCalled();
    expect(stateStore.updateCursor).not.toHaveBeenCalled();
    expect(stateStore.markComplete).not.toHaveBeenCalled();
  });

  it('sanitizes dry-run estimates and never logs raw secret-bearing JSONL content', async () => {
    const rawSecret = ['sk', '-proj-', 'secret', '1234567890'].join('');
    writeFile(
      path.join(tmpDir, 'session.jsonl'),
      [
        claudeUserLine(`OPENAI_API_KEY=${rawSecret}`),
        `{"type":"user","message":{"content":"unterminated ${rawSecret}"`,
      ].join(''),
    );
    const logger = createLogger();

    const result = await backfillMemoryDrawers({
      sourceRoot: tmpDir,
      dryRun: true,
      logger,
    });

    expect(result.candidates).toBe(1);
    expect(result.sanitizedCandidates).toBe(1);
    expect(result.parseErrors).toBe(1);
    expect(JSON.stringify(result)).not.toContain(rawSecret);
    expect(logger.entries.join('\n')).not.toContain(rawSecret);
  });

  it('counts claude-mem observation and session-summary candidates in dry-run without writes', async () => {
    const drawerStore = createDrawerStore();
    const stateStore = createStateStore();
    const db = createClaudeMemDb([createClaudeMemObservation()], [createClaudeMemSessionSummary()]);

    const result = await backfillMemoryDrawers({
      sourceType: 'claude-mem',
      sourceRoot: path.join(tmpDir, 'claude-mem.db'),
      claudeMemDb: db,
      dryRun: true,
      drawerStore: drawerStore as never,
      stateStore: stateStore as never,
    });

    expect(result).toMatchObject({
      sourceType: 'claude-mem',
      dryRun: true,
      candidates: 2,
      claudeMemObservationsSeen: 1,
      claudeMemSessionSummariesSeen: 1,
      written: 0,
      skipped: 0,
    });
    expect(drawerStore.writeSource).not.toHaveBeenCalled();
    expect(stateStore.startOrResume).not.toHaveBeenCalled();
    expect(stateStore.updateCursor).not.toHaveBeenCalled();
  });

  it('maps claude-mem rows to deterministic drawer source refs in execute mode', async () => {
    const drawerStore = createDrawerStore();
    const stateStore = createStateStore();
    const db = createClaudeMemDb([createClaudeMemObservation()], [createClaudeMemSessionSummary()]);

    const result = await backfillMemoryDrawers({
      sourceType: 'claude-mem',
      sourceRoot: path.join(tmpDir, 'claude-mem.db'),
      claudeMemDb: db,
      dryRun: false,
      drawerStore: drawerStore as never,
      stateStore: stateStore as never,
      scope: 'project:agentctl',
      topic: 'claude-mem',
    });

    expect(result.written).toBe(2);
    expect(stateStore.startOrResume).toHaveBeenCalledWith({
      sourceType: 'claude-mem',
      sourceRoot: path.join(tmpDir, 'claude-mem.db'),
    });
    expect(drawerStore.writeSource).toHaveBeenCalledTimes(2);
    expect(drawerStore.writeSource.mock.calls[0]?.[0]).toMatchObject({
      scope: 'project:agentctl',
      topic: 'claude-mem',
      sourceType: 'claude-mem-observation',
      sourceId: 'observations:42',
      sourceUri: 'claude-mem://observations/42',
      syncVisibility: 'local',
      content:
        'Prefer Biome for formatting\n\nKeep formatting and linting unified\n\nContext: Repeated lint drift made a single formatter easier to enforce.\n\nFacts:\n- Biome replaces ESLint formatting\n- Run focused Biome on touched files',
      sourceJson: {
        source: 'claude-mem',
        sourceTable: 'observations',
        sourceId: '42',
        sourceKey: 'observations:42',
        observationType: 'decision',
        memorySessionId: 'memory-session-1',
        project: 'agentctl',
        filesModified: ['package.json', 'scripts/backfill-memory-drawers.ts'],
        factsCount: 2,
        originalCreatedAt: '2026-04-20T12:00:00.000Z',
      },
    });
    expect(drawerStore.writeSource.mock.calls[1]?.[0]).toMatchObject({
      scope: 'project:agentctl',
      topic: 'claude-mem',
      sourceType: 'claude-mem-session-summary',
      sourceId: 'session_summaries:7',
      sourceUri: 'claude-mem://session_summaries/7',
      content: 'The session chose a conservative drawer backfill slice.',
      sourceJson: {
        source: 'claude-mem',
        sourceTable: 'session_summaries',
        sourceId: '7',
        sourceKey: 'session_summaries:7',
        sessionId: 'claude-session-1',
        originalCreatedAt: '2026-04-20T13:00:00.000Z',
      },
    });
    expect(stateStore.updateCursor).toHaveBeenLastCalledWith('state-1', {
      table: 'session_summaries',
      id: 8,
    });
    expect(stateStore.markComplete).toHaveBeenCalledWith('state-1');
  });

  it('resumes claude-mem execution from the saved table cursor', async () => {
    const drawerStore = createDrawerStore();
    const stateStore = createStateStore({ table: 'observations', id: 42 });
    const db = createClaudeMemDb(
      [
        createClaudeMemObservation({ id: 41, title: 'already handled' }),
        createClaudeMemObservation({ id: 42, title: 'resume here' }),
      ],
      [createClaudeMemSessionSummary()],
    );

    const result = await backfillMemoryDrawers({
      sourceType: 'claude-mem',
      sourceRoot: path.join(tmpDir, 'claude-mem.db'),
      claudeMemDb: db,
      dryRun: false,
      drawerStore: drawerStore as never,
      stateStore: stateStore as never,
    });

    expect(result.written).toBe(2);
    expect(drawerStore.writeSource.mock.calls.map(([input]) => input.sourceId)).toEqual([
      'observations:42',
      'session_summaries:7',
    ]);
  });
});

describe('claude-mem fact mapping', () => {
  function drawerFromObservationFixture(): MockMemoryDrawer {
    return makeDrawer({
      id: 'drawer-42-0',
      chunkIndex: 0,
      content: [
        'Prefer Biome for formatting',
        '',
        'Keep formatting and linting unified',
        '',
        'Context: Repeated lint drift made a single formatter easier to enforce.',
        '',
        'Facts:',
        '- Biome replaces ESLint formatting',
        '- Run focused Biome on touched files',
      ].join('\n'),
    });
  }

  it('counts fact candidates separately from drawer candidates in dry-run', async () => {
    const db = createClaudeMemDb([createClaudeMemObservation()], [createClaudeMemSessionSummary()]);
    const memoryStore = createMemoryStore();

    const result = await backfillMemoryDrawers({
      sourceType: 'claude-mem',
      sourceRoot: path.join(tmpDir, 'claude-mem.db'),
      claudeMemDb: db,
      dryRun: true,
      memoryStore: memoryStore as never,
    });

    expect(result.candidates).toBe(2);
    expect(result.factCandidates).toBe(3);
    expect(result.factsWritten).toBe(0);
    expect(memoryStore.addFact).not.toHaveBeenCalled();
    expect(memoryStore.findFactBySourceKey).not.toHaveBeenCalled();
  });

  it('co-writes drawer and atomic facts with offsets into the sanitized drawer', async () => {
    const drawer = drawerFromObservationFixture();
    const drawerStore = createDrawerStore();
    drawerStore.writeSource.mockResolvedValue({
      drawers: [drawer],
      redactionStatus: 'unreviewed',
      redactionCount: 0,
    });
    const stateStore = createStateStore();
    const memoryStore = createMemoryStore();
    const db = createClaudeMemDb([createClaudeMemObservation()]);

    const result = await backfillMemoryDrawers({
      sourceType: 'claude-mem',
      sourceRoot: path.join(tmpDir, 'claude-mem.db'),
      claudeMemDb: db,
      dryRun: false,
      drawerStore: drawerStore as never,
      stateStore: stateStore as never,
      memoryStore: memoryStore as never,
      scope: 'project:agentctl',
      topic: 'claude-mem',
    });

    expect(result.written).toBe(1);
    expect(result.factsWritten).toBe(3);
    expect(result.factsSkipped).toBe(0);
    expect(result.factCandidates).toBe(3);

    expect(memoryStore.addFact).toHaveBeenCalledTimes(3);
    const titleCall = memoryStore.addFact.mock.calls[0]?.[0];
    expect(titleCall).toMatchObject({
      scope: 'project:agentctl',
      content: 'Prefer Biome for formatting',
      entity_type: 'decision',
    });
    expect(titleCall.source).toMatchObject({
      source: 'claude-mem',
      source_table: 'observations',
      source_key: 'observations:42:parent',
    });
    expect(titleCall.sourceSpans).toEqual([
      {
        drawerId: 'drawer-42-0',
        startOffset: 0,
        endOffset: 'Prefer Biome for formatting'.length,
        sourceJson: { match: 'exact', chunkIndex: 0 },
      },
    ]);

    const firstFactCall = memoryStore.addFact.mock.calls[1]?.[0];
    expect(firstFactCall.content).toBe('Biome replaces ESLint formatting');
    expect(firstFactCall.source.source_key).toBe('observations:42:fact:0');
    const firstSpan = firstFactCall.sourceSpans[0];
    expect(firstSpan.drawerId).toBe('drawer-42-0');
    expect(drawer.content.slice(firstSpan.startOffset, firstSpan.endOffset)).toBe(
      'Biome replaces ESLint formatting',
    );

    const secondFactCall = memoryStore.addFact.mock.calls[2]?.[0];
    expect(secondFactCall.source.source_key).toBe('observations:42:fact:1');
    const secondSpan = secondFactCall.sourceSpans[0];
    expect(drawer.content.slice(secondSpan.startOffset, secondSpan.endOffset)).toBe(
      'Run focused Biome on touched files',
    );
  });

  it('writes only the title fact when the observation has no facts array', async () => {
    const drawer = makeDrawer({
      id: 'drawer-no-facts',
      chunkIndex: 0,
      content: 'Prefer Biome for formatting\n\nKeep formatting and linting unified',
    });
    const drawerStore = createDrawerStore();
    drawerStore.writeSource.mockResolvedValue({
      drawers: [drawer],
      redactionStatus: 'unreviewed',
      redactionCount: 0,
    });
    const stateStore = createStateStore();
    const memoryStore = createMemoryStore();
    const db = createClaudeMemDb([createClaudeMemObservation({ facts: null })]);

    const result = await backfillMemoryDrawers({
      sourceType: 'claude-mem',
      sourceRoot: path.join(tmpDir, 'claude-mem.db'),
      claudeMemDb: db,
      dryRun: false,
      drawerStore: drawerStore as never,
      stateStore: stateStore as never,
      memoryStore: memoryStore as never,
    });

    expect(result.factsWritten).toBe(1);
    expect(result.factCandidates).toBe(1);
    expect(memoryStore.addFact).toHaveBeenCalledTimes(1);
    expect(memoryStore.addFact.mock.calls[0]?.[0].source.source_key).toBe('observations:42:parent');
  });

  it('falls back to the full-drawer span when the fact text is not present verbatim', async () => {
    const drawer = makeDrawer({
      id: 'drawer-fallback',
      chunkIndex: 0,
      content: 'Prefer Biome for formatting',
    });
    const drawerStore = createDrawerStore();
    drawerStore.writeSource.mockResolvedValue({
      drawers: [drawer],
      redactionStatus: 'unreviewed',
      redactionCount: 0,
    });
    const stateStore = createStateStore();
    const memoryStore = createMemoryStore();
    const db = createClaudeMemDb([
      createClaudeMemObservation({
        title: null as unknown as string,
        facts: JSON.stringify(['Biome is not in the drawer content at all']),
      }),
    ]);

    const result = await backfillMemoryDrawers({
      sourceType: 'claude-mem',
      sourceRoot: path.join(tmpDir, 'claude-mem.db'),
      claudeMemDb: db,
      dryRun: false,
      drawerStore: drawerStore as never,
      stateStore: stateStore as never,
      memoryStore: memoryStore as never,
    });

    expect(result.factsWritten).toBe(1);
    const call = memoryStore.addFact.mock.calls[0]?.[0];
    expect(call.sourceSpans).toEqual([
      {
        drawerId: 'drawer-fallback',
        startOffset: 0,
        endOffset: drawer.content.length,
        sourceJson: { match: 'fallback_full_drawer', chunkIndex: 0 },
      },
    ]);
  });

  it('skips facts whose source_key already exists (idempotent resume)', async () => {
    const drawer = drawerFromObservationFixture();
    const drawerStore = createDrawerStore();
    drawerStore.writeSource.mockResolvedValue({
      drawers: [drawer],
      redactionStatus: 'unreviewed',
      redactionCount: 0,
    });
    const stateStore = createStateStore();
    const memoryStore = createMemoryStore(['observations:42:parent', 'observations:42:fact:0']);
    const db = createClaudeMemDb([createClaudeMemObservation()]);

    const result = await backfillMemoryDrawers({
      sourceType: 'claude-mem',
      sourceRoot: path.join(tmpDir, 'claude-mem.db'),
      claudeMemDb: db,
      dryRun: false,
      drawerStore: drawerStore as never,
      stateStore: stateStore as never,
      memoryStore: memoryStore as never,
    });

    expect(result.factsWritten).toBe(1);
    expect(result.factsSkipped).toBe(2);
    expect(memoryStore.addFact).toHaveBeenCalledTimes(1);
    expect(memoryStore.addFact.mock.calls[0]?.[0].source.source_key).toBe('observations:42:fact:1');
  });

  it('keeps session_summaries fact counts separate from observation fact counts', async () => {
    const summaryDrawer = makeDrawer({
      id: 'drawer-summary-7',
      chunkIndex: 0,
      content: 'The session chose a conservative drawer backfill slice.',
    });
    const drawerStore = createDrawerStore();
    drawerStore.writeSource.mockResolvedValue({
      drawers: [summaryDrawer],
      redactionStatus: 'unreviewed',
      redactionCount: 0,
    });
    const stateStore = createStateStore();
    const memoryStore = createMemoryStore();
    const db = createClaudeMemDb([], [createClaudeMemSessionSummary()]);

    const result = await backfillMemoryDrawers({
      sourceType: 'claude-mem',
      sourceRoot: path.join(tmpDir, 'claude-mem.db'),
      claudeMemDb: db,
      dryRun: false,
      drawerStore: drawerStore as never,
      stateStore: stateStore as never,
      memoryStore: memoryStore as never,
    });

    expect(result.written).toBe(1);
    // Observation-scoped counters stay at zero because only a session summary was processed.
    expect(result.factCandidates).toBe(0);
    expect(result.factsWritten).toBe(0);
    // Session-summary-scoped counters tally the summary-originated fact.
    expect(result.sessionSummaryFactCandidates).toBe(1);
    expect(result.sessionSummaryFactsWritten).toBe(1);
  });

  it('surfaces fact-write errors and leaves state failed so resume retries the same observation', async () => {
    const drawer = drawerFromObservationFixture();
    const drawerStore = createDrawerStore();
    drawerStore.writeSource.mockResolvedValue({
      drawers: [drawer],
      redactionStatus: 'unreviewed',
      redactionCount: 0,
    });
    const stateStore = createStateStore();
    const memoryStore = createMemoryStore();
    memoryStore.addFact.mockRejectedValueOnce(new Error('simulated fact failure'));
    const db = createClaudeMemDb([createClaudeMemObservation()]);

    await expect(
      backfillMemoryDrawers({
        sourceType: 'claude-mem',
        sourceRoot: path.join(tmpDir, 'claude-mem.db'),
        claudeMemDb: db,
        dryRun: false,
        drawerStore: drawerStore as never,
        stateStore: stateStore as never,
        memoryStore: memoryStore as never,
      }),
    ).rejects.toThrow('simulated fact failure');

    expect(stateStore.markFailed).toHaveBeenCalledWith('state-1', expect.any(Error));
    expect(stateStore.markComplete).not.toHaveBeenCalled();
  });
});

describe('claude-mem session_summaries fact mapping', () => {
  function drawerFromSessionSummaryFixture(): MockMemoryDrawer {
    return makeDrawer({
      id: 'drawer-summary-7-0',
      chunkIndex: 0,
      content: 'The session chose a conservative drawer backfill slice.',
    });
  }

  it('co-writes drawer and one atomic session-summary fact with a deterministic :parent source key', async () => {
    const drawer = drawerFromSessionSummaryFixture();
    const drawerStore = createDrawerStore();
    drawerStore.writeSource.mockResolvedValue({
      drawers: [drawer],
      redactionStatus: 'unreviewed',
      redactionCount: 0,
    });
    const stateStore = createStateStore();
    const memoryStore = createMemoryStore();
    const db = createClaudeMemDb([], [createClaudeMemSessionSummary()]);

    const result = await backfillMemoryDrawers({
      sourceType: 'claude-mem',
      sourceRoot: path.join(tmpDir, 'claude-mem.db'),
      claudeMemDb: db,
      dryRun: false,
      drawerStore: drawerStore as never,
      stateStore: stateStore as never,
      memoryStore: memoryStore as never,
      scope: 'project:agentctl',
      topic: 'claude-mem',
      machineId: 'macmini-1',
    });

    expect(result.written).toBe(1);
    expect(result.sessionSummaryFactCandidates).toBe(1);
    expect(result.sessionSummaryFactsWritten).toBe(1);
    expect(result.sessionSummaryFactsSkipped).toBe(0);
    // Observation-specific counters stay untouched.
    expect(result.factCandidates).toBe(0);
    expect(result.factsWritten).toBe(0);

    expect(memoryStore.addFact).toHaveBeenCalledTimes(1);
    const call = memoryStore.addFact.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      scope: 'project:agentctl',
      content: 'The session chose a conservative drawer backfill slice.',
      entity_type: 'concept',
      confidence: 0.85,
    });
    expect(call.source).toMatchObject({
      source: 'claude-mem',
      source_table: 'session_summaries',
      source_id: '7',
      source_key: 'session_summaries:7:parent',
      session_id: 'claude-session-1',
      machine_id: 'macmini-1',
      original_created_at: '2026-04-20T13:00:00.000Z',
    });
    expect(call.sourceSpans).toEqual([
      {
        drawerId: 'drawer-summary-7-0',
        startOffset: 0,
        endOffset: drawer.content.length,
        sourceJson: { match: 'exact', chunkIndex: 0 },
      },
    ]);
  });

  it('falls back to the full-drawer span when sanitizing mutates the summary text', async () => {
    const rawSecret = ['sk', '-proj-', 'secret', 'AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJ'].join(
      '',
    );
    // Drawer is what writeSource returns; the sanitizer never runs against it in the test,
    // so we force a mismatch by making the drawer content differ from the sanitized summary.
    const drawer = makeDrawer({
      id: 'drawer-summary-fallback',
      chunkIndex: 0,
      content: 'Drawer body that does not contain the sanitized summary verbatim.',
    });
    const drawerStore = createDrawerStore();
    drawerStore.writeSource.mockResolvedValue({
      drawers: [drawer],
      redactionStatus: 'redacted',
      redactionCount: 1,
    });
    const stateStore = createStateStore();
    const memoryStore = createMemoryStore();
    const db = createClaudeMemDb(
      [],
      [
        createClaudeMemSessionSummary({
          summary: `OPENAI_API_KEY=${rawSecret} — session decisions summary.`,
        }),
      ],
    );

    const result = await backfillMemoryDrawers({
      sourceType: 'claude-mem',
      sourceRoot: path.join(tmpDir, 'claude-mem.db'),
      claudeMemDb: db,
      dryRun: false,
      drawerStore: drawerStore as never,
      stateStore: stateStore as never,
      memoryStore: memoryStore as never,
    });

    expect(result.sessionSummaryFactsWritten).toBe(1);
    const call = memoryStore.addFact.mock.calls[0]?.[0];
    expect(call.source.source_key).toBe('session_summaries:7:parent');
    expect(call.sourceSpans).toEqual([
      {
        drawerId: 'drawer-summary-fallback',
        startOffset: 0,
        endOffset: drawer.content.length,
        sourceJson: { match: 'fallback_full_drawer', chunkIndex: 0 },
      },
    ]);
    // Confirm we never leaked the raw secret through the addFact payload.
    expect(JSON.stringify(call)).not.toContain(rawSecret);
  });

  it('skips the session-summary fact when the source_key is already present (idempotent resume)', async () => {
    const drawer = drawerFromSessionSummaryFixture();
    const drawerStore = createDrawerStore();
    drawerStore.writeSource.mockResolvedValue({
      drawers: [drawer],
      redactionStatus: 'unreviewed',
      redactionCount: 0,
    });
    const stateStore = createStateStore();
    const memoryStore = createMemoryStore(['session_summaries:7:parent']);
    const db = createClaudeMemDb([], [createClaudeMemSessionSummary()]);

    const result = await backfillMemoryDrawers({
      sourceType: 'claude-mem',
      sourceRoot: path.join(tmpDir, 'claude-mem.db'),
      claudeMemDb: db,
      dryRun: false,
      drawerStore: drawerStore as never,
      stateStore: stateStore as never,
      memoryStore: memoryStore as never,
    });

    // Drawer write is idempotent via (source_type, source_id, chunk_index), so the drawer
    // candidate still counts as "written"; the atomic fact is the part we dedupe here.
    expect(result.written).toBe(1);
    expect(result.sessionSummaryFactCandidates).toBe(1);
    expect(result.sessionSummaryFactsWritten).toBe(0);
    expect(result.sessionSummaryFactsSkipped).toBe(1);
    expect(memoryStore.findFactBySourceKey).toHaveBeenCalledWith('session_summaries:7:parent');
    expect(memoryStore.addFact).not.toHaveBeenCalled();
  });

  it('surfaces session-summary fact write errors through summarizeBackfillError and marks state failed', async () => {
    const drawer = drawerFromSessionSummaryFixture();
    const drawerStore = createDrawerStore();
    drawerStore.writeSource.mockResolvedValue({
      drawers: [drawer],
      redactionStatus: 'unreviewed',
      redactionCount: 0,
    });
    const stateStore = createStateStore();
    const memoryStore = createMemoryStore();
    const failure = Object.assign(new Error('simulated summary fact failure'), {
      code: 'memory_fact_conflict',
    });
    memoryStore.addFact.mockRejectedValueOnce(failure);
    const logger = createLogger();
    const db = createClaudeMemDb([], [createClaudeMemSessionSummary()]);

    await expect(
      backfillMemoryDrawers({
        sourceType: 'claude-mem',
        sourceRoot: path.join(tmpDir, 'claude-mem.db'),
        claudeMemDb: db,
        dryRun: false,
        drawerStore: drawerStore as never,
        stateStore: stateStore as never,
        memoryStore: memoryStore as never,
        logger,
      }),
    ).rejects.toThrow('simulated summary fact failure');

    expect(stateStore.markFailed).toHaveBeenCalledWith('state-1', expect.any(Error));
    expect(stateStore.markComplete).not.toHaveBeenCalled();
    // The structured warn log goes through summarizeBackfillError → the error.code string.
    const combinedLog = logger.entries.join('\n');
    expect(combinedLog).toContain('memory_fact_backfill_write_failed');
    expect(combinedLog).toContain('memory_fact_conflict');
    expect(combinedLog).toContain('session_summaries:7:parent');
  });
});
