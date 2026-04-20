import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  assertMemoryPlantedNeedleBenchPassed,
  createDeterministicMockRanker,
  loadMemoryEvalFixture,
  type MemoryEvalCandidate,
  type MemoryEvalFixtureFile,
  type MemoryEvalFixtureRow,
  type MemoryEvalMetricAverages,
  type MemoryEvalRanker,
  type MemoryEvalRun,
  runMemoryEval,
  runMemoryPlantedNeedleBench,
  summarizeMemoryEval,
} from '../packages/control-plane/src/memory/memory-eval.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
export const DEFAULT_FACTS_ONLY_FIXTURE_PATH = path.join(
  REPO_ROOT,
  'docs/fixtures/memory-eval/agentctl-memory-eval.sample.json',
);
export const DEFAULT_FACTS_ONLY_BASELINE_PATH = path.join(
  REPO_ROOT,
  'docs/memory-evals/phase-0-facts-only-baseline.json',
);

// ---------------------------------------------------------------------------
// CLI option types
// ---------------------------------------------------------------------------

export type BaselineMode = 'facts-only';

type DefaultBenchOptions = {
  mode: 'planted-needle';
  json: boolean;
};

type BaselineBenchOptions = {
  mode: 'baseline';
  baseline: BaselineMode;
  fixturePath: string;
  writePath: string | null;
  json: boolean;
};

type CliOptions = DefaultBenchOptions | BaselineBenchOptions;

// ---------------------------------------------------------------------------
// Baseline snapshot types
// ---------------------------------------------------------------------------

export type FactsOnlyBaselineCategorySummary = MemoryEvalMetricAverages & {
  totalRows: number;
  p95DurationMs: number;
};

export type FactsOnlyBaselineAggregate = MemoryEvalMetricAverages & {
  totalRows: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
};

export type FactsOnlyBaselineSnapshot = {
  schemaVersion: 1;
  baseline: 'facts-only';
  description: string;
  createdAt: string;
  gitCommit: string | null;
  fixture: {
    path: string;
    sha256: string;
    rowCount: number;
    includedRowCount: number;
    splitSeed: number;
    categories: string[];
  };
  config: {
    seed: number;
    rankerDistractorCount: number;
    drawerPathEnabled: false;
    vectorPathEnabled: false;
  };
  aggregate: FactsOnlyBaselineAggregate;
  byCategory: Record<string, FactsOnlyBaselineCategorySummary>;
};

// ---------------------------------------------------------------------------
// Constants for facts-only baseline
// ---------------------------------------------------------------------------

const FACTS_ONLY_BASELINE_SEED = 42;
const FACTS_ONLY_BASELINE_DISTRACTOR_COUNT = 4;
const FACTS_ONLY_BASELINE_SCHEMA_VERSION: 1 = 1;
const FACTS_ONLY_BASELINE_DESCRIPTION =
  'Phase 0 facts-only baseline for the MemPalace-inspired memory evolution plan. ' +
  'Deterministic mock ranking over the public sample fixture with the drawer and vector retrieval paths disabled. ' +
  'Provides a fixed target for later phases to compare against.';

// ---------------------------------------------------------------------------
// CLI usage / arg parsing
// ---------------------------------------------------------------------------

function usage(): string {
  return `Usage: pnpm memory:bench [--json]
       pnpm memory:bench --baseline facts-only [--fixture <path>] [--write <path>] [--json]

Modes:
  default                Runs the deterministic planted-needle recall regression bench.
  --baseline facts-only  Runs the Phase 0 facts-only baseline scorer with DRAWER and VECTOR paths disabled,
                         emitting a deterministic snapshot JSON (fixture hash, seed, per-category R@5/R@10/MRR/
                         NDCG@10/grounding/drawer-hit, p95 latency, aggregate rollup, git commit SHA, timestamp).

Options:
  --fixture <path>       Override the eval fixture path (defaults to the sanitized public sample).
  --write <path>         When present in baseline mode, write the snapshot to this path; stdout is emitted only with --json.
  --json                 Emit JSON only (no human-readable summary line on stderr).
  --help, -h             Show this message.

Environment for default mode: MEMORY_BENCH_NEEDLE_COUNT, MEMORY_BENCH_NOISE_COUNT, MEMORY_BENCH_MIN_RECALL.`;
}

