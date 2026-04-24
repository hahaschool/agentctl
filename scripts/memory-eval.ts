import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import type { Logger } from 'pino';
import { EmbeddingClient } from '../packages/control-plane/src/memory/embedding-client.js';
import {
  assertFailureModeCoverage,
  createDeterministicMockRanker,
  formatFailureModeCoverageMarkdown,
  formatMemoryEvalReport,
  getDevSet,
  getFullSet,
  getHeldOutSet,
  loadMemoryEvalFixture,
  type MemoryEvalCandidate,
  type MemoryEvalFixtureRow,
  type MemoryEvalRanker,
  type MemoryEvalRun,
  runMemoryEval,
  summarizeFailureModeCoverage,
} from '../packages/control-plane/src/memory/memory-eval.js';
import { MemorySearch } from '../packages/control-plane/src/memory/memory-search.js';
import { MEMORY_EMBEDDING_MODEL } from '../packages/shared/src/memory/constants.js';

type EvalSplit = 'dev' | 'held-out' | 'full';

type CliOptions = {
  fixturePath: string;
  split: EvalSplit;
  json: boolean;
  mock: boolean;
};

export type LiveMemoryEvalConfig = {
  databaseUrl: string;
  embeddingBaseUrl: string;
  embeddingModel: string;
};

type MemoryEvalEnv = Record<string, string | undefined>;
type LiveMemorySearch = Pick<MemorySearch, 'search'>;

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_FIXTURE_PATH = path.join(
  REPO_ROOT,
  'docs/fixtures/memory-eval/agentctl-memory-eval.sample.json',
);
const LIVE_SEARCH_LIMIT = 10;
const EMBEDDING_BASE_URL_ENV_KEYS = [
  'EMBEDDING_API_URL',
  'LITELLM_PROXY_URL',
  'LITELLM_URL',
] as const;
const REQUIRE_FAILURE_MODE_COVERAGE_ENV = 'MEMORY_EVAL_REQUIRE_FAILURE_MODE_COVERAGE';
const FAILURE_MODE_MIN_ROWS_ENV = 'MEMORY_EVAL_FAILURE_MODE_MIN_ROWS';

function usage(): string {
  return `Usage: pnpm memory:eval [--fixture path] [--split dev|held-out|full] [--json] [--mock|--no-mock]

Runs the Phase 0 memory eval harness.

Default: deterministic mock ranking.
Live mode: --no-mock uses DATABASE_URL plus embedding config from EMBEDDING_API_URL,
LITELLM_PROXY_URL, or LITELLM_URL.`;
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    fixturePath: DEFAULT_FIXTURE_PATH,
    split: 'dev',
    json: false,
    mock: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--') {
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }

    if (arg === '--fixture') {
      const value = argv[index + 1];
      if (!value) throw new Error('--fixture requires a path');
      options.fixturePath = path.resolve(value);
      index += 1;
      continue;
    }

    if (arg === '--split') {
      const value = argv[index + 1];
      if (value !== 'dev' && value !== 'held-out' && value !== 'full') {
        throw new Error('--split must be one of: dev, held-out, full');
      }
      options.split = value;
      index += 1;
      continue;
    }

    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg === '--mock') {
      options.mock = true;
      continue;
    }

    if (arg === '--no-mock') {
      options.mock = false;
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    options.fixturePath = path.resolve(arg);
  }

  return options;
}

function selectRows(
  rows: readonly MemoryEvalFixtureRow[],
  options: CliOptions,
): MemoryEvalFixtureRow[] {
  if (options.split === 'dev') {
    return getDevSet(rows);
  }
  if (options.split === 'held-out') {
    return getHeldOutSet(rows, { env: process.env });
  }
  return getFullSet(rows, { env: process.env });
}

export function resolveLiveMemoryEvalConfig(
  env: MemoryEvalEnv = process.env,
): LiveMemoryEvalConfig {
  const databaseUrl = readRequiredEnv(env, 'DATABASE_URL');
  const embeddingBaseUrl = readFirstEnv(env, EMBEDDING_BASE_URL_ENV_KEYS);
  if (!embeddingBaseUrl) {
    throw new Error(
      '--no-mock requires an embedding base URL via EMBEDDING_API_URL, LITELLM_PROXY_URL, or LITELLM_URL',
    );
  }

  return {
    databaseUrl,
    embeddingBaseUrl,
    embeddingModel: env.EMBEDDING_MODEL?.trim() || MEMORY_EMBEDDING_MODEL,
  };
}

