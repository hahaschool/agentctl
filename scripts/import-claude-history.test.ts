import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  return {
    mockFetch: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import type { ExtractedMessage } from './import-claude-history.js';
import {
  addMemory,
  buildSessionSummary,
  extractProjectPath,
  extractSessionId,
  findJsonlFiles,
  main,
  parseArgs,
  readJsonlMessages,
} from './import-claude-history.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function createTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-claude-history-test-'));
  return dir;
}

function writeFile(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function mockFetchOk(): void {
  mocks.mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    text: () => Promise.resolve('{"result":"ok"}'),
  });
}

function mockFetchError(status: number, body: string): void {
  mocks.mockFetch.mockResolvedValue({
    ok: false,
    status,
    text: () => Promise.resolve(body),
  });
}

function mockFetchNetworkError(message = 'ECONNREFUSED'): void {
  mocks.mockFetch.mockRejectedValue(new Error(message));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  tmpDir = createTmpDir();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('parseArgs()', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('parses positional projects directory', () => {
    const result = parseArgs(['node', 'script.ts', '/home/user/.claude/projects']);
    expect(result.projectsDir).toContain('.claude/projects');
  });

  it('uses default mem0 URL when not provided', () => {
    const result = parseArgs(['node', 'script.ts', '/some/dir']);
    expect(result.mem0Url).toBe('http://localhost:8000');
  });

  it('parses --mem0-url flag', () => {
    const result = parseArgs([
      'node',
      'script.ts',
      '/some/dir',
      '--mem0-url',
      'http://custom:9000',
    ]);
    expect(result.mem0Url).toBe('http://custom:9000');
  });

  it('resolves projectsDir to an absolute path', () => {
    const result = parseArgs(['node', 'script.ts', 'relative/dir']);
    expect(result.projectsDir).toMatch(/^\//);
  });

  it('exits with code 1 when no projectsDir is provided', () => {
    parseArgs(['node', 'script.ts']);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('handles --mem0-url before positional arg', () => {
    const result = parseArgs([
      'node',
      'script.ts',
      '--mem0-url',
      'http://custom:9000',
      '/some/dir',
    ]);
    expect(result.projectsDir).toContain('some/dir');
    expect(result.mem0Url).toBe('http://custom:9000');
  });

  it('ignores unknown flag-like arguments', () => {
    const result = parseArgs(['node', 'script.ts', '--verbose', '/some/dir']);
    expect(result.projectsDir).toContain('some/dir');
  });
});

describe('findJsonlFiles()', () => {
  it('returns empty array for empty directory', () => {
    const result = findJsonlFiles(tmpDir);
    expect(result).toEqual([]);
  });

  it('finds .jsonl files in root directory', () => {
    writeFile(path.join(tmpDir, 'session1.jsonl'), '{}');
    writeFile(path.join(tmpDir, 'session2.jsonl'), '{}');

    const result = findJsonlFiles(tmpDir);
    expect(result).toHaveLength(2);
  });

  it('finds .jsonl files recursively', () => {
    writeFile(path.join(tmpDir, 'project1', 'session1.jsonl'), '{}');
    writeFile(path.join(tmpDir, 'project2', 'session2.jsonl'), '{}');
    writeFile(path.join(tmpDir, 'project2', 'sub', 'session3.jsonl'), '{}');

    const result = findJsonlFiles(tmpDir);
    expect(result).toHaveLength(3);
  });

  it('ignores non-.jsonl files', () => {
    writeFile(path.join(tmpDir, 'readme.md'), '# test');
    writeFile(path.join(tmpDir, 'data.json'), '{}');
    writeFile(path.join(tmpDir, 'session.jsonl'), '{}');

    const result = findJsonlFiles(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('session.jsonl');
  });

  it('returns sorted file paths', () => {
    writeFile(path.join(tmpDir, 'c.jsonl'), '{}');
    writeFile(path.join(tmpDir, 'a.jsonl'), '{}');
    writeFile(path.join(tmpDir, 'b.jsonl'), '{}');

    const result = findJsonlFiles(tmpDir);
    const names = result.map((f) => path.basename(f));
    expect(names).toEqual(['a.jsonl', 'b.jsonl', 'c.jsonl']);
  });

  it('handles unreadable directories gracefully', () => {
    // Pass a non-existent directory - the walk function catches errors
    const result = findJsonlFiles(path.join(tmpDir, 'nonexistent'));
    expect(result).toEqual([]);
  });

  it('returns absolute paths', () => {
    writeFile(path.join(tmpDir, 'session.jsonl'), '{}');

    const result = findJsonlFiles(tmpDir);
    expect(result[0]).toMatch(/^\//);
  });
});

describe('readJsonlMessages()', () => {
  it('returns empty array for empty file', async () => {
    const filePath = path.join(tmpDir, 'empty.jsonl');
    writeFile(filePath, '');

    const result = await readJsonlMessages(filePath);
    expect(result).toEqual([]);
  });

  it('parses human messages as user role', async () => {
    const filePath = path.join(tmpDir, 'session.jsonl');
    const content = JSON.stringify({
      type: 'human',
      message: { role: 'user', content: 'Hello world' },
    });
    writeFile(filePath, content);

    const result = await readJsonlMessages(filePath);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('user');
    expect(result[0].content).toBe('Hello world');
  });

  it('parses assistant messages', async () => {
    const filePath = path.join(tmpDir, 'session.jsonl');
    const content = JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: 'Hi there' },
    });
    writeFile(filePath, content);

    const result = await readJsonlMessages(filePath);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('assistant');
    expect(result[0].content).toBe('Hi there');
  });

  it('handles content blocks (array format)', async () => {
    const filePath = path.join(tmpDir, 'session.jsonl');
    const content = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Part 1' },
          { type: 'text', text: 'Part 2' },
        ],
      },
    });
    writeFile(filePath, content);

    const result = await readJsonlMessages(filePath);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('Part 1\nPart 2');
  });

  it('filters out non-text content blocks', async () => {
    const filePath = path.join(tmpDir, 'session.jsonl');
    const content = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Real text' },
          { type: 'tool_use', id: 'tool_1' },
        ],
      },
    });
    writeFile(filePath, content);

    const result = await readJsonlMessages(filePath);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('Real text');
  });

  it('skips unknown message types (not human or assistant)', async () => {
    const filePath = path.join(tmpDir, 'session.jsonl');
    const lines = [
      JSON.stringify({ type: 'system', message: { content: 'system msg' } }),
      JSON.stringify({ type: 'tool_result', message: { content: 'tool output' } }),
      JSON.stringify({ type: 'human', message: { role: 'user', content: 'hello' } }),
    ].join('\n');
    writeFile(filePath, lines);

    const result = await readJsonlMessages(filePath);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('user');
  });

  it('skips malformed JSON lines', async () => {
    const filePath = path.join(tmpDir, 'session.jsonl');
    const lines = [
      'not valid json{{{',
      JSON.stringify({ type: 'human', message: { role: 'user', content: 'valid' } }),
    ].join('\n');
    writeFile(filePath, lines);

    const result = await readJsonlMessages(filePath);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('valid');
  });

  it('skips empty lines', async () => {
    const filePath = path.join(tmpDir, 'session.jsonl');
    const lines = [
      '',
      JSON.stringify({ type: 'human', message: { role: 'user', content: 'hello' } }),
      '   ',
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: 'hi' },
      }),
    ].join('\n');
    writeFile(filePath, lines);

    const result = await readJsonlMessages(filePath);
    expect(result).toHaveLength(2);
  });

  it('skips messages with empty content', async () => {
    const filePath = path.join(tmpDir, 'session.jsonl');
    const lines = [
      JSON.stringify({ type: 'human', message: { role: 'user', content: '   ' } }),
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: 'response' },
      }),
    ].join('\n');
    writeFile(filePath, lines);

    const result = await readJsonlMessages(filePath);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('assistant');
  });

  it('skips messages without a message field', async () => {
    const filePath = path.join(tmpDir, 'session.jsonl');
    const content = JSON.stringify({ type: 'human' });
    writeFile(filePath, content);

    const result = await readJsonlMessages(filePath);
    expect(result).toEqual([]);
  });

  it('handles multiple messages in sequence', async () => {
    const filePath = path.join(tmpDir, 'session.jsonl');
    const lines = [
      JSON.stringify({ type: 'human', message: { role: 'user', content: 'Q1' } }),
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: 'A1' },
      }),
      JSON.stringify({ type: 'human', message: { role: 'user', content: 'Q2' } }),
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: 'A2' },
      }),
    ].join('\n');
    writeFile(filePath, lines);

    const result = await readJsonlMessages(filePath);
    expect(result).toHaveLength(4);
    expect(result.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  });
});

