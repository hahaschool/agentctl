import { pathToFileURL } from 'node:url';

import {
  assertMemoryPlantedNeedleBenchPassed,
  runMemoryPlantedNeedleBench,
} from '../packages/control-plane/src/memory/memory-eval.js';

type CliOptions = {
  json: boolean;
};

function usage(): string {
  return `Usage: pnpm memory:bench [--json]

Runs the Phase 0 planted-needle memory regression bench in deterministic mock-ranking mode.
Configure with MEMORY_BENCH_NEEDLE_COUNT, MEMORY_BENCH_NOISE_COUNT, and MEMORY_BENCH_MIN_RECALL.`;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { json: false };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }

    if (arg === '--json') {
      options.json = true;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  const run = await runMemoryPlantedNeedleBench();

  if (options.json) {
    console.log(JSON.stringify(run, null, 2));
    assertMemoryPlantedNeedleBenchPassed(run);
    return;
  }

  console.log('# Memory Planted-Needle Bench');
  console.log('');
  console.log(`Rows: ${run.summary.totalRows}`);
  console.log(`Recall@5: ${run.summary.aggregate.recallAt5.toFixed(3)}`);
  console.log(`Required: ${run.config.minRecallAt5.toFixed(3)}`);
  console.log(
    `Latency ms: p50=${run.latency.p50DurationMs}, p95=${run.latency.p95DurationMs}, p99=${run.latency.p99DurationMs}`,
  );
  assertMemoryPlantedNeedleBenchPassed(run);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
