import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  assertFailureModeCoverage,
  type FixtureChangelogSummary,
  formatFailureModeCoverageMarkdown,
  getDevSet,
  getFullSet,
  getHeldOutSet,
  loadMemoryEvalFixture,
  type MemoryEvalFailureModeCoverageSummary,
  type MemoryEvalFixtureRow,
  readMemoryEvalFixtureChangelog,
  summarizeFailureModeCoverage,
} from '../packages/control-plane/src/memory/memory-eval.js';

type CliOptions = {
  fixturePath: string;
  fixtureChangelogPath?: string;
  minimumRowsPerFailureMode: number;
  requireChangelog: boolean;
};

export type MemoryEvalFixtureCheckReport = {
  visibility: {
    includedRows: number;
    privateRows: number;
    publicRows: number;
    excludedRows: number;
  };
  splits: {
    devRows: number;
    heldOutRows: number;
    fullRows: number;
  };
  minimumRowsPerFailureMode: number;
  fixtureChangelog: FixtureChangelogSummary | null;
  coverage: MemoryEvalFailureModeCoverageSummary;
  notes: string[];
};

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_MIN_ROWS_PER_FAILURE_MODE = 5;

function usage(): string {
  return `Usage: pnpm memory:eval:fixture-check --fixture path/to/private.json [--fixture-changelog path/to/CHANGELOG.md] [--min-rows 5] [--require-changelog]

Validates a staged private memory eval fixture without printing any fixture rows,
redacted hints, or secret material. Output is aggregate-only.`;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    fixturePath: '',
    minimumRowsPerFailureMode: DEFAULT_MIN_ROWS_PER_FAILURE_MODE,
    requireChangelog: false,
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

    if (arg === '--min-rows') {
      options.minimumRowsPerFailureMode = parsePositiveInteger(readOptionValue(argv, index, arg));
      index += 1;
      continue;
    }

    if (arg === '--require-changelog') {
      options.requireChangelog = true;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  if (!options.fixturePath) {
    throw new Error('--fixture is required');
  }

  return options;
}

export function buildMemoryEvalFixtureCheckReport(options: {
  fixturePath: string;
  fixtureChangelogPath?: string;
  minimumRowsPerFailureMode?: number;
  requireChangelog?: boolean;
}): MemoryEvalFixtureCheckReport {
  const minimumRowsPerFailureMode =
    options.minimumRowsPerFailureMode ?? DEFAULT_MIN_ROWS_PER_FAILURE_MODE;
  const fixture = loadMemoryEvalFixture(path.resolve(options.fixturePath));
  const fixtureChangelog = readOptionalFixtureChangelog(options.fixtureChangelogPath);

  if (options.requireChangelog && !fixtureChangelog) {
    throw new Error(
      '--fixture-changelog is required so private fixture edits include a reviewed dated changelog entry.',
    );
  }

  const includedRows = fixture.rows.filter((row) => !row.excluded);
  if (includedRows.length === 0) {
    throw new Error(
      'Memory eval private fixture check rejected fixture because it has no included rows.',
    );
  }

  const privateRows = includedRows.filter((row) => !row.public);
  const publicRows = includedRows.filter((row) => row.public);

  if (privateRows.length === 0) {
    throw new Error(
      'Memory eval private fixture check rejected an all-public fixture: at least one included row must be marked public=false so the staged fixture actually contains private rows.',
    );
  }

  assertFailureModeCoverage(privateRows, {
    minimumPerTag: minimumRowsPerFailureMode,
  });

  const coverage = summarizeFailureModeCoverage(privateRows, {
    minimumPerTag: minimumRowsPerFailureMode,
  });
  const splits = summarizePrivateSplits(privateRows);

  if (splits.heldOutRows === 0) {
    throw new Error(
      'Memory eval private fixture check requires at least 2 included private rows so dev/held-out split discipline remains meaningful.',
    );
  }

  const notes: string[] = [];
  if (publicRows.length > 0) {
    notes.push(
      `${publicRows.length} included rows are marked public=true; coverage and split counts are computed from included private rows only.`,
    );
  }
  const excludedRows = fixture.rows.length - includedRows.length;
  if (excludedRows > 0) {
    notes.push(`${excludedRows} rows are excluded and were not counted.`);
  }

  return {
    visibility: {
      includedRows: includedRows.length,
      privateRows: privateRows.length,
      publicRows: publicRows.length,
      excludedRows,
    },
    splits,
    minimumRowsPerFailureMode,
    fixtureChangelog,
    coverage,
    notes,
  };
}

export function formatMemoryEvalFixtureCheckReport(report: MemoryEvalFixtureCheckReport): string {
  const sections = [
    [
      '# Memory Eval Private Fixture Check',
      '',
      `Included rows: ${report.visibility.includedRows}`,
      `Private rows: ${report.visibility.privateRows}`,
      `Public rows: ${report.visibility.publicRows}`,
      `Excluded rows: ${report.visibility.excludedRows}`,
      '',
      '## Private Split Counts',
      `Dev rows: ${report.splits.devRows}`,
      `Held-out rows: ${report.splits.heldOutRows}`,
      `Full rows: ${report.splits.fullRows}`,
      '',
      `Required private rows per failure-mode tag: ${report.minimumRowsPerFailureMode}`,
    ].join('\n'),
  ];

  if (report.fixtureChangelog) {
    sections.push(
      [
        '## Fixture Changelog',
        `Latest dated entry: ${report.fixtureChangelog.latestDatedEntry}`,
      ].join('\n'),
    );
  }

  if (report.notes.length > 0) {
    sections.push(['## Notes', ...report.notes.map((note) => `- ${note}`)].join('\n'));
  }

  sections.push(formatFailureModeCoverageMarkdown(report.coverage));
  return sections.join('\n\n');
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  const report = buildMemoryEvalFixtureCheckReport(options);
  console.log(formatMemoryEvalFixtureCheckReport(report));
}

function readOptionValue(argv: readonly string[], index: number, arg: string): string {
  const value = argv[index + 1];
  if (!value) {
    throw new Error(`${arg} requires a value`);
  }
  return value;
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('--min-rows must be a positive integer');
  }
  return parsed;
}

function readOptionalFixtureChangelog(
  fixtureChangelogPath: string | undefined,
): FixtureChangelogSummary | null {
  if (!fixtureChangelogPath) {
    return null;
  }

  return readMemoryEvalFixtureChangelog(path.resolve(fixtureChangelogPath));
}

function summarizePrivateSplits(
  privateRows: readonly MemoryEvalFixtureRow[],
): MemoryEvalFixtureCheckReport['splits'] {
  return {
    devRows: getDevSet(privateRows).length,
    heldOutRows: getHeldOutSet(privateRows, { allowHeldOut: true }).length,
    fullRows: getFullSet(privateRows, { allowFullSet: true }).length,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
