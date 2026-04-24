import { describe, expect, it } from 'vitest';

import {
  assertFailureModeCoverage,
  assertMemoryPlantedNeedleBenchPassed,
  assertSanitizedMemoryEvalFixture,
  createMemoryPlantedNeedleMockRanker,
  createMemoryPlantedNeedleRows,
  EVAL_SPLIT_SEED,
  formatFailureModeCoverageMarkdown,
  formatMemoryEvalMarkdown,
  formatMemoryEvalReport,
  getDevSet,
  getFullSet,
  getHeldOutSet,
  type MemoryEvalCandidate,
  type MemoryEvalFixtureRow,
  resolveMemoryPlantedNeedleBenchConfig,
  runMemoryPlantedNeedleBench,
  scoreMemoryEvalRow,
  summarizeFailureModeCoverage,
  summarizeMemoryEval,
  toDrawerSourceKey,
} from './memory-eval.js';

const BASE_ROW: MemoryEvalFixtureRow = {
  id: 'fixture-alpha',
  query: 'Which deployment format did the operator prefer?',
  category: 'AgentCTL-internal',
  expectedFacts: [
    { id: 'fact:deployment-format', relevance: 3 },
    { id: 'fact:rollout-window', relevance: 1 },
  ],
  expectedDrawerSources: [
    {
      sourceType: 'session-jsonl',
      sourceId: 'fixture-session-redacted-alpha',
      chunkIndex: 0,
      relevance: 2,
    },
  ],
  redactedAnswerHints: ['Operator preferred tarball deploys for the staging host.'],
  tags: ['vocabulary-gap', 'assistant-reference'],
  public: true,
};

function candidate(overrides: Partial<MemoryEvalCandidate>): MemoryEvalCandidate {
  return {
    id: overrides.factId ?? overrides.drawerSourceKey ?? 'candidate',
    score: 1,
    ...overrides,
  };
}

