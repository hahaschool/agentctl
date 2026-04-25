import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_FAILURE_MODE_TAGS } from '../packages/control-plane/src/memory/memory-eval.js';
import { DEFAULT_PRIVATE_FIXTURE_ROWS_PER_TAG, main } from './memory-eval-fixture-scaffold.js';

type FixtureRow = {
  query: string;
  redactedAnswerHints: string[];
  tags: string[];
  public: boolean;
  excluded?: boolean;
  exclusionReason?: string;
};

function createOutputPaths(): {
  fixturePath: string;
  fixtureChangelogPath: string;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-eval-fixture-scaffold-'));
  return {
    fixturePath: path.join(dir, 'tmp', 'memory-eval', 'agentctl-private.json'),
    fixtureChangelogPath: path.join(dir, 'tmp', 'memory-eval', 'fixtures', 'CHANGELOG.md'),
  };
}

function readFixture(fixturePath: string): {
  version: number;
  splitSeed: number;
  rows: FixtureRow[];
} {
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as {
    version: number;
    splitSeed: number;
    rows: FixtureRow[];
  };
}

describe('memory eval fixture scaffold', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('writes excluded private placeholder rows for every default failure-mode tag and prints aggregate-only output', async () => {
    const { fixturePath, fixtureChangelogPath } = createOutputPaths();

    await main(['--fixture', fixturePath, '--fixture-changelog', fixtureChangelogPath]);

    const fixture = readFixture(fixturePath);
    const output = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    const counts = new Map<string, number>();
    for (const row of fixture.rows) {
      counts.set(row.tags[0] ?? '', (counts.get(row.tags[0] ?? '') ?? 0) + 1);
    }

    expect(fixture.version).toBe(1);
    expect(fixture.splitSeed).toBe(42);
    expect(fixture.rows).toHaveLength(
      DEFAULT_FAILURE_MODE_TAGS.length * DEFAULT_PRIVATE_FIXTURE_ROWS_PER_TAG,
    );
    expect([...counts.keys()]).toEqual(DEFAULT_FAILURE_MODE_TAGS);
    expect([...counts.values()]).toEqual(
      DEFAULT_FAILURE_MODE_TAGS.map(() => DEFAULT_PRIVATE_FIXTURE_ROWS_PER_TAG),
    );
    for (const row of fixture.rows) {
      expect(row.public).toBe(false);
      expect(row.excluded).toBe(true);
      expect(row.exclusionReason).toMatch(/placeholder/i);
    }

    expect(output).toContain('Memory Eval Private Fixture Scaffold');
    expect(output).toContain(`Fixture: ${fixturePath}`);
    expect(output).toContain(`Changelog: ${fixtureChangelogPath}`);
    expect(output).toContain(`Placeholder rows: ${fixture.rows.length}`);
    expect(output).toContain(`Rows per failure-mode tag: ${DEFAULT_PRIVATE_FIXTURE_ROWS_PER_TAG}`);
    expect(output).toContain(`Required failure-mode tags: ${DEFAULT_FAILURE_MODE_TAGS.length}`);
    expect(output).toContain('Included rows: 0');
    expect(output).toContain(`Excluded rows: ${fixture.rows.length}`);
    expect(output).not.toContain(fixture.rows[0]?.query ?? '');
    expect(output).not.toContain(fixture.rows[0]?.redactedAnswerHints[0] ?? '');
  });

  it('refuses to overwrite an existing scaffold unless --force is passed', async () => {
    const { fixturePath, fixtureChangelogPath } = createOutputPaths();

    await main(['--fixture', fixturePath, '--fixture-changelog', fixtureChangelogPath]);

    await expect(
      main(['--fixture', fixturePath, '--fixture-changelog', fixtureChangelogPath]),
    ).rejects.toThrow(/already exists|--force/i);
  });

  it('supports --force and emits a machine-readable summary with --json', async () => {
    const { fixturePath, fixtureChangelogPath } = createOutputPaths();

    await main(['--fixture', fixturePath, '--fixture-changelog', fixtureChangelogPath]);
    fs.writeFileSync(fixturePath, '{"stale":true}\n', 'utf8');
    fs.writeFileSync(fixtureChangelogPath, '# stale\n', 'utf8');
    logSpy.mockClear();

    await main([
      '--fixture',
      fixturePath,
      '--fixture-changelog',
      fixtureChangelogPath,
      '--force',
      '--json',
    ]);

    const summary = JSON.parse(logSpy.mock.calls.at(-1)?.[0] as string) as {
      status: string;
      fixturePath: string;
      fixtureChangelogPath: string;
      rowsPerTag: number;
      placeholderRows: number;
      requiredTags: string[];
      includedRows: number;
      excludedRows: number;
    };
    const rewrittenFixture = readFixture(fixturePath);

    expect(summary).toMatchObject({
      status: 'overwritten',
      fixturePath,
      fixtureChangelogPath,
      rowsPerTag: DEFAULT_PRIVATE_FIXTURE_ROWS_PER_TAG,
      placeholderRows: DEFAULT_FAILURE_MODE_TAGS.length * DEFAULT_PRIVATE_FIXTURE_ROWS_PER_TAG,
      requiredTags: [...DEFAULT_FAILURE_MODE_TAGS],
      includedRows: 0,
      excludedRows: DEFAULT_FAILURE_MODE_TAGS.length * DEFAULT_PRIVATE_FIXTURE_ROWS_PER_TAG,
    });
    expect(rewrittenFixture.rows).toHaveLength(summary.placeholderRows);
    expect(JSON.stringify(summary)).not.toContain(rewrittenFixture.rows[0]?.query ?? '');
    expect(JSON.stringify(summary)).not.toContain(
      rewrittenFixture.rows[0]?.redactedAnswerHints[0] ?? '',
    );
  });
});
