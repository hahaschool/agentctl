import fs from 'node:fs';
import { performance } from 'node:perf_hooks';

export const EVAL_SPLIT_SEED = 42;
export const DEV_SPLIT_RATIO = 0.1;
export const DEFAULT_MEMORY_BENCH_NEEDLE_COUNT = 100;
export const DEFAULT_MEMORY_BENCH_NOISE_COUNT = 2_000;
export const DEFAULT_MEMORY_BENCH_MIN_RECALL = 0.85;
export const DEFAULT_FAILURE_MODE_TAGS = [
  'vocabulary-gap',
  'temporal-ambiguity',
  'assistant-reference',
  'person-name-underweighting',
  'noisy-distractor-rejection',
] as const;

export type MemoryEvalFailureModeTag = (typeof DEFAULT_FAILURE_MODE_TAGS)[number];

export type MemoryEvalExpectedFact = {
  id: string;
  relevance?: number;
};

export type MemoryEvalDrawerSource = {
  sourceType: string;
  sourceId: string;
  chunkIndex?: number | null;
  relevance?: number;
};

export type MemoryEvalFixtureRow = {
  id: string;
  query: string;
  category: string;
  expectedFacts: MemoryEvalExpectedFact[];
  expectedDrawerSources: MemoryEvalDrawerSource[];
  redactedAnswerHints: string[];
  tags: string[];
  public: boolean;
  excluded?: boolean;
  exclusionReason?: string;
};

export type MemoryEvalFixtureFile = {
  version: 1;
  splitSeed: typeof EVAL_SPLIT_SEED;
  description?: string;
  rows: MemoryEvalFixtureRow[];
};

export type MemoryEvalCandidate = {
  id: string;
  score: number;
  factId?: string;
  drawerSource?: MemoryEvalDrawerSource;
  drawerSourceKey?: string;
  metadata?: Record<string, unknown>;
};

export type MemoryEvalRowResult = {
  fixtureId: string;
  query: string;
  category: string;
  tags: string[];
  recallAt5: number;
  recallAt10: number;
  mrr: number;
  ndcgAt10: number;
  groundingCoverage: number;
  drawerOnlyHitRate: number;
  durationMs: number;
  firstRelevantRank: number | null;
  expectedCount: number;
  expectedDrawerSourceCount: number;
  matchedExpectedKeys: string[];
  matchedExpectedKeysAt5: string[];
  matchedExpectedKeysAt10: string[];
  rankedResultKeys: string[];
};

export type MemoryEvalMetricAverages = {
  recallAt5: number;
  recallAt10: number;
  mrr: number;
  ndcgAt10: number;
  groundingCoverage: number;
  drawerOnlyHitRate: number;
};

export type MemoryEvalSegmentSummary = MemoryEvalMetricAverages & {
  totalRows: number;
  p95DurationMs: number;
};

export type MemoryEvalSummary = {
  totalRows: number;
  aggregate: MemoryEvalMetricAverages;
  p95DurationMs: number;
  byCategory: Record<string, MemoryEvalSegmentSummary>;
  byTag: Record<string, MemoryEvalSegmentSummary>;
};

export type MemoryEvalRun = {
  rowResults: MemoryEvalRowResult[];
  summary: MemoryEvalSummary;
};

export type MemoryEvalRanker = (
  row: MemoryEvalFixtureRow,
) => Promise<MemoryEvalCandidate[]> | MemoryEvalCandidate[];

export type MemoryEvalSplitOptions = {
  seed?: number;
};

export type MemoryEvalFullSetOptions = {
  allowFullSet?: boolean;
};

export type MemoryPlantedNeedleBenchEnv = Record<string, string | undefined>;

export type MemoryPlantedNeedleBenchConfig = {
  needleCount: number;
  noiseCount: number;
  minRecallAt5: number;
  seed: number;
};

export type MemoryPlantedNeedleBenchOptions = Partial<MemoryPlantedNeedleBenchConfig> & {
  env?: MemoryPlantedNeedleBenchEnv;
};