describe('memory eval scoring', () => {
  it('calculates recall, MRR, NDCG@10, and grounding coverage from unique expected hits', () => {
    const firstDrawerKey = toDrawerSourceKey({
      sourceType: 'session-jsonl',
      sourceId: 'fixture-session-redacted-alpha',
      chunkIndex: 0,
    });

    const results = [
      candidate({ factId: 'fact:distractor-1' }),
      candidate({ factId: 'fact:rollout-window' }),
      candidate({ factId: 'fact:deployment-format', drawerSourceKey: firstDrawerKey }),
      candidate({ factId: 'fact:deployment-format', drawerSourceKey: firstDrawerKey }),
      candidate({ drawerSourceKey: firstDrawerKey }),
      candidate({ factId: 'fact:distractor-2' }),
    ];

    const score = scoreMemoryEvalRow(BASE_ROW, results, 42);

    expect(score.recallAt5).toBe(1);
    expect(score.recallAt10).toBe(1);
    expect(score.mrr).toBe(1 / 2);
    expect(score.groundingCoverage).toBe(1);
    expect(score.drawerOnlyHitRate).toBe(1);
    expect(score.firstRelevantRank).toBe(2);
    expect(score.matchedExpectedKeys).toEqual([
      'fact:fact:rollout-window',
      'fact:fact:deployment-format',
      'drawer:session-jsonl:fixture-session-redacted-alpha:0',
    ]);
    expect(score.ndcgAt10).toBeCloseTo(0.44, 3);
  });

  it('treats missing expected evidence as zero recall and zero grounding coverage', () => {
    const score = scoreMemoryEvalRow(
      BASE_ROW,
      [candidate({ factId: 'fact:unrelated' }), candidate({ drawerSourceKey: 'manual:other:0' })],
      17,
    );

    expect(score.recallAt5).toBe(0);
    expect(score.recallAt10).toBe(0);
    expect(score.mrr).toBe(0);
    expect(score.ndcgAt10).toBe(0);
    expect(score.groundingCoverage).toBe(0);
    expect(score.drawerOnlyHitRate).toBe(0);
    expect(score.durationMs).toBe(17);
  });

  it('calculates MRR beyond the top ten without inflating R@10 or NDCG@10', () => {
    const results = [
      ...Array.from({ length: 11 }, (_, index) =>
        candidate({ factId: `fact:distractor-${index}` }),
      ),
      candidate({ factId: 'fact:deployment-format' }),
    ];

    const score = scoreMemoryEvalRow(BASE_ROW, results, 24);

    expect(score.mrr).toBe(1 / 12);
    expect(score.recallAt10).toBe(0);
    expect(score.ndcgAt10).toBe(0);
  });

  it('summarizes aggregate, per-category, per-tag, and p95 duration metrics', () => {
    const rowA = scoreMemoryEvalRow(
      BASE_ROW,
      [
        candidate({ factId: 'fact:deployment-format' }),
        candidate({ factId: 'fact:rollout-window' }),
      ],
      10,
    );
    const rowB = scoreMemoryEvalRow(
      {
        ...BASE_ROW,
        id: 'fixture-beta',
        category: 'LongMemEval-project-memory',
        expectedFacts: [{ id: 'fact:beta', relevance: 1 }],
        expectedDrawerSources: [],
        tags: ['temporal-ambiguity'],
      },
      [candidate({ factId: 'fact:other' })],
      80,
    );
    const rowC = scoreMemoryEvalRow(
      {
        ...BASE_ROW,
        id: 'fixture-gamma',
        category: 'LongMemEval-project-memory',
        expectedFacts: [{ id: 'fact:gamma', relevance: 1 }],
        expectedDrawerSources: [],
        tags: ['temporal-ambiguity'],
      },
      [candidate({ factId: 'fact:gamma' })],
      120,
    );

    const summary = summarizeMemoryEval([rowA, rowB, rowC]);

    expect(summary.totalRows).toBe(3);
    expect(summary.p95DurationMs).toBe(120);
    expect(summary.aggregate.recallAt5).toBeCloseTo(0.556, 3);
    expect(summary.aggregate.mrr).toBeCloseTo(0.667, 3);
    expect(summary.byCategory['LongMemEval-project-memory']?.totalRows).toBe(2);
    expect(summary.byCategory['LongMemEval-project-memory']?.recallAt10).toBe(0.5);
    expect(summary.byTag['temporal-ambiguity']?.totalRows).toBe(2);

    expect(formatMemoryEvalMarkdown(summary)).toMatchInlineSnapshot(`
      "| Segment | Rows | R@5 | R@10 | MRR | NDCG@10 | Grounding | Drawer hit | p95 ms |
      | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
      | all | 3 | 0.556 | 0.556 | 0.667 | 0.604 | 0.000 | 0.000 | 120 |
      | category: AgentCTL-internal | 1 | 0.667 | 0.667 | 1.000 | 0.812 | 0.000 | 0.000 | 10 |
      | category: LongMemEval-project-memory | 2 | 0.500 | 0.500 | 0.500 | 0.500 | 0.000 | 0.000 | 120 |

      ## By Tag

      | Tag | Rows | R@5 | R@10 | MRR | NDCG@10 | Grounding | Drawer hit | p95 ms |
      | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
      | assistant-reference | 1 | 0.667 | 0.667 | 1.000 | 0.812 | 0.000 | 0.000 | 10 |
      | temporal-ambiguity | 2 | 0.500 | 0.500 | 0.500 | 0.500 | 0.000 | 0.000 | 120 |
      | vocabulary-gap | 1 | 0.667 | 0.667 | 1.000 | 0.812 | 0.000 | 0.000 | 10 |"
    `);

    expect(
      formatMemoryEvalReport(
        {
          rowResults: [rowA, rowB, rowC],
          summary,
        },
        { failureExampleLimit: 2 },
      ),
    ).toMatchInlineSnapshot(`
      "| Segment | Rows | R@5 | R@10 | MRR | NDCG@10 | Grounding | Drawer hit | p95 ms |
      | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
      | all | 3 | 0.556 | 0.556 | 0.667 | 0.604 | 0.000 | 0.000 | 120 |
      | category: AgentCTL-internal | 1 | 0.667 | 0.667 | 1.000 | 0.812 | 0.000 | 0.000 | 10 |
      | category: LongMemEval-project-memory | 2 | 0.500 | 0.500 | 0.500 | 0.500 | 0.000 | 0.000 | 120 |

      ## By Tag

      | Tag | Rows | R@5 | R@10 | MRR | NDCG@10 | Grounding | Drawer hit | p95 ms |
      | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
      | assistant-reference | 1 | 0.667 | 0.667 | 1.000 | 0.812 | 0.000 | 0.000 | 10 |
      | temporal-ambiguity | 2 | 0.500 | 0.500 | 0.500 | 0.500 | 0.000 | 0.000 | 120 |
      | vocabulary-gap | 1 | 0.667 | 0.667 | 1.000 | 0.812 | 0.000 | 0.000 | 10 |

      ## Failure Examples (showing 2 of 2)

      ### \`fixture-beta\`

      Category: \`LongMemEval-project-memory\`

      Tags: \`temporal-ambiguity\`

      Query: "Which deployment format did the operator prefer?"

      Metrics: R@5=0.000 R@10=0.000 MRR=0.000 Grounding=1.000 FirstRelevantRank=miss

      Matched@10: 0/1

      Top results: \`fact:fact:other\`

      ### \`fixture-alpha\`

      Category: \`AgentCTL-internal\`

      Tags: \`vocabulary-gap\`, \`assistant-reference\`

      Query: "Which deployment format did the operator prefer?"

      Metrics: R@5=0.667 R@10=0.667 MRR=1.000 Grounding=0.000 FirstRelevantRank=1

      Matched@10: 2/3

      Top results: \`fact:fact:deployment-format\`, \`fact:fact:rollout-window\`"
    `);
  });
});