describe('buildSessionSummary()', () => {
  it('returns empty string for empty messages array', () => {
    const result = buildSessionSummary([]);
    expect(result).toBe('');
  });

  it('includes the first user message', () => {
    const messages: ExtractedMessage[] = [
      { role: 'user', content: 'How do I set up testing?' },
      { role: 'assistant', content: 'Use vitest.' },
    ];

    const result = buildSessionSummary(messages);
    expect(result).toContain('User started with:');
    expect(result).toContain('How do I set up testing?');
  });

  it('includes the last assistant message', () => {
    const messages: ExtractedMessage[] = [
      { role: 'user', content: 'Question' },
      { role: 'assistant', content: 'First response' },
      { role: 'assistant', content: 'Final response' },
    ];

    const result = buildSessionSummary(messages);
    expect(result).toContain('Assistant concluded with:');
    expect(result).toContain('Final response');
  });

  it('includes total message count', () => {
    const messages: ExtractedMessage[] = [
      { role: 'user', content: 'Q' },
      { role: 'assistant', content: 'A' },
      { role: 'user', content: 'Q2' },
    ];

    const result = buildSessionSummary(messages);
    expect(result).toContain('Total messages: 3');
  });

  it('truncates long first user message to 500 chars', () => {
    const longContent = 'x'.repeat(1000);
    const messages: ExtractedMessage[] = [
      { role: 'user', content: longContent },
      { role: 'assistant', content: 'Response' },
    ];

    const result = buildSessionSummary(messages);
    // The summary should contain only the first 500 chars, not the full 1000
    const userPart = result.split('\n\n')[0];
    expect(userPart.length).toBeLessThan(600);
  });

  it('truncates long last assistant message to 500 chars', () => {
    const longContent = 'y'.repeat(1000);
    const messages: ExtractedMessage[] = [
      { role: 'user', content: 'Question' },
      { role: 'assistant', content: longContent },
    ];

    const result = buildSessionSummary(messages);
    const parts = result.split('\n\n');
    const assistantPart = parts[1];
    expect(assistantPart.length).toBeLessThan(600);
  });

  it('handles messages with only user messages', () => {
    const messages: ExtractedMessage[] = [{ role: 'user', content: 'Just a question' }];

    const result = buildSessionSummary(messages);
    expect(result).toContain('User started with:');
    expect(result).toContain('Total messages: 1');
    expect(result).not.toContain('Assistant concluded with:');
  });

  it('handles messages with only assistant messages', () => {
    const messages: ExtractedMessage[] = [{ role: 'assistant', content: 'Just a response' }];

    const result = buildSessionSummary(messages);
    expect(result).toContain('Assistant concluded with:');
    expect(result).toContain('Total messages: 1');
    expect(result).not.toContain('User started with:');
  });
});