export type MemoryPlantedNeedleMockRankerOptions = {
  needleRank?: number;
  noiseCount?: number;
  seed?: number;
};

export type MemoryPlantedNeedleBenchLatency = {
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
};

export type MemoryPlantedNeedleBenchRun = MemoryEvalRun & {
  config: MemoryPlantedNeedleBenchConfig;
  latency: MemoryPlantedNeedleBenchLatency;
  passed: boolean;
};

type ExpectedEvidence = {
  key: string;
  relevance: number;
  kind: 'fact' | 'drawer';
};

const RAW_SECRET_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    label: 'private key',
  },
  {
    pattern: /\bsk-(?:live|test|proj|ant|svc)?-?[A-Za-z0-9_-]{20,}\b/i,
    label: 'OpenAI-style API key',
  },
  {
    pattern: /\b(?:ghp|github_pat|glpat|xox[baprs])-[A-Za-z0-9_-]{20,}\b/i,
    label: 'platform token',
  },
  {
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
    label: 'AWS access key',
  },
];

const INTERNAL_ID_PATTERN =
  /\b(?:session|sess|agent|run|drawer|thread|user)_[A-Za-z0-9][A-Za-z0-9_-]{7,}\b/i;
const LOCAL_PATH_PATTERN = /\/Users\/[A-Za-z0-9._-]+/;

export function toDrawerSourceKey(source: MemoryEvalDrawerSource): string {
  return `${source.sourceType}:${source.sourceId}:${source.chunkIndex ?? 0}`;
}

export function loadMemoryEvalFixture(path: string): MemoryEvalFixtureFile {
  const raw = JSON.parse(fs.readFileSync(path, 'utf8')) as unknown;
  return assertSanitizedMemoryEvalFixture(raw);
}

export function assertSanitizedMemoryEvalFixture(raw: unknown): MemoryEvalFixtureFile {
  const fixture = parseMemoryEvalFixture(raw);
  assertNoUnsafeFixtureStrings(fixture);
  return fixture;
}

