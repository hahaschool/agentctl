import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  createDeterministicMockRanker,
  formatMemoryEvalMarkdown,
  getDevSet,
  getFullSet,
  getHeldOutSet,
  loadMemoryEvalFixture,
  type MemoryEvalFixtureRow,
  runMemoryEval,
} from '../packages/control-plane/src/memory/memory-eval.js';

type EvalSplit = 'dev' | 'held-out' | 'full';

type CliOptions = {
  fixturePath: string;
  split: EvalSplit;
  json: boolean;
  mock: boolean;
  allowFullSet: boolean;
};

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_FIXTURE_PATH = path.join(
  REPO_ROOT,
  'docs/fixtures/memory-eval/agentctl-memory-eval.sample.json',
);

function usage(): string {
  return `Usage: pnpm memory:eval [--fixture path] [--split dev|held-out|full] [--json] [--mock]

Runs the Phase 0 memory eval harness in deterministic mock-ranking mode.
Live control-plane search wiring is intentionally out of scope for this first harness slice.`;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    fixturePath: DEFAULT_FIXTURE_PATH,
    split: 'dev',
    json: false,
    mock: true,
    allowFullSet: false,
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

    if (arg === '--allow-full') {
      options.allowFullSet = true;
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
    return getHeldOutSet(rows);
  }
  return getFullSet(rows, { allowFullSet: options.allowFullSet });
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  if (!options.mock) {
    throw new Error('Live memory search eval is not wired in Phase 0. Run with --mock.');
  }

  const fixture = loadMemoryEvalFixture(options.fixturePath);
  const rows = selectRows(fixture.rows, options);
  const run = await runMemoryEval(rows, createDeterministicMockRanker());

  if (options.json) {
    console.log(JSON.stringify(run, null, 2));
    return;
  }

  console.log(`# Memory Eval (${options.split}, mock ranking)`);
  console.log('');
  console.log(formatMemoryEvalMarkdown(run.summary));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
