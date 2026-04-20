import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildFactsOnlyBaselineSnapshot,
  createFactsOnlyBaselineRanker,
  DEFAULT_FACTS_ONLY_FIXTURE_PATH,
  hashFixture,
  main,
  parseArgs,
  percentileDuration,
  runFactsOnlyBaseline,
  serializeFactsOnlyBaselineSnapshot,
} from './memory-bench.js';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..');
const COMMITTED_BASELINE_PATH = path.join(
  REPO_ROOT,
  'docs',
  'memory-evals',
  'phase-0-facts-only-baseline.json',
);

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs()', () => {
  it('defaults to the planted-needle mode', () => {
    const options = parseArgs([]);
    expect(options).toEqual({ mode: 'planted-needle', json: false });
  });

  it('accepts --json in planted-needle mode', () => {
    const options = parseArgs(['--json']);
    expect(options).toEqual({ mode: 'planted-needle', json: true });
  });

  it('parses the facts-only baseline mode with default fixture and stdout output', () => {
    const options = parseArgs(['--baseline', 'facts-only']);
    expect(options).toMatchObject({
      mode: 'baseline',
      baseline: 'facts-only',
      fixturePath: DEFAULT_FACTS_ONLY_FIXTURE_PATH,
      writePath: null,
      json: false,
    });
  });

  it('accepts --fixture and --write overrides in baseline mode', () => {
    const options = parseArgs([
      '--baseline',
      'facts-only',
      '--fixture',
      '/tmp/custom-fixture.json',
      '--write',
      '/tmp/out.json',
      '--json',
    ]);
    expect(options).toMatchObject({
      mode: 'baseline',
      baseline: 'facts-only',
      fixturePath: '/tmp/custom-fixture.json',
      writePath: '/tmp/out.json',
      json: true,
    });
  });

  it('rejects unknown baseline kinds', () => {
    expect(() => parseArgs(['--baseline', 'vector-only'])).toThrow(
      /--baseline must be one of: facts-only/,
    );
  });

  it('rejects --fixture and --write outside baseline mode', () => {
    expect(() => parseArgs(['--fixture', '/tmp/f.json'])).toThrow(/only valid with --baseline/);
    expect(() => parseArgs(['--write', '/tmp/out.json'])).toThrow(/only valid with --baseline/);
  });

  it('rejects unknown options', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown option: --nope/);
  });
});

// ---------------------------------------------------------------------------
// createFactsOnlyBaselineRanker
// ---------------------------------------------------------------------------

