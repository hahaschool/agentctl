import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  assertFailureModeCoverage,
  formatFailureModeCoverageMarkdown,
  loadMemoryEvalFixture,
  type MemoryEvalFailureModeCoverageSummary,
  readMemoryEvalFixtureChangelog,
  summarizeFailureModeCoverage,
} from '../packages/control-plane/src/memory/memory-eval.js';

const DEFAULT_REPOSITORY = 'hahaschool/agentctl';
const GITHUB_SECRET_VALUE_LIMIT_BYTES = 48 * 1024;
const PRIVATE_FIXTURE_SECRET = 'MEMORY_EVAL_PRIVATE_FIXTURE_JSON_B64';
const PRIVATE_FIXTURE_CHANGELOG_SECRET = 'MEMORY_EVAL_PRIVATE_FIXTURE_CHANGELOG_B64';
const FAILURE_MODE_MIN_ROWS_VARIABLE = 'MEMORY_EVAL_FAILURE_MODE_MIN_ROWS';
const RELEASE_REQUIRED_VARIABLE = 'MEMORY_EVAL_RELEASE_REQUIRED';

type CliOptions = {
  fixturePath?: string;
  fixtureChangelogPath?: string;
  repo: string;
  minimumRowsPerFailureMode?: number;
  releaseRequired?: boolean;
  apply: boolean;
};

type EncodedSecretMaterial = {
  path: string;
  sha256: string;
  encodedBase64: string;
  encodedBytes: number;
};

export type MemoryEvalSecretProvisioningPlan = {
  repo: string;
  fixture: EncodedSecretMaterial & {
    rowCount: number;
  };
  changelog: EncodedSecretMaterial & {
    latestDatedEntry: string;
  };
  coverage: MemoryEvalFailureModeCoverageSummary;
  minimumRowsPerFailureMode: number;
  releaseRequired?: boolean;
};

export type GhRunner = (args: readonly string[], stdin: string) => void;

export type ApplyMemoryEvalSecretProvisioningDeps = {
  runGh?: GhRunner;
};

export function buildMemoryEvalSecretProvisioningPlan(options: {
  fixturePath: string;
  fixtureChangelogPath: string;
  repo?: string;
  minimumRowsPerFailureMode?: number;
  releaseRequired?: boolean;
}): MemoryEvalSecretProvisioningPlan {
  const repo = normalizeRepo(options.repo ?? DEFAULT_REPOSITORY);
  const minimumRowsPerFailureMode = options.minimumRowsPerFailureMode ?? 5;
  const fixturePath = path.resolve(options.fixturePath);
  const fixtureChangelogPath = path.resolve(options.fixtureChangelogPath);
  const fixture = loadMemoryEvalFixture(fixturePath);

  assertFailureModeCoverage(fixture.rows, {
    minimumPerTag: minimumRowsPerFailureMode,
  });

  const coverage = summarizeFailureModeCoverage(fixture.rows, {
    minimumPerTag: minimumRowsPerFailureMode,
  });
  const changelogSummary = readMemoryEvalFixtureChangelog(fixtureChangelogPath);
  const fixtureSecret = encodeSecretFile(fixturePath, PRIVATE_FIXTURE_SECRET);
  const changelogSecret = encodeSecretFile(fixtureChangelogPath, PRIVATE_FIXTURE_CHANGELOG_SECRET);

  return {
    repo,
    fixture: {
      ...fixtureSecret,
      rowCount: fixture.rows.length,
    },
    changelog: {
      ...changelogSecret,
      latestDatedEntry: changelogSummary.latestDatedEntry,
    },
    coverage,
    minimumRowsPerFailureMode,
    releaseRequired: options.releaseRequired,
  };
}

export function formatMemoryEvalSecretProvisioningPlan(
  plan: MemoryEvalSecretProvisioningPlan,
): string {
  const lines = [
    '# Memory Eval Private Fixture Secret Preflight',
    '',
    `Repository: ${plan.repo}`,
    `Fixture: ${plan.fixture.path}`,
    `Fixture rows: ${plan.fixture.rowCount}`,
    `Fixture SHA256: ${plan.fixture.sha256}`,
    `Fixture encoded size: ${plan.fixture.encodedBytes} bytes`,
    `Changelog: ${plan.changelog.path}`,
    `Changelog SHA256: ${plan.changelog.sha256}`,
    `Changelog encoded size: ${plan.changelog.encodedBytes} bytes`,
    `Latest changelog entry: ${plan.changelog.latestDatedEntry}`,
    '',
    'Secrets ready to rotate:',
    `- ${PRIVATE_FIXTURE_SECRET}`,
    `- ${PRIVATE_FIXTURE_CHANGELOG_SECRET}`,
    '',
    'Repository variables ready to set:',
    `- ${FAILURE_MODE_MIN_ROWS_VARIABLE}=${plan.minimumRowsPerFailureMode}`,
  ];

  if (plan.releaseRequired !== undefined) {
    lines.push(`- ${RELEASE_REQUIRED_VARIABLE}=${String(plan.releaseRequired)}`);
  } else {
    lines.push(`- ${RELEASE_REQUIRED_VARIABLE}: unchanged`);
  }

  lines.push('', formatFailureModeCoverageMarkdown(plan.coverage));
  lines.push('', 'Secret values are not printed. Use --apply to write them with gh via stdin.');

  return lines.join('\n');
}