export function assertFailureModeCoverage(
  rows: readonly MemoryEvalFixtureRow[],
  options: {
    requiredTags?: readonly string[];
    minimumPerTag?: number;
  } = {},
): void {
  const requiredTags = options.requiredTags ?? DEFAULT_FAILURE_MODE_TAGS;
  const minimumPerTag = options.minimumPerTag ?? 5;
  const counts = new Map<string, number>();

  for (const row of rows) {
    if (row.excluded) continue;
    for (const tag of row.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  const misses = requiredTags.filter((tag) => (counts.get(tag) ?? 0) < minimumPerTag);
  if (misses.length > 0) {
    throw new Error(
      `Memory eval fixture coverage is below ${minimumPerTag} rows for tags: ${misses.join(', ')}`,
    );
  }
}

export function getDevSet(
  rows: readonly MemoryEvalFixtureRow[],
  options: MemoryEvalSplitOptions = {},
): MemoryEvalFixtureRow[] {
  const includedRows = rows.filter((row) => !row.excluded);
  if (includedRows.length === 0) return [];

  const devCount = Math.max(1, Math.ceil(includedRows.length * DEV_SPLIT_RATIO));
  return splitRows(includedRows, options.seed ?? EVAL_SPLIT_SEED).slice(0, devCount);
}

export function getHeldOutSet(
  rows: readonly MemoryEvalFixtureRow[],
  options: MemoryEvalSplitOptions = {},
): MemoryEvalFixtureRow[] {
  const includedRows = rows.filter((row) => !row.excluded);
  if (includedRows.length === 0) return [];

  const devIds = new Set(getDevSet(includedRows, options).map((row) => row.id));
  return includedRows.filter((row) => !devIds.has(row.id));
}

export function getFullSet(
  rows: readonly MemoryEvalFixtureRow[],
  options: MemoryEvalFullSetOptions = {},
): MemoryEvalFixtureRow[] {
  if (!options.allowFullSet && process.env.MEMORY_EVAL_ALLOW_FULL_SET !== 'true') {
    throw new Error(
      'Full memory eval set is reserved for release eval jobs. Use getDevSet() for tuning.',
    );
  }

  return rows.filter((row) => !row.excluded);
}

export function scoreMemoryEvalRow(
  row: MemoryEvalFixtureRow,
  candidates: readonly MemoryEvalCandidate[],
  durationMs: number,
): MemoryEvalRowResult {
  const expectedEvidence = buildExpectedEvidence(row);
  const expectedByKey = new Map(expectedEvidence.map((entry) => [entry.key, entry]));
  const consumedForNdcg = new Set<string>();
  const matchedAll = new Set<string>();
  const matchedAt5 = new Set<string>();
  const matchedAt10 = new Set<string>();
  const matchedDrawerAt10 = new Set<string>();
  const rankGrades: number[] = [];
  let firstRelevantRank: number | null = null;

  const rankedResultKeys = candidates.map((candidate) => getCandidateDisplayKey(candidate));

  candidates.forEach((candidate, index) => {
    const rank = index + 1;
    const matchingKeys = getCandidateExpectedKeys(candidate).filter((key) =>
      expectedByKey.has(key),
    );
    const newMatches = matchingKeys.filter((key) => !matchedAll.has(key));

    if (newMatches.length > 0) {
      if (firstRelevantRank === null) {
        firstRelevantRank = rank;
      }

      for (const key of newMatches) {
        matchedAll.add(key);
        if (rank <= 5) matchedAt5.add(key);
        if (rank <= 10) matchedAt10.add(key);
        if (rank <= 10 && expectedByKey.get(key)?.kind === 'drawer') {
          matchedDrawerAt10.add(key);
        }
      }
    }

    if (rank <= 10) {
      const ndcgMatches = matchingKeys.filter((key) => !consumedForNdcg.has(key));
      const grade = ndcgMatches.reduce(
        (maxRelevance, key) => Math.max(maxRelevance, expectedByKey.get(key)?.relevance ?? 0),
        0,
      );
      rankGrades.push(grade);
      for (const key of ndcgMatches) {
        consumedForNdcg.add(key);
      }
    }
  });

  const expectedCount = expectedEvidence.length;
  const expectedDrawerSourceCount = expectedEvidence.filter(
    (entry) => entry.kind === 'drawer',
  ).length;
  const expectedDrawerKeys = expectedEvidence
    .filter((entry) => entry.kind === 'drawer')
    .map((entry) => entry.key);
  const drawerMatchesAt10 = expectedDrawerKeys.filter((key) => matchedDrawerAt10.has(key)).length;

  return {
    fixtureId: row.id,
    query: row.query,
    category: row.category,
    tags: [...row.tags],
    recallAt5: divideOrOne(matchedAt5.size, expectedCount),
    recallAt10: divideOrOne(matchedAt10.size, expectedCount),
    mrr: firstRelevantRank === null ? 0 : 1 / firstRelevantRank,
    ndcgAt10: calculateNdcgAt10(
      rankGrades,
      expectedEvidence.map((entry) => entry.relevance),
    ),
    groundingCoverage: divideOrOne(drawerMatchesAt10, expectedDrawerSourceCount),
    drawerOnlyHitRate: divideOrOne(drawerMatchesAt10, expectedDrawerSourceCount),
    durationMs,
    firstRelevantRank,
    expectedCount,
    expectedDrawerSourceCount,
    matchedExpectedKeys: [...matchedAll],
    matchedExpectedKeysAt5: [...matchedAt5],
    matchedExpectedKeysAt10: [...matchedAt10],
    rankedResultKeys,
  };
}

export function summarizeMemoryEval(rowResults: readonly MemoryEvalRowResult[]): MemoryEvalSummary {
  return {
    totalRows: rowResults.length,
    aggregate: summarizeAverages(rowResults),
    p95DurationMs: percentileDuration(rowResults, 0.95),
    byCategory: summarizeSegments(rowResults, (row) => [row.category]),
    byTag: summarizeSegments(rowResults, (row) => row.tags),
  };
}

export function formatMemoryEvalMarkdown(summary: MemoryEvalSummary): string {
  const rows = [
    formatSummaryRow('all', summary.totalRows, summary.aggregate, summary.p95DurationMs),
    ...Object.entries(summary.byCategory)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([category, segment]) =>
        formatSummaryRow(
          `category: ${category}`,
          segment.totalRows,
          segment,
          segment.p95DurationMs,
        ),
      ),
  ];

  return [
    '| Segment | Rows | R@5 | R@10 | MRR | NDCG@10 | Grounding | Drawer hit | p95 ms |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows,
  ].join('\n');
}

export async function runMemoryEval(
  rows: readonly MemoryEvalFixtureRow[],
  ranker: MemoryEvalRanker,
): Promise<MemoryEvalRun> {
  const rowResults: MemoryEvalRowResult[] = [];

  for (const row of rows) {
    if (row.excluded) continue;

    const startedAt = performance.now();
    const candidates = await ranker(row);
    const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
    rowResults.push(scoreMemoryEvalRow(row, candidates, durationMs));
  }

  return {
    rowResults,
    summary: summarizeMemoryEval(rowResults),
  };
}

export function createDeterministicMockRanker(
  options: { distractorCount?: number; seed?: number } = {},
): MemoryEvalRanker {
  const distractorCount = options.distractorCount ?? 3;
  const seed = options.seed ?? EVAL_SPLIT_SEED;

  return (row) => {
    const relevantCandidates = buildExpectedEvidence(row)
      .sort((left, right) => right.relevance - left.relevance || left.key.localeCompare(right.key))
      .map((entry, index): MemoryEvalCandidate => {
        if (entry.kind === 'fact') {
          return {
            id: `mock:${row.id}:${entry.key}`,
            factId: entry.key.slice('fact:'.length),
            score: 1 - index * 0.01,
          };
        }

        return {
          id: `mock:${row.id}:${entry.key}`,
          drawerSourceKey: entry.key.slice('drawer:'.length),
          score: 1 - index * 0.01,
        };
      });

    const distractors = Array.from(
      { length: distractorCount },
      (_, index): MemoryEvalCandidate => ({
        id: `mock:${row.id}:distractor:${index}`,
        factId: `fact:mock-distractor:${stableHash(`${seed}:${row.id}:${index}`).toString(36)}`,
        score: 0.1 - index * 0.001,
      }),
    );

    return [...relevantCandidates, ...distractors];
  };
}

export function resolveMemoryPlantedNeedleBenchConfig(
  options: MemoryPlantedNeedleBenchOptions = {},
): MemoryPlantedNeedleBenchConfig {
  const env = options.env ?? process.env;
  return {
    needleCount:
      options.needleCount === undefined
        ? readPositiveIntegerEnv(
            env,
            'MEMORY_BENCH_NEEDLE_COUNT',
            DEFAULT_MEMORY_BENCH_NEEDLE_COUNT,
          )
        : requirePositiveInteger(options.needleCount, 'needleCount'),
    noiseCount:
      options.noiseCount === undefined
        ? readPositiveIntegerEnv(env, 'MEMORY_BENCH_NOISE_COUNT', DEFAULT_MEMORY_BENCH_NOISE_COUNT)
        : requirePositiveInteger(options.noiseCount, 'noiseCount'),
    minRecallAt5:
      options.minRecallAt5 === undefined
        ? readRecallThresholdEnv(env, 'MEMORY_BENCH_MIN_RECALL', DEFAULT_MEMORY_BENCH_MIN_RECALL)
        : requireRecallThreshold(options.minRecallAt5, 'minRecallAt5'),
    seed: options.seed ?? EVAL_SPLIT_SEED,
  };
}

export function createMemoryPlantedNeedleRows(
  options: { needleCount?: number; seed?: number } = {},
): MemoryEvalFixtureRow[] {
  const needleCount = requirePositiveInteger(
    options.needleCount ?? DEFAULT_MEMORY_BENCH_NEEDLE_COUNT,
    'needleCount',
  );
  const seed = options.seed ?? EVAL_SPLIT_SEED;

  return Array.from({ length: needleCount }, (_, index): MemoryEvalFixtureRow => {
    const indexLabel = String(index).padStart(3, '0');
    const needleId = `NEEDLE_${seed}_${indexLabel}`;
    const payload = `synthetic operator memory payload ${indexLabel} seed ${seed}`;

    return {
      id: `planted-needle-${indexLabel}`,
      query: `Recall ${payload}`,
      category: 'AgentCTL-planted-needle',
      expectedFacts: [{ id: needleId, relevance: 3 }],
      expectedDrawerSources: [],
      redactedAnswerHints: [`${needleId}: ${payload}`],
      tags: ['noisy-distractor-rejection'],
      public: true,
    };
  });
}

export function createMemoryPlantedNeedleMockRanker(
  options: MemoryPlantedNeedleMockRankerOptions = {},
): MemoryEvalRanker {
  const noiseCount = requirePositiveInteger(
    options.noiseCount ?? DEFAULT_MEMORY_BENCH_NOISE_COUNT,
    'noiseCount',
  );
  const needleRank = requirePositiveInteger(options.needleRank ?? 1, 'needleRank');
  const seed = options.seed ?? EVAL_SPLIT_SEED;

  return (row) => {
    const [needle] = row.expectedFacts;
    if (!needle) return [];

    const noiseBeforeNeedle = Math.min(noiseCount, needleRank - 1);
    const before = Array.from({ length: noiseBeforeNeedle }, (_, index) =>
      createPlantedNeedleNoiseCandidate(row, seed, index, 2 - index * 0.001),
    );
    const after = Array.from({ length: noiseCount - noiseBeforeNeedle }, (_, index) =>
      createPlantedNeedleNoiseCandidate(row, seed, noiseBeforeNeedle + index, 0.1 - index * 0.001),
    );
    const needleCandidate: MemoryEvalCandidate = {
      id: `bench:${row.id}:${needle.id}`,
      factId: needle.id,
      score: 1,
    };

    return [...before, needleCandidate, ...after];
  };
}

export async function runMemoryPlantedNeedleBench(
  options: MemoryPlantedNeedleBenchOptions = {},
  ranker?: MemoryEvalRanker,
): Promise<MemoryPlantedNeedleBenchRun> {
  const config = resolveMemoryPlantedNeedleBenchConfig(options);
  const rows = createMemoryPlantedNeedleRows({
    needleCount: config.needleCount,
    seed: config.seed,
  });
  const evalRun = await runMemoryEval(rows, ranker ?? createMemoryPlantedNeedleMockRanker(config));
  const latency = summarizeBenchLatency(evalRun.rowResults);
  const passed = evalRun.summary.aggregate.recallAt5 >= config.minRecallAt5;

  return {
    ...evalRun,
    config,
    latency,
    passed,
  };
}

export function assertMemoryPlantedNeedleBenchPassed(run: MemoryPlantedNeedleBenchRun): void {
  if (run.passed) return;

  throw new Error(
    `Planted-needle recall@5 ${formatMetric(
      run.summary.aggregate.recallAt5,
    )} is below required minimum ${formatMetric(run.config.minRecallAt5)}`,
  );
}

function createPlantedNeedleNoiseCandidate(
  row: MemoryEvalFixtureRow,
  seed: number,
  index: number,
  score: number,
): MemoryEvalCandidate {
  return {
    id: `bench:${row.id}:noise:${index}`,
    factId: `noise:${stableHash(`${seed}:${row.id}:noise:${index}`).toString(36)}`,
    score,
  };
}

function summarizeBenchLatency(
  rowResults: readonly MemoryEvalRowResult[],
): MemoryPlantedNeedleBenchLatency {
  return {
    p50DurationMs: percentileDuration(rowResults, 0.5),
    p95DurationMs: percentileDuration(rowResults, 0.95),
    p99DurationMs: percentileDuration(rowResults, 0.99),
  };
}

function readPositiveIntegerEnv(
  env: MemoryPlantedNeedleBenchEnv,
  name: string,
  defaultValue: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return defaultValue;
  const parsed = Number(raw);
  return requirePositiveInteger(parsed, name);
}

function readRecallThresholdEnv(
  env: MemoryPlantedNeedleBenchEnv,
  name: string,
  defaultValue: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return defaultValue;
  const parsed = Number(raw);
  return requireRecallThreshold(parsed, name);
}

function parseMemoryEvalFixture(raw: unknown): MemoryEvalFixtureFile {
  const record = requireRecord(raw, 'fixture');
  const version = requireNumber(record.version, 'fixture.version');
  const splitSeed = requireNumber(record.splitSeed, 'fixture.splitSeed');
  const rowsValue = record.rows;

  if (version !== 1) {
    throw new Error(`Unsupported memory eval fixture version: ${version}`);
  }
  if (splitSeed !== EVAL_SPLIT_SEED) {
    throw new Error(`Memory eval fixture splitSeed must be ${EVAL_SPLIT_SEED}`);
  }
  if (!Array.isArray(rowsValue)) {
    throw new Error('Memory eval fixture rows must be an array');
  }

  const rows = rowsValue.map((row, index) => parseFixtureRow(row, `fixture.rows[${index}]`));
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) {
      throw new Error(`Duplicate memory eval fixture id: ${row.id}`);
    }
    seen.add(row.id);
  }

  return {
    version: 1,
    splitSeed: EVAL_SPLIT_SEED,
    description:
      typeof record.description === 'string' && record.description.trim()
        ? record.description
        : undefined,
    rows,
  };
}