export function parseArgs(argv: readonly string[]): CliOptions {
  let mode: 'planted-needle' | 'baseline' = 'planted-needle';
  let baseline: BaselineMode | null = null;
  let fixturePath: string | null = null;
  let writePath: string | null = null;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }

    if (arg === '--json') {
      json = true;
      continue;
    }

    if (arg === '--baseline') {
      const value = argv[index + 1];
      if (value !== 'facts-only') {
        throw new Error('--baseline must be one of: facts-only');
      }
      mode = 'baseline';
      baseline = value;
      index += 1;
      continue;
    }

    if (arg === '--fixture') {
      const value = argv[index + 1];
      if (!value) throw new Error('--fixture requires a path');
      fixturePath = path.resolve(value);
      index += 1;
      continue;
    }

    if (arg === '--write') {
      const value = argv[index + 1];
      if (!value) throw new Error('--write requires a path');
      writePath = path.resolve(value);
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  if (mode === 'baseline') {
    if (baseline === null) {
      throw new Error('Baseline mode requires --baseline facts-only');
    }
    return {
      mode: 'baseline',
      baseline,
      fixturePath: fixturePath ?? DEFAULT_FACTS_ONLY_FIXTURE_PATH,
      writePath,
      json,
    };
  }

  if (fixturePath !== null || writePath !== null) {
    throw new Error('--fixture and --write are only valid with --baseline');
  }

  return { mode: 'planted-needle', json };
}

// ---------------------------------------------------------------------------
// Facts-only ranker: wraps the deterministic mock ranker and drops any drawer
// evidence so only the fact-retrieval path contributes to scoring.
// ---------------------------------------------------------------------------

export function createFactsOnlyBaselineRanker(
  options: { distractorCount?: number; seed?: number } = {},
): MemoryEvalRanker {
  const base = createDeterministicMockRanker({
    distractorCount: options.distractorCount ?? FACTS_ONLY_BASELINE_DISTRACTOR_COUNT,
    seed: options.seed ?? FACTS_ONLY_BASELINE_SEED,
  });

  return async (row) => {
    const candidates = await base(row);
    return candidates
      .filter((candidate): candidate is MemoryEvalCandidate => {
        if (candidate.drawerSource || candidate.drawerSourceKey) return false;
        return typeof candidate.factId === 'string' && candidate.factId.length > 0;
      })
      .map((candidate) => ({ ...candidate }));
  };
}

// ---------------------------------------------------------------------------
// Latency and snapshot helpers
// ---------------------------------------------------------------------------

export function percentileDuration(values: readonly number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentile) - 1));
  return sorted[index] ?? 0;
}