describe('extractProjectPath()', () => {
  it('decodes URL-encoded parent directory', () => {
    const filePath = '/projects/%2Fhome%2Fuser%2Fcode/session.jsonl';
    const projectsDir = '/projects';

    const result = extractProjectPath(filePath, projectsDir);
    expect(result).toBe('/home/user/code');
  });

  it('returns raw directory name when decoding fails', () => {
    // %ZZ is not a valid URL encoding
    const filePath = '/projects/%ZZ-invalid/session.jsonl';
    const projectsDir = '/projects';

    const result = extractProjectPath(filePath, projectsDir);
    expect(result).toBe('%ZZ-invalid');
  });

  it('handles nested project paths', () => {
    const filePath = '/projects/org%2Frepo/session.jsonl';
    const projectsDir = '/projects';

    const result = extractProjectPath(filePath, projectsDir);
    expect(result).toBe('org/repo');
  });
});

describe('extractSessionId()', () => {
  it('extracts filename without .jsonl extension', () => {
    const result = extractSessionId('/some/path/abc-123-def.jsonl');
    expect(result).toBe('abc-123-def');
  });

  it('handles UUID-style filenames', () => {
    const result = extractSessionId('/projects/test/a1b2c3d4-e5f6-7890-abcd-ef1234567890.jsonl');
    expect(result).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
  });

  it('handles nested directory paths', () => {
    const result = extractSessionId('/deep/nested/path/session-id.jsonl');
    expect(result).toBe('session-id');
  });
});