function parseFixtureRow(raw: unknown, path: string): MemoryEvalFixtureRow {
  const record = requireRecord(raw, path);
  const expectedFacts = requireArray(record.expectedFacts, `${path}.expectedFacts`).map(
    (item, index) => parseExpectedFact(item, `${path}.expectedFacts[${index}]`),
  );
  const expectedDrawerSources = requireArray(
    record.expectedDrawerSources,
    `${path}.expectedDrawerSources`,
  ).map((item, index) => parseDrawerSource(item, `${path}.expectedDrawerSources[${index}]`));

  if (expectedFacts.length === 0 && expectedDrawerSources.length === 0) {
    throw new Error(`${path} must include at least one expected fact or drawer source`);
  }

  const excluded =
    record.excluded === undefined ? undefined : requireBoolean(record.excluded, `${path}.excluded`);
  const exclusionReason =
    typeof record.exclusionReason === 'string' && record.exclusionReason.trim()
      ? record.exclusionReason
      : undefined;

  if (excluded && !exclusionReason) {
    throw new Error(`${path}.exclusionReason is required when excluded is true`);
  }

  return {
    id: requireNonEmptyString(record.id, `${path}.id`),
    query: requireNonEmptyString(record.query, `${path}.query`),
    category: requireNonEmptyString(record.category, `${path}.category`),
    expectedFacts,
    expectedDrawerSources,
    redactedAnswerHints: requireStringArray(
      record.redactedAnswerHints,
      `${path}.redactedAnswerHints`,
    ),
    tags: requireStringArray(record.tags, `${path}.tags`),
    public: requireBoolean(record.public, `${path}.public`),
    excluded,
    exclusionReason,
  };
}

