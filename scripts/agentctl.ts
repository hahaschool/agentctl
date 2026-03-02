#!/usr/bin/env npx tsx
// =============================================================================
// agentctl — CLI tool for managing the AgentCTL fleet
//
// Usage:
//   npx tsx scripts/agentctl.ts <command> [args...]
//
// Environment:
//   CONTROL_URL  Base URL of the control plane (default: http://localhost:8080)
//
// Commands:
//   machines                  List registered machines
//   agents                    List registered agents
//   start <agentId> <prompt>  Start an agent with a prompt
//   stop <agentId>            Stop an agent
//   signal <agentId> <prompt> Send a signal to an agent
//   models                    List available LLM models
//   health                    Check control plane health
//   memory search <query>     Search memories by semantic query
//   schedule list             List scheduled (repeatable) jobs
//   schedule add-heartbeat    Add a heartbeat job
//   schedule add-cron         Add a cron job
//   schedule remove <key>     Remove a scheduled job by key
//   runs <agentId> [limit]    Show recent runs for an agent
//   help                      Show this help message
// =============================================================================

// ---------------------------------------------------------------------------
// ANSI color helpers
// ---------------------------------------------------------------------------

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
} as const;

function green(text: string): string {
  return `${ANSI.green}${text}${ANSI.reset}`;
}

function red(text: string): string {
  return `${ANSI.red}${text}${ANSI.reset}`;
}

function bold(text: string): string {
  return `${ANSI.bold}${text}${ANSI.reset}`;
}

function dim(text: string): string {
  return `${ANSI.dim}${text}${ANSI.reset}`;
}

function cyan(text: string): string {
  return `${ANSI.cyan}${text}${ANSI.reset}`;
}

function yellow(text: string): string {
  return `${ANSI.yellow}${text}${ANSI.reset}`;
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

class CliError extends Error {
  constructor(
    public code: string,
    message: string,
    public context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CONTROL_URL = (process.env.CONTROL_URL ?? 'http://localhost:8080').replace(/\/$/, '');

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

async function request(
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const url = `${CONTROL_URL}${path}`;

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  const init: RequestInit = { method, headers };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError('CONNECTION_FAILED', `Failed to connect to ${CONTROL_URL}: ${message}`, {
      url,
    });
  }

  let data: unknown;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    const text = await response.text();
    data = text;
  }

  if (!response.ok) {
    const errorMessage =
      typeof data === 'object' && data !== null && 'error' in data
        ? String((data as Record<string, unknown>).error)
        : `HTTP ${response.status} ${response.statusText}`;

    throw new CliError('HTTP_ERROR', errorMessage, {
      status: response.status,
      url,
      body: data,
    });
  }

  return data;
}

// ---------------------------------------------------------------------------
// Table formatting
// ---------------------------------------------------------------------------

function printTable(headers: string[], rows: string[][]): void {
  if (rows.length === 0) {
    console.log(dim('  (no results)'));
    return;
  }

  // Calculate column widths
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));

  // Header
  const headerLine = headers.map((h, i) => h.padEnd(widths[i]!)).join('  ');
  console.log(bold(headerLine));

  // Separator
  const separator = widths.map((w) => '-'.repeat(w)).join('  ');
  console.log(dim(separator));

  // Rows
  for (const row of rows) {
    const line = row.map((cell, i) => (cell ?? '').padEnd(widths[i]!)).join('  ');
    console.log(line);
  }
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

async function cmdHealth(): Promise<void> {
  const data = (await request('GET', '/health')) as { status: string; timestamp: string };

  if (data.status === 'ok') {
    console.log(green('✓') + ' Control plane is ' + green('healthy'));
  } else {
    console.log(red('✗') + ' Control plane status: ' + red(data.status));
  }
  console.log(dim(`  timestamp: ${data.timestamp}`));
  console.log(dim(`  endpoint:  ${CONTROL_URL}`));
}