describe('memory eval fixture hygiene and split helpers', () => {
  it('rejects raw-looking secrets and unredacted internal ids', () => {
    expect(() =>
      assertSanitizedMemoryEvalFixture({
        version: 1,
        splitSeed: EVAL_SPLIT_SEED,
        rows: [
          {
            ...BASE_ROW,
            redactedAnswerHints: ['raw key sk-live-abcdefghijklmnopqrstuvwxyz1234567890'],
          },
        ],
      }),
    ).toThrow(/raw-looking secret/i);

    expect(() =>
      assertSanitizedMemoryEvalFixture({
        version: 1,
        splitSeed: EVAL_SPLIT_SEED,
        rows: [{ ...BASE_ROW, query: 'What happened in session_abcdef1234567890?' }],
      }),
    ).toThrow(/unredacted internal id/i);
  });

  it('splits fixtures deterministically with seed 42 and guards held-out/full access', () => {
    const rows = Array.from(
      { length: 20 },
      (_, index): MemoryEvalFixtureRow => ({
        ...BASE_ROW,
        id: `fixture-${String(index).padStart(2, '0')}`,
        query: `Query ${index}`,
        expectedFacts: [{ id: `fact:${index}` }],
        expectedDrawerSources: [],
        tags: ['vocabulary-gap'],
      }),
    );

    const firstDev = getDevSet(rows).map((row) => row.id);
    const secondDev = getDevSet(rows).map((row) => row.id);

    expect(firstDev).toEqual(secondDev);
    expect(firstDev).toHaveLength(2);
    expect(() => getHeldOutSet(rows)).toThrow(/workflow eval jobs/i);
    expect(getHeldOutSet(rows, { allowHeldOut: true })).toHaveLength(18);
    expect(() => getFullSet(rows)).toThrow(/release eval/i);
    expect(getFullSet(rows, { allowFullSet: true })).toHaveLength(20);
  });

  it('checks required failure-mode fixture coverage without hard-coding the public sample size', () => {
    const rows = ['vocabulary-gap', 'temporal-ambiguity', 'assistant-reference'].flatMap((tag) =>
      Array.from(
        { length: 2 },
        (_, index): MemoryEvalFixtureRow => ({
          ...BASE_ROW,
          id: `fixture-${tag}-${index}`,
          query: `${tag} query ${index}`,
          expectedFacts: [{ id: `fact:${tag}:${index}` }],
          expectedDrawerSources: [],
          tags: [tag],
        }),
      ),
    );

    expect(() =>
      assertFailureModeCoverage(rows, {
        requiredTags: ['vocabulary-gap', 'temporal-ambiguity', 'assistant-reference'],
        minimumPerTag: 2,
      }),
    ).not.toThrow();

    expect(() =>
      assertFailureModeCoverage(rows, {
        requiredTags: ['vocabulary-gap', 'noisy-distractor-rejection'],
        minimumPerTag: 2,
      }),
    ).toThrow(
      /noisy-distractor-rejection \(0\/2\).*Current required-tag counts: vocabulary-gap=2\/2, noisy-distractor-rejection=0\/2/,
    );
  });

  it('formats a deterministic failure-mode coverage table for workflow-owned fixture runs', () => {
    const rows = [
      {
        ...BASE_ROW,
        id: 'fixture-vocab-0',
        expectedFacts: [{ id: 'fact:vocab:0' }],
        expectedDrawerSources: [],
        tags: ['vocabulary-gap'],
      },
      {
        ...BASE_ROW,
        id: 'fixture-vocab-1',
        expectedFacts: [{ id: 'fact:vocab:1' }],
        expectedDrawerSources: [],
        tags: ['vocabulary-gap'],
      },
      {
        ...BASE_ROW,
        id: 'fixture-temporal-0',
        expectedFacts: [{ id: 'fact:temporal:0' }],
        expectedDrawerSources: [],
        tags: ['temporal-ambiguity'],
      },
      {
        ...BASE_ROW,
        id: 'fixture-excluded',
        expectedFacts: [{ id: 'fact:excluded' }],
        expectedDrawerSources: [],
        tags: ['temporal-ambiguity'],
        excluded: true,
        exclusionReason: 'Moved to changelog',
      },
    ];

    const coverage = summarizeFailureModeCoverage(rows, {
      requiredTags: ['temporal-ambiguity', 'vocabulary-gap', 'assistant-reference'],
      minimumPerTag: 2,
    });

    expect(coverage).toEqual({
      totalIncludedRows: 3,
      requiredRowsPerTag: 2,
      missingTags: ['temporal-ambiguity', 'assistant-reference'],
      tags: [
        {
          tag: 'temporal-ambiguity',
          totalRows: 1,
          requiredRows: 2,
          missingRows: 1,
          meetsMinimum: false,
        },
        {
          tag: 'vocabulary-gap',
          totalRows: 2,
          requiredRows: 2,
          missingRows: 0,
          meetsMinimum: true,
        },
        {
          tag: 'assistant-reference',
          totalRows: 0,
          requiredRows: 2,
          missingRows: 2,
          meetsMinimum: false,
        },
      ],
    });

    expect(formatFailureModeCoverageMarkdown(coverage)).toMatchInlineSnapshot(`
      "## Fixture Failure-Mode Coverage
      Included rows counted: 3
      Required rows per tag: 2

      | Tag | Rows | Required | Status |
      | --- | ---: | ---: | --- |
      | temporal-ambiguity | 1 | 2 | missing 1 |
      | vocabulary-gap | 2 | 2 | ok |
      | assistant-reference | 0 | 2 | missing 2 |"
    `);
  });
});