export function applyMemoryEvalSecretProvisioning(
  plan: MemoryEvalSecretProvisioningPlan,
  deps: ApplyMemoryEvalSecretProvisioningDeps = {},
): void {
  const runGh = deps.runGh ?? runGhWithStdin;
  runGh(['secret', 'set', PRIVATE_FIXTURE_SECRET, '--repo', plan.repo], plan.fixture.encodedBase64);
  runGh(
    ['secret', 'set', PRIVATE_FIXTURE_CHANGELOG_SECRET, '--repo', plan.repo],
    plan.changelog.encodedBase64,
  );
  runGh(
    ['variable', 'set', FAILURE_MODE_MIN_ROWS_VARIABLE, '--repo', plan.repo],
    String(plan.minimumRowsPerFailureMode),
  );
  if (plan.releaseRequired !== undefined) {
    runGh(
      ['variable', 'set', RELEASE_REQUIRED_VARIABLE, '--repo', plan.repo],
      String(plan.releaseRequired),
    );
  }
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    repo: DEFAULT_REPOSITORY,
    apply: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }

    if (arg === '--fixture') {
      options.fixturePath = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--fixture-changelog') {
      options.fixtureChangelogPath = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--repo') {
      options.repo = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === '--min-rows') {
      options.minimumRowsPerFailureMode = parsePositiveInteger(readOptionValue(argv, index, arg));
      index += 1;
      continue;
    }

    if (arg === '--release-required') {
      options.releaseRequired = parseBoolean(readOptionValue(argv, index, arg));
      index += 1;
      continue;
    }

    if (arg === '--apply') {
      options.apply = true;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  if (!options.fixturePath) {
    throw new Error('--fixture is required');
  }
  if (!options.fixtureChangelogPath) {
    throw new Error('--fixture-changelog is required');
  }

  return options;
}

async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  const plan = buildMemoryEvalSecretProvisioningPlan({
    fixturePath: options.fixturePath as string,
    fixtureChangelogPath: options.fixtureChangelogPath as string,
    repo: options.repo,
    minimumRowsPerFailureMode: options.minimumRowsPerFailureMode,
    releaseRequired: options.releaseRequired,
  });

  console.log(formatMemoryEvalSecretProvisioningPlan(plan));

  if (!options.apply) {
    return;
  }

  applyMemoryEvalSecretProvisioning(plan);
  console.log('\nApplied memory eval fixture secrets and variables with gh.');
}

function encodeSecretFile(filePath: string, secretName: string): EncodedSecretMaterial {
  const content = fs.readFileSync(filePath);
  const encodedBase64 = content.toString('base64');
  const encodedBytes = Buffer.byteLength(encodedBase64, 'utf8');

  if (encodedBytes > GITHUB_SECRET_VALUE_LIMIT_BYTES) {
    throw new Error(
      `${secretName} would be ${encodedBytes} bytes after base64 encoding, above the 48 KiB GitHub Actions secret limit. Shrink the private fixture/changelog or split the workflow storage model before rotating this secret.`,
    );
  }

  return {
    path: filePath,
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
    encodedBase64,
    encodedBytes,
  };
}

function runGhWithStdin(args: readonly string[], stdin: string): void {
  const result = spawnSync('gh', [...args], {
    input: stdin,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (result.status === 0) {
    return;
  }

  const stderr = redactSecretMaterial(result.stderr ?? '', stdin).trim();
  const stdout = redactSecretMaterial(result.stdout ?? '', stdin).trim();
  const details = [stderr, stdout].filter(Boolean).join('\n');
  throw new Error(`gh ${args.slice(0, 3).join(' ')} failed${details ? `: ${details}` : ''}`);
}

function redactSecretMaterial(text: string, secretBody: string): string {
  return secretBody ? text.split(secretBody).join('[REDACTED]') : text;
}

function normalizeRepo(repo: string): string {
  const normalized = repo.trim();
  if (!normalized || /[\s\p{Cc}]/u.test(normalized)) {
    throw new Error('--repo must be a non-empty GitHub repository slug without whitespace');
  }
  return normalized;
}

function readOptionValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parsePositiveInteger(rawValue: string): number {
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('--min-rows must be a positive integer');
  }
  return value;
}

function parseBoolean(rawValue: string): boolean {
  if (rawValue === 'true') {
    return true;
  }
  if (rawValue === 'false') {
    return false;
  }
  throw new Error('--release-required must be true or false');
}

function usage(): string {
  return `Usage: pnpm memory:eval:secrets --fixture path --fixture-changelog path [--repo owner/repo] [--min-rows n] [--release-required true|false] [--apply]

Validates a private memory-eval fixture and dated changelog, then prepares the
base64 GitHub Actions secrets required by .github/workflows/memory-evals.yml.

Default mode is a dry run and never prints secret values. Add --apply to call
gh secret set / gh variable set; secret values are passed through stdin.`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
