import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_FAILURE_MODE_TAGS } from '../packages/control-plane/src/memory/memory-eval.js';
import {
  buildMemoryEvalFixtureCheckReport,
  formatMemoryEvalFixtureCheckReport,
  main,
} from './memory-eval-fixture-check.js';

const ORIGINAL_ENV = { ...process.env };

function writeFixture(
  options: {
    rowsPerTag?: number;
    tags?: readonly string[];
    publicRows?: boolean;
    includeExtraPublicRows?: boolean;
  } = {},
): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-eval-fixture-check-'));
  const fixturePath = path.join(dir, 'private.json');
  const rowsPerTag = options.rowsPerTag ?? 1;
  const tags = options.tags ?? DEFAULT_FAILURE_MODE_TAGS;
  const privateRows = tags.flatMap((tag) =>
    Array.from({ length: rowsPerTag }, (_, index) => ({
      id: `${tag}-${index + 1}`,
      query: `Private query for ${tag} ${index + 1}?`,
      category: 'AgentCTL-private',
      expectedFacts: [{ id: `fact:${tag}:${index + 1}`, relevance: 3 }],
      expectedDrawerSources: [],
      redactedAnswerHints: [`Private redacted hint for ${tag}.`],
      tags: [tag],
      public: options.publicRows ?? false,
    })),
  );
  const publicRows = options.includeExtraPublicRows
    ? tags.map((tag) => ({
        id: `public-${tag}`,
        query: `Public query for ${tag}?`,
        category: 'AgentCTL-public',
        expectedFacts: [{ id: `fact:public:${tag}`, relevance: 2 }],
        expectedDrawerSources: [],
        redactedAnswerHints: [`Public redacted hint for ${tag}.`],
        tags: [tag],
        public: true,
      }))
    : [];
  const rows = [...privateRows, ...publicRows];

  fs.writeFileSync(
    fixturePath,
    `${JSON.stringify(
      {
        version: 1,
        splitSeed: 42,
        rows,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  return fixturePath;
}

function writeChangelog(
  contents = '# Private Fixture Changelog\n\n## 2026-04-25\n\n- Added reviewed private held-out rows for every default failure-mode tag.\n',
): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-eval-fixture-check-changelog-'));
  const changelogPath = path.join(dir, 'CHANGELOG.md');
  fs.writeFileSync(changelogPath, contents, 'utf8');
  return changelogPath;
}

describe('memory eval fixture check', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    logSpy.mockRestore();
  });

  it('summarizes private fixture coverage and split counts without printing fixture bodies', () => {
    const report = buildMemoryEvalFixtureCheckReport({
      fixturePath: writeFixture(),
      fixtureChangelogPath: writeChangelog(),
      minimumRowsPerFailureMode: 1,
    });

    const output = formatMemoryEvalFixtureCheckReport(report);

    expect(output).toContain('Memory Eval Private Fixture Check');
    expect(output).toContain('Included rows: 5');
    expect(output).toContain('Private rows: 5');
    expect(output).toContain('Public rows: 0');
    expect(output).toContain('Dev rows: 1');
    expect(output).toContain('Held-out rows: 4');
    expect(output).toContain('Full rows: 5');
    expect(output).toContain('Latest dated entry: 2026-04-25');
    expect(output).toContain('| vocabulary-gap | 1 | 1 | ok |');
    expect(output).not.toContain('Private query for');
    expect(output).not.toContain('Private redacted hint');
  });

  it('counts coverage and split sizes from included private rows even if public rows are present', () => {
    const report = buildMemoryEvalFixtureCheckReport({
      fixturePath: writeFixture({ includeExtraPublicRows: true }),
      minimumRowsPerFailureMode: 1,
    });

    const output = formatMemoryEvalFixtureCheckReport(report);

    expect(output).toContain('Included rows: 10');
    expect(output).toContain('Private rows: 5');
    expect(output).toContain('Public rows: 5');
    expect(output).toContain('Dev rows: 1');
    expect(output).toContain('Held-out rows: 4');
    expect(output).toContain('| noisy-distractor-rejection | 1 | 1 | ok |');
    expect(output).toContain(
      'coverage and split counts are computed from included private rows only',
    );
    expect(output).not.toContain('Public query for');
  });

  it('rejects a fixture that is marked entirely public', () => {
    expect(() =>
      buildMemoryEvalFixtureCheckReport({
        fixturePath: writeFixture({ publicRows: true }),
        minimumRowsPerFailureMode: 1,
      }),
    ).toThrow(/all-public|public=false|marked private/i);
  });

  it('fails when changelog review is requested but no changelog path is provided', async () => {
    await expect(
      main(['--fixture', writeFixture(), '--min-rows', '1', '--require-changelog']),
    ).rejects.toThrow(/--fixture-changelog is required|reviewed dated changelog entry/i);

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('fails when private rows do not meet the required failure-mode coverage floor', async () => {
    await expect(main(['--fixture', writeFixture(), '--min-rows', '2'])).rejects.toThrow(
      /vocabulary-gap \(1\/2\)|temporal-ambiguity \(1\/2\)|Current required-tag counts:/,
    );

    expect(logSpy).not.toHaveBeenCalled();
  });
});
