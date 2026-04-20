import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEmbeddingClient, mockMemorySearch, mockPool, mockSearch } = vi.hoisted(() => {
  const mockSearch = vi.fn();
  const poolInstance = {
    query: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
  };
  const embeddingClientInstance = {
    embed: vi.fn(),
  };

  return {
    mockEmbeddingClient: vi.fn(() => embeddingClientInstance),
    mockMemorySearch: vi.fn(() => ({ search: mockSearch })),
    mockPool: vi.fn(() => poolInstance),
    mockSearch,
  };
});

vi.mock('pg', () => ({
  Pool: mockPool,
}));

vi.mock('../packages/control-plane/src/memory/embedding-client.js', () => ({
  EmbeddingClient: mockEmbeddingClient,
}));

vi.mock('../packages/control-plane/src/memory/memory-search.js', () => ({
  MemorySearch: mockMemorySearch,
}));

import { main } from './memory-eval.js';

const ORIGINAL_ENV = { ...process.env };

function writeFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-eval-live-'));
  const fixturePath = path.join(dir, 'fixture.json');
  fs.writeFileSync(
    fixturePath,
    `${JSON.stringify(
      {
        version: 1,
        splitSeed: 42,
        rows: [
          {
            id: 'row-alpha',
            query: 'Which memory fact should live eval find?',
            category: 'AgentCTL-internal',
            expectedFacts: [{ id: 'fact:alpha', relevance: 3 }],
            expectedDrawerSources: [],
            redactedAnswerHints: ['The live search result maps fact:alpha.'],
            tags: ['vocabulary-gap'],
            public: true,
          },
        ],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return fixturePath;
}

describe('memory-eval live mode', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    logSpy.mockRestore();
  });

  it('keeps deterministic mock ranking as the default', async () => {
    delete process.env.DATABASE_URL;
    delete process.env.EMBEDDING_API_URL;
    delete process.env.LITELLM_PROXY_URL;
    delete process.env.LITELLM_URL;

    await main(['--fixture', writeFixture(), '--json']);

    const output = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string);
    expect(output.summary.totalRows).toBe(1);
    expect(output.rowResults[0].matchedExpectedKeysAt5).toEqual(['fact:fact:alpha']);
    expect(mockPool).not.toHaveBeenCalled();
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('requires DATABASE_URL for --no-mock runs', async () => {
    process.env.LITELLM_URL = 'http://localhost:4000';
    delete process.env.DATABASE_URL;

    await expect(main(['--no-mock', '--fixture', writeFixture()])).rejects.toThrow(/DATABASE_URL/);

    expect(mockPool).not.toHaveBeenCalled();
  });

  it('requires an embedding base URL for --no-mock runs', async () => {
    process.env.DATABASE_URL = 'postgres://localhost/agentctl';
    delete process.env.EMBEDDING_API_URL;
    delete process.env.LITELLM_PROXY_URL;
    delete process.env.LITELLM_URL;

    await expect(main(['--no-mock', '--fixture', writeFixture()])).rejects.toThrow(
      /LITELLM_URL|EMBEDDING_API_URL|LITELLM_PROXY_URL/,
    );

    expect(mockPool).not.toHaveBeenCalled();
  });

  it('keeps the full-set guard in live mode', async () => {
    process.env.DATABASE_URL = 'postgres://localhost/agentctl';
    process.env.LITELLM_URL = 'http://localhost:4000';

    await expect(
      main(['--no-mock', '--fixture', writeFixture(), '--split', 'full']),
    ).rejects.toThrow(/Full memory eval set is reserved/);

    expect(mockPool).not.toHaveBeenCalled();
  });

  it('runs real MemorySearch, maps fact ids into eval candidates, and closes the pool', async () => {
    process.env.DATABASE_URL = 'postgres://localhost/agentctl';
    process.env.LITELLM_URL = 'http://localhost:4000';
    process.env.EMBEDDING_MODEL = 'text-embedding-3-small';
    mockSearch.mockResolvedValueOnce([
      {
        fact: { id: 'fact:alpha' },
        score: 0.98,
        source_path: 'vector',
      },
    ]);

    await main([
      '--no-mock',
      '--fixture',
      writeFixture(),
      '--split',
      'full',
      '--allow-full',
      '--json',
    ]);

    expect(mockPool).toHaveBeenCalledWith({ connectionString: 'postgres://localhost/agentctl' });
    expect(mockEmbeddingClient).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'http://localhost:4000',
        model: 'text-embedding-3-small',
      }),
    );
    expect(mockMemorySearch).toHaveBeenCalledWith(
      expect.objectContaining({
        pool: expect.any(Object),
        embeddingClient: expect.any(Object),
      }),
    );
    expect(mockSearch).toHaveBeenCalledWith({
      query: 'Which memory fact should live eval find?',
      visibleScopes: [],
      limit: 10,
    });

    const output = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string);
    expect(output.rowResults[0].rankedResultKeys).toEqual(['fact:fact:alpha']);
    expect(output.rowResults[0].matchedExpectedKeysAt5).toEqual(['fact:fact:alpha']);
    expect(mockPool.mock.results[0]?.value.end).toHaveBeenCalledTimes(1);
  });
});