export function hashFixture(absolutePath: string): string {
  const bytes = fs.readFileSync(absolutePath);
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function resolveGitCommitSha(cwd: string = REPO_ROOT): string | null {
  try {
    const output = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
    const trimmed = output.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Facts-only baseline snapshot builder (pure — easy to unit test)
// ---------------------------------------------------------------------------

export type BuildFactsOnlyBaselineInput = {
  fixture: MemoryEvalFixtureFile;
  fixtureAbsolutePath: string;
  fixtureRelativePath: string;
  fixtureSha256: string;
  run: MemoryEvalRun;
  createdAt: string;
  gitCommit: string | null;
};

export function buildFactsOnlyBaselineSnapshot(
  input: BuildFactsOnlyBaselineInput,
): FactsOnlyBaselineSnapshot {
  const durations = input.run.rowResults.map((row) => row.durationMs);
  const aggregate: FactsOnlyBaselineAggregate = {
    ...input.run.summary.aggregate,
    totalRows: input.run.summary.totalRows,
    p50DurationMs: percentileDuration(durations, 0.5),
    p95DurationMs: percentileDuration(durations, 0.95),
    p99DurationMs: percentileDuration(durations, 0.99),
  };

  const byCategory: Record<string, FactsOnlyBaselineCategorySummary> = {};
  for (const [category, segment] of Object.entries(input.run.summary.byCategory)) {
    byCategory[category] = {
      totalRows: segment.totalRows,
      recallAt5: segment.recallAt5,
      recallAt10: segment.recallAt10,
      mrr: segment.mrr,
      ndcgAt10: segment.ndcgAt10,
      groundingCoverage: segment.groundingCoverage,
      drawerOnlyHitRate: segment.drawerOnlyHitRate,
      p95DurationMs: segment.p95DurationMs,
    };
  }

  const categories = [...new Set(input.fixture.rows.map((row) => row.category))].sort(
    (left, right) => left.localeCompare(right),
  );
  const includedRowCount = input.fixture.rows.filter((row) => !row.excluded).length;

  return {
    schemaVersion: FACTS_ONLY_BASELINE_SCHEMA_VERSION,
    baseline: 'facts-only',
    description: FACTS_ONLY_BASELINE_DESCRIPTION,
    createdAt: input.createdAt,
    gitCommit: input.gitCommit,
    fixture: {
      path: input.fixtureRelativePath,
      sha256: input.fixtureSha256,
      rowCount: input.fixture.rows.length,
      includedRowCount,
      splitSeed: input.fixture.splitSeed,
      categories,
    },
    config: {
      seed: FACTS_ONLY_BASELINE_SEED,
      rankerDistractorCount: FACTS_ONLY_BASELINE_DISTRACTOR_COUNT,
      drawerPathEnabled: false,
      vectorPathEnabled: false,
    },
    aggregate,
    byCategory,
  };
}

// ---------------------------------------------------------------------------
// Facts-only baseline runner
// ---------------------------------------------------------------------------

export type RunFactsOnlyBaselineOptions = {
  fixturePath?: string;
  ranker?: MemoryEvalRanker;
  now?: () => Date;
  resolveGitSha?: (cwd: string) => string | null;
  repoRoot?: string;
};

export async function runFactsOnlyBaseline(
  options: RunFactsOnlyBaselineOptions = {},
): Promise<FactsOnlyBaselineSnapshot> {
  const fixtureAbsolutePath = path.resolve(options.fixturePath ?? DEFAULT_FACTS_ONLY_FIXTURE_PATH);
  const fixture = loadMemoryEvalFixture(fixtureAbsolutePath);
  const ranker = options.ranker ?? createFactsOnlyBaselineRanker();
  const repoRoot = options.repoRoot ?? REPO_ROOT;

  const includedRows: MemoryEvalFixtureRow[] = fixture.rows.filter((row) => !row.excluded);
  const run = await runMemoryEval(includedRows, ranker);

  // Re-summarize across the full set so empty categories still appear if we
  // ever include excluded rows in the fixture file. The summarizeMemoryEval
  // call is idempotent on an already-scored row list.
  const run2: MemoryEvalRun = {
    rowResults: run.rowResults,
    summary: summarizeMemoryEval(run.rowResults),
  };

  const createdAt = (options.now?.() ?? new Date()).toISOString();
  const gitCommit = (options.resolveGitSha ?? resolveGitCommitSha)(repoRoot);

  const relativePath = path.relative(repoRoot, fixtureAbsolutePath).split(path.sep).join('/');

  return buildFactsOnlyBaselineSnapshot({
    fixture,
    fixtureAbsolutePath,
    fixtureRelativePath: relativePath,
    fixtureSha256: hashFixture(fixtureAbsolutePath),
    run: run2,
    createdAt,
    gitCommit,
  });
}

export function serializeFactsOnlyBaselineSnapshot(snapshot: FactsOnlyBaselineSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);

  if (options.mode === 'baseline') {
    const snapshot = await runFactsOnlyBaseline({ fixturePath: options.fixturePath });
    const serialized = serializeFactsOnlyBaselineSnapshot(snapshot);

    if (options.writePath) {
      const targetDir = path.dirname(options.writePath);
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(options.writePath, serialized, 'utf8');
    }

    if (options.json || options.writePath === null) {
      process.stdout.write(serialized);
    }

    if (!options.json) {
      const r5 = snapshot.aggregate.recallAt5.toFixed(3);
      const r10 = snapshot.aggregate.recallAt10.toFixed(3);
      const p95 = snapshot.aggregate.p95DurationMs;
      const destination = options.writePath ?? '(stdout)';
      process.stderr.write(
        `# Phase 0 facts-only baseline written to ${destination}\n` +
          `Rows=${snapshot.aggregate.totalRows} R@5=${r5} R@10=${r10} p95=${p95}ms fixture=${snapshot.fixture.sha256}\n`,
      );
    }
    return;
  }

  const run = await runMemoryPlantedNeedleBench();

  if (options.json) {
    console.log(JSON.stringify(run, null, 2));
    assertMemoryPlantedNeedleBenchPassed(run);
    return;
  }

  console.log('# Memory Planted-Needle Bench');
  console.log('');
  console.log(`Rows: ${run.summary.totalRows}`);
  console.log(`Recall@5: ${run.summary.aggregate.recallAt5.toFixed(3)}`);
  console.log(`Required: ${run.config.minRecallAt5.toFixed(3)}`);
  console.log(
    `Latency ms: p50=${run.latency.p50DurationMs}, p95=${run.latency.p95DurationMs}, p99=${run.latency.p99DurationMs}`,
  );
  assertMemoryPlantedNeedleBenchPassed(run);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
