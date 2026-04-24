import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertSanitizedMemoryEvalFixture,
  createDeterministicMockRanker,
  DEFAULT_FAILURE_MODE_TAGS,
  getDevSet,
  loadMemoryEvalFixture,
  runMemoryEval,
} from './memory-eval.js';

const SAMPLE_FIXTURE_PATH = path.resolve(
  process.cwd(),
  '../../docs/fixtures/memory-eval/agentctl-memory-eval.sample.json',
);

describe('memory eval sample fixture', () => {
  it('loads as sanitized public fixture data', () => {
    const raw = JSON.parse(fs.readFileSync(SAMPLE_FIXTURE_PATH, 'utf8')) as unknown;
    const fixture = assertSanitizedMemoryEvalFixture(raw);

    expect(fixture.version).toBe(1);
    expect(fixture.splitSeed).toBe(42);
    expect(fixture.rows.every((row) => row.public)).toBe(true);
    expect(fixture.rows.some((row) => row.category.startsWith('LongMemEval'))).toBe(true);
    expect(fixture.rows.some((row) => row.category === 'AgentCTL-internal')).toBe(true);
    expect(getDevSet(fixture.rows).map((row) => row.id)).toMatchInlineSnapshot(`
      [
        "sample-agentctl-person-name",
      ]
    `);
  });

  it('keeps one focused public sample row per default failure-mode tag', () => {
    const fixture = loadMemoryEvalFixture(SAMPLE_FIXTURE_PATH);
    const focusedTagCounts = new Map<string, number>();

    for (const row of fixture.rows.filter(
      (row) => row.public && !row.excluded && row.tags.length === 1,
    )) {
      const tag = row.tags[0] ?? '';
      focusedTagCounts.set(tag, (focusedTagCounts.get(tag) ?? 0) + 1);
    }

    expect(Object.fromEntries([...focusedTagCounts].sort())).toEqual(
      Object.fromEntries(DEFAULT_FAILURE_MODE_TAGS.map((tag) => [tag, 1]).sort()),
    );
  });

  it('runs deterministic mock ranking against the sample fixture', async () => {
    const fixture = loadMemoryEvalFixture(SAMPLE_FIXTURE_PATH);
    const ranker = createDeterministicMockRanker({ distractorCount: 4, seed: 42 });

    const firstRun = await runMemoryEval(fixture.rows, ranker);
    const secondRun = await runMemoryEval(fixture.rows, ranker);

    expect(firstRun.summary.aggregate.recallAt5).toBe(1);
    expect(firstRun.summary.aggregate.ndcgAt10).toBe(1);
    expect(firstRun.rowResults.map((row) => row.rankedResultKeys)).toEqual(
      secondRun.rowResults.map((row) => row.rankedResultKeys),
    );
  });
});