function parseExpectedFact(raw: unknown, path: string): MemoryEvalExpectedFact {
  const record = requireRecord(raw, path);
  return {
    id: requireNonEmptyString(record.id, `${path}.id`),
    relevance: parseRelevance(record.relevance, `${path}.relevance`),
  };
}

function parseDrawerSource(raw: unknown, path: string): MemoryEvalDrawerSource {
  const record = requireRecord(raw, path);
  return {
    sourceType: requireNonEmptyString(record.sourceType, `${path}.sourceType`),
    sourceId: requireNonEmptyString(record.sourceId, `${path}.sourceId`),
    chunkIndex:
      record.chunkIndex === undefined || record.chunkIndex === null
        ? 0
        : requireNonNegativeInteger(record.chunkIndex, `${path}.chunkIndex`),
    relevance: parseRelevance(record.relevance, `${path}.relevance`),
  };
}

function parseRelevance(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  const relevance = requireNumber(value, path);
  if (!Number.isFinite(relevance) || relevance <= 0) {
    throw new Error(`${path} must be a positive finite number`);
  }
  return relevance;
}

function assertNoUnsafeFixtureStrings(fixture: MemoryEvalFixtureFile): void {
  for (const [path, value] of walkStrings(fixture)) {
    for (const { pattern, label } of RAW_SECRET_PATTERNS) {
      if (pattern.test(value)) {
        throw new Error(`Memory eval fixture contains raw-looking secret (${label}) at ${path}`);
      }
    }

    if (INTERNAL_ID_PATTERN.test(value) && !/redacted/i.test(value)) {
      throw new Error(`Memory eval fixture contains unredacted internal id at ${path}`);
    }

    if (LOCAL_PATH_PATTERN.test(value) && !/redacted/i.test(value)) {
      throw new Error(`Memory eval fixture contains unredacted local path at ${path}`);
    }
  }
}

