import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  assertSanitizedMemoryEvalFixture,
  DEFAULT_FAILURE_MODE_TAGS,
  EVAL_SPLIT_SEED,
  type MemoryEvalFailureModeTag,
  type MemoryEvalFixtureFile,
  type MemoryEvalFixtureRow,
  readMemoryEvalFixtureChangelog,
} from '../packages/control-plane/src/memory/memory-eval.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

export const DEFAULT_PRIVATE_FIXTURE_PATH = path.resolve(
  REPO_ROOT,
  'tmp/memory-eval/agentctl-private.json',
);
export const DEFAULT_PRIVATE_FIXTURE_CHANGELOG_PATH = path.resolve(
  REPO_ROOT,
  'tmp/memory-eval/fixtures/CHANGELOG.md',
);
export const DEFAULT_PRIVATE_FIXTURE_ROWS_PER_TAG = 5;
const PLACEHOLDER_ROW_EXCLUSION_REASON =
  'Placeholder scaffold row. Replace it with a reviewed private example before using this fixture.';

type CliOptions = {
  fixturePath: string;
  fixtureChangelogPath: string;
  force: boolean;
  json: boolean;
};

export type MemoryEvalFixtureScaffoldReport = {
  status: 'created' | 'overwritten';
  fixturePath: string;
  fixtureChangelogPath: string;
  rowsPerTag: number;
  placeholderRows: number;
  requiredTags: string[];
  includedRows: number;
  excludedRows: number;
  latestDatedEntry: string;
  notes: string[];
};