export function createLiveMemorySearchRanker(memorySearch: LiveMemorySearch): MemoryEvalRanker {
  return async (row) => {
    const results = await memorySearch.search({
      query: row.query,
      visibleScopes: [],
      limit: LIVE_SEARCH_LIMIT,
    });

    return results.map(
      (result, index): MemoryEvalCandidate => ({
        id: result.fact.id,
        factId: result.fact.id,
        score: result.score,
        metadata: {
          rank: index + 1,
          sourcePath: result.source_path,
        },
      }),
    );
  };
}

export async function runLiveMemoryEval(
  rows: readonly MemoryEvalFixtureRow[],
  config: LiveMemoryEvalConfig,
): Promise<MemoryEvalRun> {
  const pool = new Pool({ connectionString: config.databaseUrl });
  const logger = createScriptLogger();
  const embeddingClient = new EmbeddingClient({
    baseUrl: config.embeddingBaseUrl,
    model: config.embeddingModel,
    logger,
  });
  const memorySearch = new MemorySearch({
    pool,
    embeddingClient,
    logger,
  });

  try {
    return await runMemoryEval(rows, createLiveMemorySearchRanker(memorySearch));
  } finally {
    await pool.end();
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  const fixture = loadMemoryEvalFixture(options.fixturePath);
  const minimumPerTag = readOptionalPositiveIntegerEnv(process.env, FAILURE_MODE_MIN_ROWS_ENV);
  assertRequiredFailureModeCoverage(fixture.rows, options.fixturePath, minimumPerTag);
  const rows = selectRows(fixture.rows, options);
  const run = options.mock
    ? await runMemoryEval(rows, createDeterministicMockRanker())
    : await runLiveMemoryEval(rows, resolveLiveMemoryEvalConfig());

  if (options.json) {
    console.log(JSON.stringify(run, null, 2));
    return;
  }

  const sections = [
    `# Memory Eval (${options.split}, ${options.mock ? 'mock ranking' : 'live MemorySearch'})`,
    formatMemoryEvalReport(run),
  ];
  const failureModeCoverageSection = formatRequiredFailureModeCoverageSection(
    fixture.rows,
    minimumPerTag,
  );
  if (failureModeCoverageSection) {
    sections.push(failureModeCoverageSection);
  }
  console.log(sections.join('\n\n'));
}

function readRequiredEnv(env: MemoryEvalEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`--no-mock requires ${name}`);
  }
  return value;
}

function assertRequiredFailureModeCoverage(
  rows: readonly MemoryEvalFixtureRow[],
  fixturePath: string,
  minimumPerTag: number | undefined,
  env: MemoryEvalEnv = process.env,
): void {
  if (env[REQUIRE_FAILURE_MODE_COVERAGE_ENV] !== 'true') {
    return;
  }

  try {
    assertFailureModeCoverage(rows, {
      minimumPerTag,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${REQUIRE_FAILURE_MODE_COVERAGE_ENV}=true rejected fixture ${fixturePath}: ${message}. Add private rows for the missing failure-mode tags or unset ${REQUIRE_FAILURE_MODE_COVERAGE_ENV} for local public-fixture runs.`,
    );
  }
}

function readFirstEnv(env: MemoryEvalEnv, names: readonly string[]): string | null {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return null;
}

function readOptionalPositiveIntegerEnv(env: MemoryEvalEnv, name: string): number | undefined {
  const rawValue = env[name]?.trim();
  if (!rawValue) {
    return undefined;
  }

  const parsedValue = Number(rawValue);
  if (!Number.isInteger(parsedValue) || parsedValue < 1) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsedValue;
}

function formatRequiredFailureModeCoverageSection(
  rows: readonly MemoryEvalFixtureRow[],
  minimumPerTag: number | undefined,
  env: MemoryEvalEnv = process.env,
): string | null {
  if (env[REQUIRE_FAILURE_MODE_COVERAGE_ENV] !== 'true') {
    return null;
  }

  return formatFailureModeCoverageMarkdown(
    summarizeFailureModeCoverage(rows, {
      minimumPerTag,
    }),
  );
}

function createScriptLogger(): Logger {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
    child() {
      return this;
    },
  } as Logger;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