function* walkStrings(value: unknown, path = 'fixture'): Generator<[string, string]> {
  if (typeof value === 'string') {
    yield [path, value];
    return;
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      yield* walkStrings(item, `${path}[${index}]`);
    }
    return;
  }

  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      yield* walkStrings(item, `${path}.${key}`);
    }
  }
}

function buildExpectedEvidence(row: MemoryEvalFixtureRow): ExpectedEvidence[] {
  const entries = [
    ...row.expectedFacts.map(
      (fact): ExpectedEvidence => ({
        key: `fact:${fact.id}`,
        relevance: fact.relevance ?? 1,
        kind: 'fact',
      }),
    ),
    ...row.expectedDrawerSources.map(
      (source): ExpectedEvidence => ({
        key: `drawer:${toDrawerSourceKey(source)}`,
        relevance: source.relevance ?? 1,
        kind: 'drawer',
      }),
    ),
  ];
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.key)) return false;
    seen.add(entry.key);
    return true;
  });
}

function getCandidateExpectedKeys(candidate: MemoryEvalCandidate): string[] {
  const keys: string[] = [];

  if (candidate.factId) {
    keys.push(`fact:${candidate.factId}`);
  }

  const drawerKey =
    candidate.drawerSourceKey ??
    (candidate.drawerSource ? toDrawerSourceKey(candidate.drawerSource) : undefined);
  if (drawerKey) {
    keys.push(drawerKey.startsWith('drawer:') ? drawerKey : `drawer:${drawerKey}`);
  }

  return keys;
}