function usage(): string {
  return `Usage: pnpm memory:eval:fixture-scaffold [--fixture path] [--fixture-changelog path] [--force] [--json]

Creates a gitignored private memory-eval authoring scaffold under tmp/memory-eval/
without printing fixture bodies, redacted hints, or secret material.`;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    fixturePath: DEFAULT_PRIVATE_FIXTURE_PATH,
    fixtureChangelogPath: DEFAULT_PRIVATE_FIXTURE_CHANGELOG_PATH,
    force: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }

    if (arg === '--fixture') {
      options.fixturePath = path.resolve(REPO_ROOT, readOptionValue(argv, index, arg));
      index += 1;
      continue;
    }

    if (arg === '--fixture-changelog') {
      options.fixtureChangelogPath = path.resolve(REPO_ROOT, readOptionValue(argv, index, arg));
      index += 1;
      continue;
    }

    if (arg === '--force') {
      options.force = true;
      continue;
    }

    if (arg === '--json') {
      options.json = true;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

export function scaffoldMemoryEvalFixture(
  options: {
    fixturePath?: string;
    fixtureChangelogPath?: string;
    force?: boolean;
    now?: Date;
  } = {},
): MemoryEvalFixtureScaffoldReport {
  const fixturePath = path.resolve(options.fixturePath ?? DEFAULT_PRIVATE_FIXTURE_PATH);
  const fixtureChangelogPath = path.resolve(
    options.fixtureChangelogPath ?? DEFAULT_PRIVATE_FIXTURE_CHANGELOG_PATH,
  );
  const force = options.force ?? false;
  const existingPaths = [fixturePath, fixtureChangelogPath].filter((targetPath) =>
    fs.existsSync(targetPath),
  );

  if (!force && existingPaths.length > 0) {
    throw new Error(
      `Refusing to overwrite existing private fixture scaffold files: ${existingPaths.join(', ')}. Re-run with --force to replace them.`,
    );
  }

  const fixture = buildPlaceholderFixture();
  const changelog = buildPlaceholderChangelog(options.now ?? new Date());
  assertSanitizedMemoryEvalFixture(fixture);

  fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
  fs.mkdirSync(path.dirname(fixtureChangelogPath), { recursive: true });
  fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
  fs.writeFileSync(fixtureChangelogPath, changelog, 'utf8');

  const changelogSummary = readMemoryEvalFixtureChangelog(fixtureChangelogPath);

  return {
    status: existingPaths.length > 0 ? 'overwritten' : 'created',
    fixturePath,
    fixtureChangelogPath,
    rowsPerTag: DEFAULT_PRIVATE_FIXTURE_ROWS_PER_TAG,
    placeholderRows: fixture.rows.length,
    requiredTags: [...DEFAULT_FAILURE_MODE_TAGS],
    includedRows: 0,
    excludedRows: fixture.rows.length,
    latestDatedEntry: changelogSummary.latestDatedEntry,
    notes: [
      'All scaffold rows start with excluded=true so placeholder content cannot be used accidentally.',
      'Replace the placeholder query, expected fact ids, and redacted answer hints with reviewed private examples before removing excluded=true.',
      'Append dated changelog notes for later held-out/full fixture edits before running pnpm memory:eval:fixture-check or pnpm memory:eval:secrets.',
    ],
  };
}

export function formatMemoryEvalFixtureScaffoldReport(
  report: MemoryEvalFixtureScaffoldReport,
): string {
  return [
    '# Memory Eval Private Fixture Scaffold',
    '',
    `Status: ${report.status}`,
    `Fixture: ${report.fixturePath}`,
    `Changelog: ${report.fixtureChangelogPath}`,
    `Placeholder rows: ${report.placeholderRows}`,
    `Rows per failure-mode tag: ${report.rowsPerTag}`,
    `Required failure-mode tags: ${report.requiredTags.length}`,
    `Included rows: ${report.includedRows}`,
    `Excluded rows: ${report.excludedRows}`,
    `Latest changelog entry: ${report.latestDatedEntry}`,
    '',
    '## Notes',
    ...report.notes.map((note) => `- ${note}`),
  ].join('\n');
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  const report = scaffoldMemoryEvalFixture(options);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(formatMemoryEvalFixtureScaffoldReport(report));
}

function readOptionValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function buildPlaceholderFixture(): MemoryEvalFixtureFile {
  return {
    version: 1,
    splitSeed: EVAL_SPLIT_SEED,
    description:
      'Gitignored private authoring scaffold for the AgentCTL memory eval harness. Replace excluded placeholder rows with reviewed private examples before running private checks or secret provisioning.',
    rows: DEFAULT_FAILURE_MODE_TAGS.flatMap((tag) => buildPlaceholderRowsForTag(tag)),
  };
}

function buildPlaceholderRowsForTag(tag: MemoryEvalFailureModeTag): MemoryEvalFixtureRow[] {
  return Array.from(
    { length: DEFAULT_PRIVATE_FIXTURE_ROWS_PER_TAG },
    (_, index): MemoryEvalFixtureRow => {
      const ordinal = String(index + 1).padStart(2, '0');
      return {
        id: `private-${tag}-${ordinal}`,
        query: `TODO: Replace with a reviewed private query for ${tag} example ${ordinal}.`,
        category: `PrivateMemoryEvalScaffold-${tag}`,
        expectedFacts: [
          {
            id: `fact:private-placeholder:${tag}:${ordinal}`,
            relevance: 3,
          },
        ],
        expectedDrawerSources: [],
        redactedAnswerHints: [
          `TODO: Replace with a redacted answer hint for ${tag} example ${ordinal}.`,
        ],
        tags: [tag],
        public: false,
        excluded: true,
        exclusionReason: PLACEHOLDER_ROW_EXCLUSION_REASON,
      };
    },
  );
}

function buildPlaceholderChangelog(now: Date): string {
  const date = now.toISOString().slice(0, 10);
  return [
    '# Private Fixture Changelog',
    '',
    `## ${date}`,
    '',
    '- Initialized the gitignored private fixture scaffold with excluded placeholder rows for every default failure-mode tag.',
    '- Replace placeholder fields, remove excluded=true from reviewed rows, and append dated notes whenever held-out/full fixture content changes.',
    '',
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
