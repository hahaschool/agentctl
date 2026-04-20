import { describe, expect, it } from 'vitest';

import {
  assertFailureModeCoverage,
  assertSanitizedMemoryEvalFixture,
  EVAL_SPLIT_SEED,
  formatMemoryEvalMarkdown,
  getDevSet,
  getFullSet,
  getHeldOutSet,
  type MemoryEvalCandidate,
  type MemoryEvalFixtureRow,
  scoreMemoryEvalRow,
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
      | category: LongMemEval-project-memory | 2 | 0.500 | 0.500 | 0.500 | 0.500 | 0.000 | 0.000 | 120 |"
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

  it('splits fixtures deterministically with seed 42 and guards full-set access', () => {
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
    expect(getHeldOutSet(rows)).toHaveLength(18);
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
    ).toThrow(/noisy-distractor-rejection/);
  });
});