function getCandidateDisplayKey(candidate: MemoryEvalCandidate): string {
  const [expectedKey] = getCandidateExpectedKeys(candidate);
  return expectedKey ?? candidate.id;
}

function calculateNdcgAt10(
  rankGrades: readonly number[],
  idealRelevances: readonly number[],
): number {
  const dcg = rankGrades
    .slice(0, 10)
    .reduce((sum, relevance, index) => sum + discountedGain(relevance, index + 1), 0);
  const idealDcg = [...idealRelevances]
    .sort((left, right) => right - left)
    .slice(0, 10)
    .reduce((sum, relevance, index) => sum + discountedGain(relevance, index + 1), 0);

  return idealDcg === 0 ? 1 : dcg / idealDcg;
}

function discountedGain(relevance: number, rank: number): number {
  if (relevance <= 0) return 0;
  return (2 ** relevance - 1) / Math.log2(rank + 1);
}

function summarizeSegments(
  rowResults: readonly MemoryEvalRowResult[],
  getSegmentNames: (row: MemoryEvalRowResult) => readonly string[],
): Record<string, MemoryEvalSegmentSummary> {
  const grouped = new Map<string, MemoryEvalRowResult[]>();
  for (const row of rowResults) {
    for (const segmentName of getSegmentNames(row)) {
      const rows = grouped.get(segmentName) ?? [];
      rows.push(row);
      grouped.set(segmentName, rows);
    }
  }

  return Object.fromEntries(
    [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, rows]) => [
        name,
        {
          totalRows: rows.length,
          ...summarizeAverages(rows),
          p95DurationMs: percentileDuration(rows, 0.95),
        },
      ]),
  );
}

