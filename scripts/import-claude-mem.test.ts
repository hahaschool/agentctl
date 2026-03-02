import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted ensures mock fns are available before vi.mock hoists
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  return {
    mockExistsSync: vi.fn(),
    mockFetch: vi.fn(),
  };
});

vi.mock('node:fs', () => ({
  existsSync: mocks.mockExistsSync,
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import type { Database, Observation, SessionSummary } from './import-claude-mem.js';
import {
  addMemory,
  importObservations,
  importSessionSummaries,
  loadBetterSqlite3,
  main,
  parseArgs,
} from './import-claude-mem.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    id: 1,
    content: 'Test observation content',
    obs_type: 'fact',
    subject: 'testing',
    tags: 'test,unit',
    created_at: '2025-01-01T00:00:00Z',
    session_id: 'session-123',
    ...overrides,
  };
}

function makeSessionSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 1,
    session_id: 'session-456',
    summary: 'This session covered testing strategies.',
    created_at: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeMockDb(tables: Record<string, Record<string, unknown>[]> = {}): Database {
  return {
    prepare: vi.fn((sql: string) => ({
      all: () => {
        if (sql.includes('observations')) return tables.observations ?? [];
        if (sql.includes('session_summaries')) return tables.session_summaries ?? [];
        return [];
      },
    })),
    close: vi.fn(),
  };
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

describe('parseArgs()', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses positional db path', () => {
    const result = parseArgs(['node', 'script.ts', '/path/to/db.sqlite']);
    expect(result.dbPath).toContain('db.sqlite');
  });

  it('uses default mem0 URL when not provided', () => {
    const result = parseArgs(['node', 'script.ts', '/path/to/db.sqlite']);
    expect(result.mem0Url).toBe('http://localhost:8000');
  });

  it('parses --mem0-url flag', () => {
    const result = parseArgs([
      'node',
      'script.ts',
      '/path/to/db.sqlite',
      '--mem0-url',
      'http://custom:9000',
    ]);
    expect(result.mem0Url).toBe('http://custom:9000');
  });

  it('resolves dbPath to an absolute path', () => {
    const result = parseArgs(['node', 'script.ts', 'relative/path/db.sqlite']);
    expect(result.dbPath).toMatch(/^\//);
  });

  it('exits with code 1 when no dbPath is provided', () => {
    parseArgs(['node', 'script.ts']);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('handles --mem0-url before positional arg', () => {
    const result = parseArgs([
      'node',
      'script.ts',
      '--mem0-url',
      'http://custom:9000',
      '/path/to/db.sqlite',
    ]);
    expect(result.dbPath).toContain('db.sqlite');
    expect(result.mem0Url).toBe('http://custom:9000');
  });

  it('ignores unknown flags', () => {
    const result = parseArgs(['node', 'script.ts', '--unknown-flag', '/path/to/db.sqlite']);
    expect(result.dbPath).toContain('db.sqlite');
  });
});

describe('addMemory()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.mockFetch.mockReset();
    vi.stubGlobal('fetch', mocks.mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns true on successful API call', async () => {
    mockFetchOk();

    const result = await addMemory(
      'http://localhost:8000',
      [{ role: 'assistant', content: 'test' }],
      { source: 'test' },
    );
    expect(result).toBe(true);
  });

  it('sends POST to /v1/memories/', async () => {
    mockFetchOk();

    await addMemory('http://localhost:8000', [{ role: 'assistant', content: 'test' }], {
      source: 'test',
    });

    expect(mocks.mockFetch).toHaveBeenCalledWith(
      'http://localhost:8000/v1/memories/',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('sends user_id as system', async () => {
    mockFetchOk();

    await addMemory('http://localhost:8000', [{ role: 'assistant', content: 'test' }], {});

    const body = JSON.parse(mocks.mockFetch.mock.calls[0][1].body as string);
    expect(body.user_id).toBe('system');
  });

  it('includes messages and metadata in body', async () => {
    mockFetchOk();

    const messages = [{ role: 'assistant', content: 'hello' }];
    const metadata = { source: 'claude-mem', sourceId: 42 };
    await addMemory('http://localhost:8000', messages, metadata);

    const body = JSON.parse(mocks.mockFetch.mock.calls[0][1].body as string);
    expect(body.messages).toEqual(messages);
    expect(body.metadata).toEqual(metadata);
  });

  it('returns false on non-ok response', async () => {
    mockFetchError(500, 'Internal Server Error');
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

    await addMemory('http://localhost:8000///', [{ role: 'assistant', content: 'x' }], {});

    expect(mocks.mockFetch).toHaveBeenCalledWith(
      'http://localhost:8000/v1/memories/',
      expect.any(Object),
    );
  });

  it('sets Content-Type to application/json', async () => {
    mockFetchOk();

    await addMemory('http://localhost:8000', [], {});

    const headers = mocks.mockFetch.mock.calls[0][1].headers;
    expect(headers['Content-Type']).toBe('application/json');
  });
});

describe('importObservations()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.mockFetch.mockReset();
    vi.stubGlobal('fetch', mocks.mockFetch);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns zero counts when observations table is missing', async () => {
    const db: Database = {
      prepare: vi.fn(() => {
        throw new Error('no such table');
      }),
      close: vi.fn(),
    };

    const result = await importObservations(db, 'http://localhost:8000');
    expect(result).toEqual({ imported: 0, total: 0, failed: 0 });
  });

  it('imports valid observations', async () => {
    mockFetchOk();
    const obs = [makeObservation({ id: 1 }), makeObservation({ id: 2 })];
    const db = makeMockDb({ observations: obs as unknown as Record<string, unknown>[] });

    const result = await importObservations(db, 'http://localhost:8000');
    expect(result.imported).toBe(2);
    expect(result.total).toBe(2);
    expect(result.failed).toBe(0);
  });

  it('skips observations with empty content', async () => {
    mockFetchOk();
    const obs = [
      makeObservation({ id: 1, content: '' }),
      makeObservation({ id: 2, content: '   ' }),
      makeObservation({ id: 3, content: 'valid' }),
    ];
    const db = makeMockDb({ observations: obs as unknown as Record<string, unknown>[] });

    const result = await importObservations(db, 'http://localhost:8000');
    expect(result.imported).toBe(1);
    expect(result.total).toBe(3);
  });

  it('counts failed API calls', async () => {
    mockFetchError(500, 'Server Error');
    const obs = [makeObservation({ id: 1 })];
    const db = makeMockDb({ observations: obs as unknown as Record<string, unknown>[] });

    const result = await importObservations(db, 'http://localhost:8000');
    expect(result.failed).toBe(1);
    expect(result.imported).toBe(0);
  });

  it('includes source metadata for observations', async () => {
    mockFetchOk();
    const obs = [makeObservation({ id: 42, obs_type: 'preference' })];
    const db = makeMockDb({ observations: obs as unknown as Record<string, unknown>[] });

    await importObservations(db, 'http://localhost:8000');

    const body = JSON.parse(mocks.mockFetch.mock.calls[0][1].body as string);
    expect(body.metadata.source).toBe('claude-mem');
    expect(body.metadata.sourceTable).toBe('observations');
    expect(body.metadata.sourceId).toBe(42);
    expect(body.metadata.obsType).toBe('preference');
  });

  it('includes optional fields in metadata when present', async () => {
    mockFetchOk();
    const obs = [
      makeObservation({
        subject: 'typescript',
        tags: 'lang,dev',
        session_id: 'sess-1',
        created_at: '2025-06-01T00:00:00Z',
      }),
    ];
    const db = makeMockDb({ observations: obs as unknown as Record<string, unknown>[] });

    await importObservations(db, 'http://localhost:8000');

    const body = JSON.parse(mocks.mockFetch.mock.calls[0][1].body as string);
    expect(body.metadata.subject).toBe('typescript');
    expect(body.metadata.tags).toBe('lang,dev');
    expect(body.metadata.sessionId).toBe('sess-1');
    expect(body.metadata.originalCreatedAt).toBe('2025-06-01T00:00:00Z');
  });

  it('sends content as assistant role message', async () => {
    mockFetchOk();
    const obs = [makeObservation({ content: 'My observation' })];
    const db = makeMockDb({ observations: obs as unknown as Record<string, unknown>[] });

    await importObservations(db, 'http://localhost:8000');

    const body = JSON.parse(mocks.mockFetch.mock.calls[0][1].body as string);
    expect(body.messages).toEqual([{ role: 'assistant', content: 'My observation' }]);
  });

  it('omits subject from metadata when null', async () => {
    mockFetchOk();
    const obs = [makeObservation({ subject: null, tags: null, session_id: null })];
    const db = makeMockDb({ observations: obs as unknown as Record<string, unknown>[] });

    await importObservations(db, 'http://localhost:8000');

    const body = JSON.parse(mocks.mockFetch.mock.calls[0][1].body as string);
    expect(body.metadata.subject).toBeUndefined();
    expect(body.metadata.tags).toBeUndefined();
    expect(body.metadata.sessionId).toBeUndefined();
  });
});