describe('addMemory()', () => {
  beforeEach(() => {
    mocks.mockFetch.mockReset();
    vi.stubGlobal('fetch', mocks.mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns true on successful API call', async () => {
    mockFetchOk();

    const result = await addMemory('http://localhost:8000', [{ role: 'user', content: 'test' }], {
      source: 'claude-code',
    });
    expect(result).toBe(true);
  });

  it('sends POST to /v1/memories/', async () => {
    mockFetchOk();

    await addMemory('http://localhost:8000', [{ role: 'user', content: 'test' }], {});

    expect(mocks.mockFetch).toHaveBeenCalledWith(
      'http://localhost:8000/v1/memories/',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('sends user_id as system', async () => {
    mockFetchOk();

    await addMemory('http://localhost:8000', [{ role: 'user', content: 'test' }], {});

    const body = JSON.parse(mocks.mockFetch.mock.calls[0][1].body as string);
    expect(body.user_id).toBe('system');
  });

  it('includes messages and metadata in request body', async () => {
    mockFetchOk();

    const messages = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'summary' },
    ];
    const metadata = { source: 'claude-code', sessionId: 'xyz' };
    await addMemory('http://localhost:8000', messages, metadata);

    const lastCall = mocks.mockFetch.mock.calls[mocks.mockFetch.mock.calls.length - 1];
    const body = JSON.parse(lastCall[1].body as string);
    expect(body.messages).toEqual(messages);
    expect(body.metadata).toEqual(metadata);
  });

  it('returns false on non-ok response', async () => {
    mockFetchError(500, 'Server Error');
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await addMemory('http://localhost:8000', [], {});
    expect(result).toBe(false);
  });

  it('returns false on network error', async () => {
    mockFetchNetworkError();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await addMemory('http://localhost:8000', [], {});
    expect(result).toBe(false);
  });

  it('strips trailing slashes from mem0Url', async () => {
    mockFetchOk();

    await addMemory('http://localhost:8000///', [{ role: 'user', content: 'x' }], {});

    expect(mocks.mockFetch).toHaveBeenCalledWith(
      'http://localhost:8000/v1/memories/',
      expect.any(Object),
    );
  });

  it('sets Content-Type header', async () => {
    mockFetchOk();

    await addMemory('http://localhost:8000', [], {});

    const headers = mocks.mockFetch.mock.calls[0][1].headers;
    expect(headers['Content-Type']).toBe('application/json');
  });
});

describe('main() integration', () => {
  beforeEach(() => {
    mocks.mockFetch.mockReset();
    vi.stubGlobal('fetch', mocks.mockFetch);
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exits with code 1 when no args provided', async () => {
    const originalArgv = process.argv;
    process.argv = ['node', 'script.ts'];

    try {
      await main();
    } catch {
      // expected
    }

    expect(process.exit).toHaveBeenCalledWith(1);
    process.argv = originalArgv;
  });

  it('exits with code 1 when projects directory does not exist', async () => {
    const originalArgv = process.argv;
    process.argv = ['node', 'script.ts', '/nonexistent/path'];

    try {
      await main();
    } catch {
      // expected
    }

    expect(process.exit).toHaveBeenCalledWith(1);
    process.argv = originalArgv;
  });

  it('exits with code 1 when Mem0 is unreachable', async () => {
    const originalArgv = process.argv;
    process.argv = ['node', 'script.ts', tmpDir];
    mockFetchNetworkError('ECONNREFUSED');

    try {
      await main();
    } catch {
      // expected
    }

    expect(process.exit).toHaveBeenCalledWith(1);
    process.argv = originalArgv;
  });

  it('imports sessions when Mem0 is healthy and files exist', async () => {
    const originalArgv = process.argv;
    process.argv = ['node', 'script.ts', tmpDir];

    // Health check OK
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve('ok'),
    });

    // Create a session file
    const sessionContent = [
      JSON.stringify({
        type: 'human',
        message: { role: 'user', content: 'What is TypeScript?' },
      }),
      JSON.stringify({
        type: 'assistant',
        message: { role: 'assistant', content: 'TypeScript is a typed superset of JavaScript.' },
      }),
    ].join('\n');
    writeFile(path.join(tmpDir, 'project1', 'session-abc.jsonl'), sessionContent);

    // addMemory call succeeds
    mocks.mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{"result":"ok"}'),
    });

    await main();

    // Should have called fetch at least twice (health + addMemory)
    expect(mocks.mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2);
    process.argv = originalArgv;
  });

  it('handles empty projects directory', async () => {
    const originalArgv = process.argv;
    process.argv = ['node', 'script.ts', tmpDir];

    // Health check OK
    mocks.mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve('ok'),
    });

    await main();

    const logCalls = (console.log as ReturnType<typeof vi.fn>).mock.calls;
    const nothingLog = logCalls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('Nothing to import'),
    );
    expect(nothingLog).toBeDefined();
    process.argv = originalArgv;
  });
});