function summarizeAverages(rowResults: readonly MemoryEvalRowResult[]): MemoryEvalMetricAverages {
  if (rowResults.length === 0) {
    return {
      recallAt5: 0,
      recallAt10: 0,
      mrr: 0,
      ndcgAt10: 0,
      groundingCoverage: 0,
      drawerOnlyHitRate: 0,
    };
  }

  const drawerExpectedTotal = rowResults.reduce(
    (sum, row) => sum + row.expectedDrawerSourceCount,
    0,
  );
  const drawerMatchedTotal = rowResults.reduce(
    (sum, row) => sum + row.drawerOnlyHitRate * row.expectedDrawerSourceCount,
    0,
  );

  return {
    recallAt5: average(rowResults.map((row) => row.recallAt5)),
    recallAt10: average(rowResults.map((row) => row.recallAt10)),
    mrr: average(rowResults.map((row) => row.mrr)),
    ndcgAt10: average(rowResults.map((row) => row.ndcgAt10)),
    groundingCoverage: divideOrZero(drawerMatchedTotal, drawerExpectedTotal),
    drawerOnlyHitRate: divideOrZero(drawerMatchedTotal, drawerExpectedTotal),
  };
}

function percentileDuration(
  rowResults: readonly MemoryEvalRowResult[],
  percentile: number,
): number {
  if (rowResults.length === 0) return 0;

  const sorted = rowResults.map((row) => row.durationMs).sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentile) - 1));
  return sorted[index] ?? 0;
}

function formatSummaryRow(
  segment: string,
  rows: number,
  metrics: MemoryEvalMetricAverages,
  p95DurationMs: number,
): string {
  return `| ${segment} | ${rows} | ${formatMetric(metrics.recallAt5)} | ${formatMetric(
    metrics.recallAt10,
  )} | ${formatMetric(metrics.mrr)} | ${formatMetric(metrics.ndcgAt10)} | ${formatMetric(
    metrics.groundingCoverage,
  )} | ${formatMetric(metrics.drawerOnlyHitRate)} | ${Math.round(p95DurationMs)} |`;
}

function formatMetric(value: number): string {
  return value.toFixed(3);
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function divideOrOne(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function divideOrZero(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function splitRows(rows: readonly MemoryEvalFixtureRow[], seed: number): MemoryEvalFixtureRow[] {
  return [...rows].sort((left, right) => {
    const leftHash = stableHash(`${seed}:${left.id}`);
    const rightHash = stableHash(`${seed}:${right.id}`);
    return leftHash - rightHash || left.id.localeCompare(right.id);
  });
}

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array`);
  }
  return value;
}

function requireStringArray(value: unknown, path: string): string[] {
  return requireArray(value, path).map((item, index) =>
    requireNonEmptyString(item, `${path}[${index}]`),
  );
}

function requireNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function requireNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`);
  }
  return value;
}

function requireNonNegativeInteger(value: unknown, path: string): number {
  const numberValue = requireNumber(value, path);
  if (!Number.isInteger(numberValue) || numberValue < 0) {
    throw new Error(`${path} must be a non-negative integer`);
  }
  return numberValue;
}

function requirePositiveInteger(value: unknown, path: string): number {
  const numberValue = requireNumber(value, path);
  if (!Number.isInteger(numberValue) || numberValue <= 0) {
    throw new Error(`${path} must be a positive integer`);
  }
  return numberValue;
}

function requireRecallThreshold(value: unknown, path: string): number {
  const numberValue = requireNumber(value, path);
  if (numberValue < 0 || numberValue > 1) {
    throw new Error(`${path} must be between 0 and 1`);
  }
  return numberValue;
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${path} must be a boolean`);
  }
  return value;
}
