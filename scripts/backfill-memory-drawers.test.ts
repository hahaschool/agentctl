import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BackfillLogger } from './backfill-memory-drawers.js';
import { backfillMemoryDrawers, findJsonlFiles, parseArgs } from './backfill-memory-drawers.js';

type MockDrawerStore = {
  writeSource: ReturnType<typeof vi.fn>;
};

type MockStateStore = {
  startOrResume: ReturnType<typeof vi.fn>;
  updateCursor: ReturnType<typeof vi.fn>;
  markComplete: ReturnType<typeof vi.fn>;
  markFailed: ReturnType<typeof vi.fn>;
};

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
});