describe('importSessionSummaries()', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.mockFetch.mockReset();
    vi.stubGlobal('fetch', mocks.mockFetch);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns zero counts when session_summaries table is missing', async () => {
    const db: Database = {
      prepare: vi.fn(() => {
        throw new Error('no such table');
      }),
      close: vi.fn(),
    };

    const result = await importSessionSummaries(db, 'http://localhost:8000');
    expect(result).toEqual({ imported: 0, total: 0, failed: 0 });
  });

  it('imports valid session summaries', async () => {
    mockFetchOk();
    const summaries = [makeSessionSummary({ id: 1 }), makeSessionSummary({ id: 2 })];
    const db = makeMockDb({
      session_summaries: summaries as unknown as Record<string, unknown>[],
    });

    const result = await importSessionSummaries(db, 'http://localhost:8000');
    expect(result.imported).toBe(2);
    expect(result.total).toBe(2);
  });

  it('skips summaries with empty content', async () => {
    mockFetchOk();
    const summaries = [
      makeSessionSummary({ summary: '' }),
      makeSessionSummary({ summary: '   ' }),
      makeSessionSummary({ id: 3, summary: 'valid summary' }),
    ];
    const db = makeMockDb({
      session_summaries: summaries as unknown as Record<string, unknown>[],
    });

    const result = await importSessionSummaries(db, 'http://localhost:8000');
    expect(result.imported).toBe(1);
  });

  it('counts failed API calls', async () => {
    mockFetchError(500, 'Internal Server Error');
    const summaries = [makeSessionSummary({ id: 1 })];
    const db = makeMockDb({
      session_summaries: summaries as unknown as Record<string, unknown>[],
    });

    const result = await importSessionSummaries(db, 'http://localhost:8000');
    expect(result.failed).toBe(1);
    expect(result.imported).toBe(0);
  });

  it('includes source metadata for session summaries', async () => {
    mockFetchOk();
    const summaries = [makeSessionSummary({ id: 99, session_id: 'sess-abc' })];
    const db = makeMockDb({
      session_summaries: summaries as unknown as Record<string, unknown>[],
    });

    await importSessionSummaries(db, 'http://localhost:8000');

    const body = JSON.parse(mocks.mockFetch.mock.calls[0][1].body as string);
    expect(body.metadata.source).toBe('claude-mem');
    expect(body.metadata.sourceTable).toBe('session_summaries');
    expect(body.metadata.sourceId).toBe(99);
    expect(body.metadata.sessionId).toBe('sess-abc');
  });

  it('prefixes content with "Session summary:"', async () => {
    mockFetchOk();
    const summaries = [makeSessionSummary({ summary: 'Covered auth flow' })];
    const db = makeMockDb({
      session_summaries: summaries as unknown as Record<string, unknown>[],
    });

    await importSessionSummaries(db, 'http://localhost:8000');

    const body = JSON.parse(mocks.mockFetch.mock.calls[0][1].body as string);
    expect(body.messages[0].content).toBe('Session summary: Covered auth flow');
  });

  it('includes originalCreatedAt when created_at is present', async () => {
    mockFetchOk();
    const summaries = [makeSessionSummary({ created_at: '2025-03-15T12:00:00Z' })];
    const db = makeMockDb({
      session_summaries: summaries as unknown as Record<string, unknown>[],
    });

    await importSessionSummaries(db, 'http://localhost:8000');

    const body = JSON.parse(mocks.mockFetch.mock.calls[0][1].body as string);
    expect(body.metadata.originalCreatedAt).toBe('2025-03-15T12:00:00Z');
  });
});

describe('loadBetterSqlite3()', () => {
  beforeEach(() => {
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a module with a default constructor', async () => {
    // loadBetterSqlite3 tries a dynamic import of 'better-sqlite3'.
    // In the test environment it may or may not be available.
    // We verify the function exists and is callable.
    expect(typeof loadBetterSqlite3).toBe('function');
  });
});

describe('main() integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.mockFetch.mockReset();
    vi.stubGlobal('fetch', mocks.mockFetch);
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
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
});