async function cmdMachines(): Promise<void> {
  const data = await request('GET', '/api/agents');

  if (!Array.isArray(data)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(bold(`\nRegistered Machines (${data.length})\n`));

  const headers = ['MACHINE ID', 'HOSTNAME', 'STATUS', 'LAST SEEN'];
  const rows = data.map((m: Record<string, unknown>) => [
    String(m.machineId ?? m.id ?? ''),
    String(m.hostname ?? ''),
    String(m.status ?? m.state ?? 'unknown'),
    m.lastHeartbeat
      ? new Date(String(m.lastHeartbeat)).toLocaleString()
      : m.lastSeen
        ? new Date(String(m.lastSeen)).toLocaleString()
        : '-',
  ]);

  printTable(headers, rows);
  console.log('');
}

async function cmdAgents(): Promise<void> {
  const data = await request('GET', '/api/agents/agents/list');

  if (!Array.isArray(data)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(bold(`\nRegistered Agents (${data.length})\n`));

  const headers = ['AGENT ID', 'NAME', 'MACHINE', 'TYPE', 'STATUS', 'SCHEDULE'];
  const rows = data.map((a: Record<string, unknown>) => [
    String(a.id ?? a.agentId ?? ''),
    String(a.name ?? ''),
    String(a.machineId ?? ''),
    String(a.type ?? ''),
    String(a.status ?? 'unknown'),
    String(a.schedule ?? '-'),
  ]);

  printTable(headers, rows);
  console.log('');
}

async function cmdStart(agentId: string, prompt: string): Promise<void> {
  const data = (await request('POST', `/api/agents/${encodeURIComponent(agentId)}/start`, {
    prompt,
  })) as Record<string, unknown>;

  console.log(green('✓') + ' Agent start request sent');
  console.log(`  agentId: ${cyan(agentId)}`);
  if (data.jobId) {
    console.log(`  jobId:   ${String(data.jobId)}`);
  }
  console.log(`  prompt:  ${dim(prompt)}`);
}

async function cmdStop(agentId: string): Promise<void> {
  const data = (await request('POST', `/api/agents/${encodeURIComponent(agentId)}/stop`, {
    reason: 'user',
    graceful: true,
  })) as Record<string, unknown>;

  console.log(green('✓') + ' Agent stop request sent');
  console.log(`  agentId: ${cyan(agentId)}`);
  if (data.removedRepeatableJobs !== undefined) {
    console.log(`  removedRepeatableJobs: ${String(data.removedRepeatableJobs)}`);
  }
}

async function cmdSignal(agentId: string, prompt: string): Promise<void> {
  const data = (await request('POST', `/api/agents/${encodeURIComponent(agentId)}/signal`, {
    prompt,
  })) as Record<string, unknown>;

  console.log(green('✓') + ' Signal sent to agent');
  console.log(`  agentId: ${cyan(agentId)}`);
  if (data.jobId) {
    console.log(`  jobId:   ${String(data.jobId)}`);
  }
  console.log(`  prompt:  ${dim(prompt)}`);
}

async function cmdModels(): Promise<void> {
  const data = (await request('GET', '/api/router/models')) as { models: unknown[] };

  if (!Array.isArray(data.models)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(bold(`\nAvailable Models (${data.models.length})\n`));

  // Models may be strings or objects — handle both
  const isStringList = data.models.every((m) => typeof m === 'string');

  if (isStringList) {
    const headers = ['#', 'MODEL ID'];
    const rows = data.models.map((m, i) => [String(i + 1), String(m)]);
    printTable(headers, rows);
  } else {
    const headers = ['MODEL ID', 'PROVIDER', 'STATUS'];
    const rows = data.models.map((m: unknown) => {
      const model = m as Record<string, unknown>;
      return [
        String(model.id ?? model.model_name ?? model.model ?? ''),
        String(model.provider ?? model.litellm_provider ?? ''),
        String(model.status ?? 'available'),
      ];
    });
    printTable(headers, rows);
  }

  console.log('');
}

async function cmdMemorySearch(query: string): Promise<void> {
  const data = (await request('POST', '/api/memory/search', { query })) as {
    results: unknown[];
  };

  if (!Array.isArray(data.results) || data.results.length === 0) {
    console.log(yellow('No memories found for query: ') + dim(query));
    return;
  }

  console.log(bold(`\nMemory Search Results (${data.results.length})\n`));

  for (let i = 0; i < data.results.length; i++) {
    const result = data.results[i] as Record<string, unknown>;
    const index = dim(`[${i + 1}]`);
    const memory = String(result.memory ?? result.content ?? result.text ?? '');
    const score = result.score !== undefined ? ` ${dim(`(score: ${String(result.score)})`)}` : '';
    const id = result.id ? dim(` id=${String(result.id)}`) : '';

    console.log(`${index} ${memory}${score}${id}`);
  }

  console.log('');
}

// ---------------------------------------------------------------------------
// Schedule subcommands
// ---------------------------------------------------------------------------

async function cmdScheduleList(): Promise<void> {
  const data = (await request('GET', '/api/scheduler/jobs')) as { jobs: unknown[] };

  if (!Array.isArray(data.jobs)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(bold(`\nScheduled Jobs (${data.jobs.length})\n`));

  const headers = ['KEY', 'NAME', 'PATTERN', 'EVERY', 'NEXT RUN'];
  const rows = data.jobs.map((j: unknown) => {
    const job = j as Record<string, unknown>;
    return [
      String(job.key ?? ''),
      String(job.name ?? ''),
      job.pattern ? String(job.pattern) : '-',
      job.every ? `${String(job.every)}ms` : '-',
      job.next ? new Date(Number(job.next)).toLocaleString() : '-',
    ];
  });

  printTable(headers, rows);
  console.log('');
}

async function cmdScheduleAddHeartbeat(
  agentId: string,
  machineId: string,
  intervalMs: number,
): Promise<void> {
  const data = (await request('POST', '/api/scheduler/jobs/heartbeat', {
    agentId,
    machineId,
    intervalMs,
  })) as Record<string, unknown>;

  console.log(green('✓') + ' Heartbeat job added');
  console.log(`  agentId:    ${cyan(agentId)}`);
  console.log(`  machineId:  ${machineId}`);
  console.log(`  intervalMs: ${String(intervalMs)}`);
  if (data.ok !== undefined) {
    console.log(dim(`  ok: ${String(data.ok)}`));
  }
}

async function cmdScheduleAddCron(
  agentId: string,
  machineId: string,
  pattern: string,
  model: string | null,
): Promise<void> {
  const body: Record<string, unknown> = { agentId, machineId, pattern };
  if (model) {
    body.model = model;
  }

  const data = (await request('POST', '/api/scheduler/jobs/cron', body)) as Record<string, unknown>;

  console.log(green('✓') + ' Cron job added');
  console.log(`  agentId:   ${cyan(agentId)}`);
  console.log(`  machineId: ${machineId}`);
  console.log(`  pattern:   ${pattern}`);
  if (model) {
    console.log(`  model:     ${model}`);
  }
  if (data.ok !== undefined) {
    console.log(dim(`  ok: ${String(data.ok)}`));
  }
}

async function cmdScheduleRemove(key: string): Promise<void> {
  const data = (await request(
    'DELETE',
    `/api/scheduler/jobs/${encodeURIComponent(key)}`,
  )) as Record<string, unknown>;

  console.log(green('✓') + ' Scheduled job removed');
  console.log(`  key:          ${cyan(key)}`);
  if (data.removedCount !== undefined) {
    console.log(`  removedCount: ${String(data.removedCount)}`);
  }
}

// ---------------------------------------------------------------------------
// Runs subcommand
// ---------------------------------------------------------------------------

async function cmdRuns(agentId: string, limit: number): Promise<void> {
  const path =
    `/api/agents/agents/${encodeURIComponent(agentId)}/runs` +
    (limit ? `?limit=${limit}` : '');

  const data = await request('GET', path);

  if (!Array.isArray(data)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(bold(`\nRecent Runs for ${cyan(agentId)} (${data.length})\n`));

  const headers = ['RUN ID', 'TRIGGER', 'STATUS', 'MODEL', 'COST (USD)', 'STARTED', 'DURATION'];
  const rows = data.map((r: unknown) => {
    const run = r as Record<string, unknown>;
    const startedAt = run.startedAt ? new Date(String(run.startedAt)) : null;
    const finishedAt = run.finishedAt ? new Date(String(run.finishedAt)) : null;

    let duration = '-';
    if (startedAt && finishedAt) {
      const ms = finishedAt.getTime() - startedAt.getTime();
      if (ms < 1000) {
        duration = `${ms}ms`;
      } else if (ms < 60000) {
        duration = `${(ms / 1000).toFixed(1)}s`;
      } else {
        duration = `${(ms / 60000).toFixed(1)}m`;
      }
    } else if (run.status === 'running') {
      duration = 'running...';
    }

    const cost = run.costUsd != null ? `$${Number(run.costUsd).toFixed(4)}` : '-';

    return [
      String(run.id ?? ''),
      String(run.trigger ?? '-'),
      String(run.status ?? 'unknown'),
      String(run.model ?? '-'),
      cost,
      startedAt ? startedAt.toLocaleString() : '-',
      duration,
    ];
  });

  printTable(headers, rows);
  console.log('');
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`
${bold('agentctl')} — CLI tool for managing the AgentCTL fleet

${bold('USAGE')}
  npx tsx scripts/agentctl.ts ${cyan('<command>')} [args...]

${bold('ENVIRONMENT')}
  CONTROL_URL  Base URL of the control plane (default: ${dim('http://localhost:8080')})

${bold('COMMANDS')}
  ${cyan('machines')}                   List registered machines
  ${cyan('agents')}                     List registered agents (requires database)
  ${cyan('start')} <agentId> <prompt>   Start an agent with a prompt
  ${cyan('stop')} <agentId>             Stop an agent gracefully
  ${cyan('signal')} <agentId> <prompt>  Send a signal to trigger an agent run
  ${cyan('models')}                     List available LLM models via LiteLLM
  ${cyan('health')}                     Check control plane health
  ${cyan('memory search')} <query>      Search memories by semantic query
  ${cyan('schedule list')}              List all scheduled (repeatable) jobs
  ${cyan('schedule add-heartbeat')} <agentId> <machineId> <intervalMs>
                               Add a heartbeat job
  ${cyan('schedule add-cron')} <agentId> <machineId> <pattern> [model]
                               Add a cron job
  ${cyan('schedule remove')} <key>      Remove a scheduled job by key
  ${cyan('runs')} <agentId> [limit]     Show recent runs for an agent
  ${cyan('help')}                       Show this help message

${bold('EXAMPLES')}
  ${dim('# Check if the control plane is running')}
  npx tsx scripts/agentctl.ts health

  ${dim('# List all machines in the fleet')}
  npx tsx scripts/agentctl.ts machines

  ${dim('# Start an agent with a task')}
  npx tsx scripts/agentctl.ts start agent-1 "Fix the login bug in auth.ts"

  ${dim('# Send a signal to a running agent')}
  npx tsx scripts/agentctl.ts signal agent-1 "Also update the tests"

  ${dim('# Search through agent memory')}
  npx tsx scripts/agentctl.ts memory search "authentication flow"

  ${dim('# List all scheduled jobs')}
  npx tsx scripts/agentctl.ts schedule list

  ${dim('# Add a heartbeat job (every 30 seconds)')}
  npx tsx scripts/agentctl.ts schedule add-heartbeat agent-1 ec2-us-east-1 30000

  ${dim('# Add a cron job (every 5 minutes)')}
  npx tsx scripts/agentctl.ts schedule add-cron agent-2 mac-mini "*/5 * * * *"

  ${dim('# Add a cron job with a specific model')}
  npx tsx scripts/agentctl.ts schedule add-cron agent-2 mac-mini "0 */6 * * *" claude-sonnet-4-20250514

  ${dim('# Remove a scheduled job')}
  npx tsx scripts/agentctl.ts schedule remove agent-1

  ${dim('# Show last 10 runs for an agent')}
  npx tsx scripts/agentctl.ts runs agent-1 10

  ${dim('# Use a different control plane URL')}
  CONTROL_URL=http://ec2-host:8080 npx tsx scripts/agentctl.ts machines
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  switch (command) {
    case 'health':
      await cmdHealth();
      break;

    case 'machines':
      await cmdMachines();
      break;

    case 'agents':
      await cmdAgents();
      break;

    case 'start': {
      const agentId = args[1];
      const prompt = args.slice(2).join(' ');

      if (!agentId || !prompt) {
        console.error(red('Error: ') + 'Usage: agentctl start <agentId> <prompt>');
        process.exit(1);
      }

      await cmdStart(agentId, prompt);
      break;
    }

    case 'stop': {
      const agentId = args[1];

      if (!agentId) {
        console.error(red('Error: ') + 'Usage: agentctl stop <agentId>');
        process.exit(1);
      }

      await cmdStop(agentId);
      break;
    }

    case 'signal': {
      const agentId = args[1];
      const prompt = args.slice(2).join(' ');

      if (!agentId || !prompt) {
        console.error(red('Error: ') + 'Usage: agentctl signal <agentId> <prompt>');
        process.exit(1);
      }

      await cmdSignal(agentId, prompt);
      break;
    }

    case 'models':
      await cmdModels();
      break;

    case 'memory': {
      const subcommand = args[1];

      if (subcommand === 'search') {
        const query = args.slice(2).join(' ');

        if (!query) {
          console.error(red('Error: ') + 'Usage: agentctl memory search <query>');
          process.exit(1);
        }

        await cmdMemorySearch(query);
      } else {
        console.error(red('Error: ') + `Unknown memory subcommand: ${subcommand ?? '(none)'}`);
        console.error('Available: memory search <query>');
        process.exit(1);
      }
      break;
    }

    case 'schedule': {
      const subcommand = args[1];

      if (subcommand === 'list') {
        await cmdScheduleList();
      } else if (subcommand === 'add-heartbeat') {
        const agentId = args[2];
        const machineId = args[3];
        const intervalMs = Number(args[4]);

        if (!agentId || !machineId || !Number.isFinite(intervalMs) || intervalMs <= 0) {
          console.error(
            red('Error: ') +
              'Usage: agentctl schedule add-heartbeat <agentId> <machineId> <intervalMs>',
          );
          process.exit(1);
        }

        await cmdScheduleAddHeartbeat(agentId, machineId, intervalMs);
      } else if (subcommand === 'add-cron') {
        const agentId = args[2];
        const machineId = args[3];
        const pattern = args[4];
        const model = args[5] ?? null;

        if (!agentId || !machineId || !pattern) {
          console.error(
            red('Error: ') +
              'Usage: agentctl schedule add-cron <agentId> <machineId> <pattern> [model]',
          );
          process.exit(1);
        }

        await cmdScheduleAddCron(agentId, machineId, pattern, model);
      } else if (subcommand === 'remove') {
        const key = args[2];

        if (!key) {
          console.error(red('Error: ') + 'Usage: agentctl schedule remove <key>');
          process.exit(1);
        }

        await cmdScheduleRemove(key);
      } else {
        console.error(
          red('Error: ') + `Unknown schedule subcommand: ${subcommand ?? '(none)'}`,
        );
        console.error('Available: schedule list | add-heartbeat | add-cron | remove');
        process.exit(1);
      }
      break;
    }

    case 'runs': {
      const agentId = args[1];
      const limit = args[2] ? Number(args[2]) : 20;

      if (!agentId) {
        console.error(red('Error: ') + 'Usage: agentctl runs <agentId> [limit]');
        process.exit(1);
      }

      if (args[2] && (!Number.isFinite(limit) || limit < 1)) {
        console.error(red('Error: ') + 'Limit must be a positive integer');
        process.exit(1);
      }

      await cmdRuns(agentId, limit);
      break;
    }

    default:
      console.error(red('Error: ') + `Unknown command: ${command}`);
      console.error('Run "agentctl help" for usage information.');
      process.exit(1);
  }
}

main().catch((error: unknown) => {
  if (error instanceof CliError) {
    console.error(red('Error') + ` [${error.code}]: ${error.message}`);
    if (error.context?.status) {
      console.error(dim(`  HTTP status: ${String(error.context.status)}`));
    }
    if (error.context?.body && typeof error.context.body === 'object') {
      const body = error.context.body as Record<string, unknown>;
      if (body.message) {
        console.error(dim(`  detail: ${String(body.message)}`));
      }
    }
  } else if (error instanceof Error) {
    console.error(red('Error: ') + error.message);
  } else {
    console.error(red('Error: ') + String(error));
  }
  process.exit(1);
});