describe('memory planted-needle bench', () => {
  it('resolves bench defaults from explicit env values without mutating process.env', () => {
    const config = resolveMemoryPlantedNeedleBenchConfig({
      env: {
        MEMORY_BENCH_NEEDLE_COUNT: '3',
        MEMORY_BENCH_NOISE_COUNT: '7',
        MEMORY_BENCH_MIN_RECALL: '0.9',
      },
    });

    expect(config).toEqual({
      minRecallAt5: 0.9,
      needleCount: 3,
      noiseCount: 7,
      seed: EVAL_SPLIT_SEED,
    });
    expect(() =>
      resolveMemoryPlantedNeedleBenchConfig({
        env: { MEMORY_BENCH_NEEDLE_COUNT: '0' },
      }),
    ).toThrow(/MEMORY_BENCH_NEEDLE_COUNT.*positive integer/);
    expect(() =>
      resolveMemoryPlantedNeedleBenchConfig({
        env: { MEMORY_BENCH_MIN_RECALL: '1.1' },
      }),
    ).toThrow(/MEMORY_BENCH_MIN_RECALL.*between 0 and 1/);
  });

  it('creates deterministic public rows with needle ids kept out of queries', () => {
    const firstRows = createMemoryPlantedNeedleRows({ needleCount: 3, seed: 7 });
    const secondRows = createMemoryPlantedNeedleRows({ needleCount: 3, seed: 7 });

    expect(firstRows).toEqual(secondRows);
    expect(firstRows).toHaveLength(3);
    expect(firstRows.map((row) => row.id)).toEqual([
      'planted-needle-000',
      'planted-needle-001',
      'planted-needle-002',
    ]);
    expect(firstRows.every((row) => row.public)).toBe(true);
    expect(firstRows.every((row) => row.tags.includes('noisy-distractor-rejection'))).toBe(true);
    expect(firstRows.every((row) => !row.query.includes('NEEDLE_'))).toBe(true);
    expect(firstRows.map((row) => row.expectedFacts[0]?.id)).toMatchInlineSnapshot(`
      [
        "NEEDLE_7_000",
        "NEEDLE_7_001",
        "NEEDLE_7_002",
      ]
    `);
  });

  it('runs the deterministic mock bench and reports latency percentiles', async () => {
    const firstRun = await runMemoryPlantedNeedleBench({
      minRecallAt5: 1,
      needleCount: 4,
      noiseCount: 12,
      seed: 11,
    });
    const secondRun = await runMemoryPlantedNeedleBench({
      minRecallAt5: 1,
      needleCount: 4,
      noiseCount: 12,
      seed: 11,
    });

    expect(firstRun.passed).toBe(true);
    expect(firstRun.summary.totalRows).toBe(4);
    expect(firstRun.summary.aggregate.recallAt5).toBe(1);
    expect(firstRun.latency.p50DurationMs).toBeGreaterThanOrEqual(0);
    expect(firstRun.latency.p95DurationMs).toBeGreaterThanOrEqual(firstRun.latency.p50DurationMs);
    expect(firstRun.latency.p99DurationMs).toBeGreaterThanOrEqual(firstRun.latency.p95DurationMs);
    expect(firstRun.rowResults.map((row) => row.rankedResultKeys)).toEqual(
      secondRun.rowResults.map((row) => row.rankedResultKeys),
    );
  });

  it('enforces the recall threshold when the mock ranker buries needles below rank five', async () => {
    const run = await runMemoryPlantedNeedleBench(
      {
        minRecallAt5: 0.85,
        needleCount: 3,
        noiseCount: 8,
        seed: 13,
      },
      createMemoryPlantedNeedleMockRanker({ needleRank: 6, noiseCount: 8, seed: 13 }),
    );

    expect(run.passed).toBe(false);
    expect(run.summary.aggregate.recallAt5).toBe(0);
    expect(() => assertMemoryPlantedNeedleBenchPassed(run)).toThrow(
      /Planted-needle recall@5 0\.000 is below required minimum 0\.850/,
    );
  });
});
