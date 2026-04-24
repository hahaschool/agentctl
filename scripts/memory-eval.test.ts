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

function writeCoverageFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-eval-coverage-'));
  const fixturePath = path.join(dir, 'fixture.json');
  fs.writeFileSync(
    fixturePath,
    `${JSON.stringify(
      {
        version: 1,
        splitSeed: 42,
        rows: [
          {
            id: 'row-vocabulary-gap',
            query: 'Which term mapped to the right memory?',
            category: 'AgentCTL-internal',
            expectedFacts: [{ id: 'fact:vocabulary-gap', relevance: 3 }],
            expectedDrawerSources: [],
            redactedAnswerHints: ['Vocabulary gap fixture row.'],
            tags: ['vocabulary-gap'],
            public: true,
          },
          {
            id: 'row-temporal-ambiguity',
            query: 'Which action happened yesterday?',
            category: 'AgentCTL-internal',
            expectedFacts: [{ id: 'fact:temporal-ambiguity', relevance: 3 }],
            expectedDrawerSources: [],
            redactedAnswerHints: ['Temporal ambiguity fixture row.'],
            tags: ['temporal-ambiguity'],
            public: true,
          },
          {
            id: 'row-assistant-reference',
            query: 'What did the assistant recommend?',
            category: 'AgentCTL-internal',
            expectedFacts: [{ id: 'fact:assistant-reference', relevance: 3 }],
            expectedDrawerSources: [],
            redactedAnswerHints: ['Assistant reference fixture row.'],
            tags: ['assistant-reference'],
            public: true,
          },
          {
            id: 'row-person-name-underweighting',
            query: 'Which operator was mentioned by name?',
            category: 'AgentCTL-internal',
            expectedFacts: [{ id: 'fact:person-name-underweighting', relevance: 3 }],
            expectedDrawerSources: [],
            redactedAnswerHints: ['Person-name underweighting fixture row.'],
            tags: ['person-name-underweighting'],
            public: true,
          },
          {
            id: 'row-noisy-distractor-rejection',
            query: 'Which fact survived the distractor list?',
            category: 'AgentCTL-internal',
            expectedFacts: [{ id: 'fact:noisy-distractor-rejection', relevance: 3 }],
            expectedDrawerSources: [],
            redactedAnswerHints: ['Noisy distractor rejection fixture row.'],
            tags: ['noisy-distractor-rejection'],
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

  it('prints tag metrics and the failure section in human-readable mode', async () => {
    delete process.env.DATABASE_URL;
    delete process.env.EMBEDDING_API_URL;
    delete process.env.LITELLM_PROXY_URL;
    delete process.env.LITELLM_URL;

    await main(['--fixture', writeFixture()]);

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(output).toContain('# Memory Eval (dev, mock ranking)');
    expect(output).toContain('## By Tag');
    expect(output).toContain(
      '| vocabulary-gap | 1 | 1.000 | 1.000 | 1.000 | 1.000 | 0.000 | 0.000 |',
    );
    expect(output).toContain('## Failure Examples');
    expect(output).toContain('None.');
    expect(mockPool).not.toHaveBeenCalled();
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('can require fixture failure-mode coverage for private eval runs', async () => {
    process.env.MEMORY_EVAL_REQUIRE_FAILURE_MODE_COVERAGE = 'true';
    process.env.MEMORY_EVAL_FAILURE_MODE_MIN_ROWS = '2';
    delete process.env.DATABASE_URL;
    delete process.env.EMBEDDING_API_URL;
    delete process.env.LITELLM_PROXY_URL;
    delete process.env.LITELLM_URL;

    await expect(main(['--fixture', writeFixture(), '--json'])).rejects.toThrow(
      /MEMORY_EVAL_REQUIRE_FAILURE_MODE_COVERAGE|temporal-ambiguity \(0\/2\)|assistant-reference \(0\/2\)|Current required-tag counts:/,
    );

    expect(logSpy).not.toHaveBeenCalled();
    expect(mockPool).not.toHaveBeenCalled();
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('appends fixture failure-mode coverage details when the workflow gate is enabled', async () => {
    process.env.MEMORY_EVAL_REQUIRE_FAILURE_MODE_COVERAGE = 'true';
    process.env.MEMORY_EVAL_FAILURE_MODE_MIN_ROWS = '1';
    delete process.env.DATABASE_URL;
    delete process.env.EMBEDDING_API_URL;
    delete process.env.LITELLM_PROXY_URL;
    delete process.env.LITELLM_URL;

    await main(['--fixture', writeCoverageFixture()]);

    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(output).toContain('# Memory Eval (dev, mock ranking)');
    expect(output).toContain('## Fixture Failure-Mode Coverage');
    expect(output).toContain('| vocabulary-gap | 1 | 1 | ok |');
    expect(output).toContain('| temporal-ambiguity | 1 | 1 | ok |');
    expect(output).toContain('| assistant-reference | 1 | 1 | ok |');
    expect(output).toContain('| person-name-underweighting | 1 | 1 | ok |');
    expect(output).toContain('| noisy-distractor-rejection | 1 | 1 | ok |');
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

  it('keeps the held-out guard in live mode', async () => {
    process.env.DATABASE_URL = 'postgres://localhost/agentctl';
    process.env.LITELLM_URL = 'http://localhost:4000';

    await expect(
      main(['--no-mock', '--fixture', writeFixture(), '--split', 'held-out']),
    ).rejects.toThrow(/workflow eval jobs/);

    expect(mockPool).not.toHaveBeenCalled();
  });

  it('runs real MemorySearch, maps fact ids into eval candidates, and closes the pool', async () => {
    process.env.DATABASE_URL = 'postgres://localhost/agentctl';
    process.env.LITELLM_URL = 'http://localhost:4000';
    process.env.EMBEDDING_MODEL = 'text-embedding-3-small';
    process.env.MEMORY_EVAL_ALLOW_FULL_SET = 'true';
    mockSearch.mockResolvedValueOnce([
      {
        fact: { id: 'fact:alpha' },
        score: 0.98,
        source_path: 'vector',
      },
    ]);

    await main(['--no-mock', '--fixture', writeFixture(), '--split', 'full', '--json']);

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