describe('createFactsOnlyBaselineRanker()', () => {
  it('drops drawer-evidence candidates and keeps only factId candidates', async () => {
    const ranker = createFactsOnlyBaselineRanker({ distractorCount: 1, seed: 42 });
    const candidates = await ranker({
      id: 'row-alpha',
      query: 'Which deployment format did the operator prefer?',
      category: 'AgentCTL-internal',
      expectedFacts: [{ id: 'fact:deployment-format', relevance: 3 }],
      expectedDrawerSources: [
        {
          sourceType: 'session-jsonl',
          sourceId: 'fixture-session-redacted-alpha',
          chunkIndex: 0,
          relevance: 2,
        },
      ],
      redactedAnswerHints: ['Operator preferred tarball deploys.'],
      tags: ['vocabulary-gap'],
      public: true,
    });

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((candidate) => typeof candidate.factId === 'string')).toBe(true);
    expect(
      candidates.every((candidate) => !candidate.drawerSource && !candidate.drawerSourceKey),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// percentileDuration
// ---------------------------------------------------------------------------

describe('percentileDuration()', () => {
  it('returns zero for an empty list', () => {
    expect(percentileDuration([], 0.95)).toBe(0);
  });

  it('returns the ceil-indexed percentile of a sorted list', () => {
    expect(percentileDuration([10, 20, 30, 40], 0.5)).toBe(20);
    expect(percentileDuration([10, 20, 30, 40], 0.95)).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// hashFixture
// ---------------------------------------------------------------------------

describe('hashFixture()', () => {
  it('is deterministic for the same bytes', () => {
    const tmp = path.join(os.tmpdir(), `fixture-${Date.now()}.json`);
    fs.writeFileSync(tmp, '{"hello":"world"}\n');
    try {
      const a = hashFixture(tmp);
      const b = hashFixture(tmp);
      expect(a).toBe(b);
      expect(a.startsWith('sha256:')).toBe(true);
      expect(a.length).toBe('sha256:'.length + 64);
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});

// ---------------------------------------------------------------------------
// runFactsOnlyBaseline and buildFactsOnlyBaselineSnapshot
// ---------------------------------------------------------------------------

describe('runFactsOnlyBaseline()', () => {
  it('produces a deterministic snapshot with no live dependencies', async () => {
    const fixedNow = () => new Date('2026-04-20T00:00:00.000Z');
    const resolveGitSha = () => 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

    const first = await runFactsOnlyBaseline({
      now: fixedNow,
      resolveGitSha,
    });
    const second = await runFactsOnlyBaseline({
      now: fixedNow,
      resolveGitSha,
    });

    expect(first).toEqual(second);
    expect(first.schemaVersion).toBe(1);
    expect(first.baseline).toBe('facts-only');
    expect(first.config.drawerPathEnabled).toBe(false);
    expect(first.config.vectorPathEnabled).toBe(false);
    expect(first.config.seed).toBe(42);
    expect(first.aggregate.totalRows).toBe(first.fixture.includedRowCount);
    expect(first.fixture.sha256.startsWith('sha256:')).toBe(true);
    expect(first.fixture.categories.length).toBeGreaterThan(0);
    expect(first.aggregate.recallAt5).toBeGreaterThanOrEqual(0);
    expect(first.aggregate.recallAt5).toBeLessThanOrEqual(1);
    expect(first.aggregate.p95DurationMs).toBeGreaterThanOrEqual(first.aggregate.p50DurationMs);
    expect(first.aggregate.p99DurationMs).toBeGreaterThanOrEqual(first.aggregate.p95DurationMs);
    expect(first.gitCommit).toBe('deadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
  });

  it('tolerates git failures by reporting gitCommit=null', async () => {
    const snapshot = await runFactsOnlyBaseline({
      now: () => new Date('2026-04-20T00:00:00.000Z'),
      resolveGitSha: () => null,
    });
    expect(snapshot.gitCommit).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// serializeFactsOnlyBaselineSnapshot
// ---------------------------------------------------------------------------

describe('serializeFactsOnlyBaselineSnapshot()', () => {
  it('emits pretty-printed JSON with a trailing newline', () => {
    const snapshot = buildFactsOnlyBaselineSnapshot({
      fixture: { version: 1, splitSeed: 42, rows: [] },
      fixtureAbsolutePath: '/tmp/fixture.json',
      fixtureRelativePath: 'docs/fixtures/memory-eval/fixture.json',
      fixtureSha256: 'sha256:abc',
      run: {
        rowResults: [],
        summary: {
          totalRows: 0,
          aggregate: {
            recallAt5: 0,
            recallAt10: 0,
            mrr: 0,
            ndcgAt10: 0,
            groundingCoverage: 0,
            drawerOnlyHitRate: 0,
          },
          p95DurationMs: 0,
          byCategory: {},
          byTag: {},
        },
      },
      createdAt: '2026-04-20T00:00:00.000Z',
      gitCommit: null,
    });

    const serialized = serializeFactsOnlyBaselineSnapshot(snapshot);
    expect(serialized.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(serialized);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.baseline).toBe('facts-only');
  });
});

// ---------------------------------------------------------------------------
// main() integration — mock-safe entry point smoke test
// ---------------------------------------------------------------------------

describe('main() --baseline facts-only smoke test (mock scorer, no live DB)', () => {
  let writeStdoutSpy: ReturnType<typeof vi.spyOn>;
  let writeStderrSpy: ReturnType<typeof vi.spyOn>;
  let writtenStdout: string[];
  let writtenStderr: string[];

  function captureStreamWrite(
    stream: NodeJS.WriteStream,
    sink: string[],
  ): ReturnType<typeof vi.spyOn> {
    const capture = (chunk: unknown): boolean => {
      if (typeof chunk === 'string') {
        sink.push(chunk);
      } else if (chunk instanceof Uint8Array) {
        sink.push(Buffer.from(chunk).toString('utf8'));
      }
      return true;
    };
    return vi.spyOn(stream, 'write').mockImplementation(capture as unknown as typeof stream.write);
  }

  beforeEach(() => {
    writtenStdout = [];
    writtenStderr = [];
    writeStdoutSpy = captureStreamWrite(process.stdout, writtenStdout);
    writeStderrSpy = captureStreamWrite(process.stderr, writtenStderr);
  });

  afterEach(() => {
    writeStdoutSpy.mockRestore();
    writeStderrSpy.mockRestore();
  });

  it('writes the snapshot to --write and prints a summary to stderr', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-bench-test-'));
    const writePath = path.join(tmpDir, 'baseline.json');

    try {
      await main(['--baseline', 'facts-only', '--write', writePath]);

      expect(fs.existsSync(writePath)).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(writePath, 'utf8'));
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.baseline).toBe('facts-only');
      expect(parsed.config.drawerPathEnabled).toBe(false);
      expect(typeof parsed.aggregate.recallAt5).toBe('number');
      expect(parsed.fixture.sha256.startsWith('sha256:')).toBe(true);

      expect(writtenStdout.join('')).toBe('');
      expect(writtenStderr.join('')).toMatch(/Phase 0 facts-only baseline written to/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('emits the snapshot JSON to stdout when --write is omitted', async () => {
    await main(['--baseline', 'facts-only', '--json']);

    const stdout = writtenStdout.join('');
    expect(stdout.length).toBeGreaterThan(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.baseline).toBe('facts-only');
  });
});

// ---------------------------------------------------------------------------
// Committed baseline file integrity
// ---------------------------------------------------------------------------

describe('committed phase-0 facts-only baseline snapshot', () => {
  it('exists in docs/memory-evals and matches the expected shape', () => {
    expect(fs.existsSync(COMMITTED_BASELINE_PATH)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(COMMITTED_BASELINE_PATH, 'utf8'));

    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.baseline).toBe('facts-only');
    expect(parsed.config.drawerPathEnabled).toBe(false);
    expect(parsed.config.vectorPathEnabled).toBe(false);
    expect(parsed.config.seed).toBe(42);
    expect(typeof parsed.aggregate.recallAt5).toBe('number');
    expect(typeof parsed.aggregate.p95DurationMs).toBe('number');
    expect(parsed.fixture.sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(Array.isArray(parsed.fixture.categories)).toBe(true);
    expect(parsed.fixture.categories.length).toBeGreaterThan(0);
  });

  it('records the same fixture hash as the live sample fixture', () => {
    const committed = JSON.parse(fs.readFileSync(COMMITTED_BASELINE_PATH, 'utf8'));
    const liveHash = hashFixture(DEFAULT_FACTS_ONLY_FIXTURE_PATH);
    expect(committed.fixture.sha256).toBe(liveHash);
  });
});
