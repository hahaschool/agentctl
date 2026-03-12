#!/usr/bin/env npx tsx
// =============================================================================
// deploy — Deployment management CLI for AgentCTL
//
// Usage:
//   pnpm deploy <command> [options]
//   npx tsx scripts/deploy.ts <command> [options]
//
// Commands:
//   init [--prod]                 Check deps, generate .env, install, build, migrate
//   up [--prod] [--worker]        Start services (dev or Docker prod)
//   down                          Stop running services
//   status                        Show health of all services
//   logs <service>                Tail logs for a service (cp|worker|web)
//   help                          Show this help message
// =============================================================================

import { type ChildProcess, execFile, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';

// ---------------------------------------------------------------------------
// ANSI color helpers (mirroring agentctl.ts)
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

class DeployError extends Error {
  constructor(
    public code: string,
    message: string,
    public context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DeployError';
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROOT_DIR = path.resolve(import.meta.dirname ?? __dirname, '..');
const ENV_FILE = path.join(ROOT_DIR, '.env');
const ENV_EXAMPLE = path.join(ROOT_DIR, '.env.example');
const COMPOSE_FILE = path.join(ROOT_DIR, 'infra/docker/docker-compose.prod.yml');

const SERVICES = {
  'control-plane': { port: 8080, healthPath: '/health', label: 'Control Plane' },
  worker: { port: 9000, healthPath: '/health', label: 'Agent Worker' },
  web: { port: 5173, healthPath: '/', label: 'Web UI' },
} as const;

// ---------------------------------------------------------------------------
// Utility: execute a command and return stdout
// ---------------------------------------------------------------------------

function exec(
  cmd: string,
  args: readonly string[],
  options?: { cwd?: string; timeout?: number },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      {
        cwd: options?.cwd ?? ROOT_DIR,
        timeout: options?.timeout ?? 120_000,
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const exitCode =
          error && 'code' in error && typeof error.code === 'number' ? error.code : error ? 1 : 0;
        resolve({
          stdout: String(stdout),
          stderr: String(stderr),
          exitCode,
        });
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Utility: prompt user for input
// ---------------------------------------------------------------------------

function prompt(question: string, defaultValue?: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const suffix = defaultValue ? ` ${dim(`[${defaultValue}]`)}` : '';

  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

// ---------------------------------------------------------------------------
// Utility: check if a port is listening
// ---------------------------------------------------------------------------

async function isPortListening(port: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const resp = await fetch(`http://localhost:${String(port)}/`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    // Any response (even 404) means something is listening
    return resp.status > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Utility: fetch health with timeout
// ---------------------------------------------------------------------------

async function fetchHealth(
  port: number,
  healthPath: string,
): Promise<{ ok: boolean; status: string; body?: Record<string, unknown> }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const resp = await fetch(`http://localhost:${String(port)}${healthPath}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    let body: Record<string, unknown> | undefined;
    try {
      body = (await resp.json()) as Record<string, unknown>;
    } catch {
      // not JSON, that's fine (e.g. web UI returns HTML)
    }

    return { ok: resp.ok, status: `${String(resp.status)} OK`, body };
  } catch {
    return { ok: false, status: 'DOWN' };
  }
}

// ---------------------------------------------------------------------------
// Utility: check if a command exists
// ---------------------------------------------------------------------------

async function commandExists(cmd: string): Promise<boolean> {
  const { exitCode } = await exec('which', [cmd]);
  return exitCode === 0;
}

// ---------------------------------------------------------------------------
// Utility: get version of a command
// ---------------------------------------------------------------------------

async function getVersion(
  cmd: string,
  args: readonly string[] = ['--version'],
): Promise<string | null> {
  const { stdout, exitCode } = await exec(cmd, args);
  if (exitCode !== 0) return null;
  const match = stdout.match(/(\d+\.\d+[\w.-]*)/);
  return match?.[1] ?? stdout.trim();
}

// ---------------------------------------------------------------------------
// Utility: detect running PostgreSQL port
// ---------------------------------------------------------------------------

async function detectPostgresPort(): Promise<number | null> {
  // Try common ports
  for (const port of [5432, 5433]) {
    const { exitCode } = await exec('pg_isready', ['-h', 'localhost', '-p', String(port)]);
    if (exitCode === 0) return port;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Utility: detect running Redis port
// ---------------------------------------------------------------------------

async function detectRedisPort(): Promise<number | null> {
  const { exitCode } = await exec('redis-cli', ['-p', '6379', 'ping']);
  if (exitCode === 0) return 6379;
  return null;
}

// ---------------------------------------------------------------------------
// Checklist display
// ---------------------------------------------------------------------------

function printCheck(ok: boolean, label: string, detail?: string): void {
  const icon = ok ? green('  [OK]') : red('  [FAIL]');
  const extra = detail ? ` ${dim(detail)}` : '';
  console.log(`${icon} ${label}${extra}`);
}

// ---------------------------------------------------------------------------
// Command: init
// ---------------------------------------------------------------------------

async function cmdInit(isProd: boolean): Promise<void> {
  console.log(
    `\n${bold('agentctl deploy init')} ${isProd ? dim('(production)') : dim('(development)')}\n`,
  );

  // ── Step 1: Check dependencies ────────────────────────────────
  console.log(bold('Checking dependencies...'));

  const nodeVersion = await getVersion('node', ['-v']);
  const nodeMajor = nodeVersion ? Number.parseInt(nodeVersion.split('.')[0], 10) : 0;
  printCheck(nodeMajor >= 20, 'Node.js 20+', nodeVersion ? `v${nodeVersion}` : 'not found');

  const pnpmVersion = await getVersion('pnpm', ['--version']);
  printCheck(Boolean(pnpmVersion), 'pnpm', pnpmVersion ?? 'not found');

  const dockerExists = await commandExists('docker');
  const dockerVersion = dockerExists ? await getVersion('docker', ['--version']) : null;
  printCheck(
    dockerExists,
    'Docker (optional)',
    dockerVersion ?? 'not found — needed for prod deployments',
  );

  const pgPort = await detectPostgresPort();
  printCheck(
    pgPort !== null,
    'PostgreSQL',
    pgPort !== null ? `listening on port ${String(pgPort)}` : 'not reachable',
  );

  const redisPort = await detectRedisPort();
  printCheck(
    redisPort !== null,
    'Redis',
    redisPort !== null ? `listening on port ${String(redisPort)}` : 'not reachable',
  );

  console.log();

  // ── Step 2: Generate .env if missing ──────────────────────────
  if (!fs.existsSync(ENV_FILE)) {
    console.log(bold('Generating .env from template...'));

    if (!fs.existsSync(ENV_EXAMPLE)) {
      throw new DeployError('ENV_TEMPLATE_MISSING', `.env.example not found at ${ENV_EXAMPLE}`);
    }

    let envContent = fs.readFileSync(ENV_EXAMPLE, 'utf-8');

    // Auto-detect and substitute PG port
    if (pgPort !== null) {
      envContent = envContent.replace(
        /DATABASE_URL=postgresql:\/\/agentctl:agentctl@localhost:\d+\/agentctl/,
        `DATABASE_URL=postgresql://agentctl:agentctl@localhost:${String(pgPort)}/agentctl`,
      );
      console.log(dim(`  Auto-detected PostgreSQL on port ${String(pgPort)}`));
    }

    // Auto-detect Redis
    if (redisPort !== null) {
      envContent = envContent.replace(
        /REDIS_URL=redis:\/\/localhost:\d+/,
        `REDIS_URL=redis://localhost:${String(redisPort)}`,
      );
      envContent = envContent.replace(/REDIS_PORT=\d+/, `REDIS_PORT=${String(redisPort)}`);
      console.log(dim(`  Auto-detected Redis on port ${String(redisPort)}`));
    }

    // Prompt for API keys (can be skipped)
    console.log(dim('\n  Enter API keys below (press Enter to skip):\n'));

    const anthropicKey1 = await prompt('  ANTHROPIC_KEY_ORG1');
    if (anthropicKey1) {
      envContent = envContent.replace(
        /ANTHROPIC_KEY_ORG1=sk-ant-api03-REPLACE_WITH_YOUR_KEY_ORG1/,
        `ANTHROPIC_KEY_ORG1=${anthropicKey1}`,
      );
    }

    const anthropicKey2 = await prompt('  ANTHROPIC_KEY_ORG2');
    if (anthropicKey2) {
      envContent = envContent.replace(
        /ANTHROPIC_KEY_ORG2=sk-ant-api03-REPLACE_WITH_YOUR_KEY_ORG2/,
        `ANTHROPIC_KEY_ORG2=${anthropicKey2}`,
      );
    }

    const anthropicApiKey = await prompt('  ANTHROPIC_API_KEY (for Claude Agent SDK)');
    if (anthropicApiKey) {
      envContent = envContent.replace(
        /ANTHROPIC_API_KEY=sk-ant-api03-REPLACE_WITH_YOUR_KEY/,
        `ANTHROPIC_API_KEY=${anthropicApiKey}`,
      );
    }

    fs.writeFileSync(ENV_FILE, envContent, 'utf-8');
    printCheck(true, '.env file created');
  } else {
    printCheck(true, '.env file exists', 'skipping generation');
  }

  console.log();

  // ── Step 3: pnpm install ──────────────────────────────────────
  const nodeModulesExist = fs.existsSync(path.join(ROOT_DIR, 'node_modules'));

  if (!nodeModulesExist) {
    console.log(bold('Running pnpm install...'));
    const { exitCode, stderr } = await exec('pnpm', ['install'], { timeout: 300_000 });
    printCheck(exitCode === 0, 'pnpm install', exitCode !== 0 ? stderr.slice(0, 200) : undefined);
    if (exitCode !== 0) {
      throw new DeployError('INSTALL_FAILED', 'pnpm install failed', {
        stderr: stderr.slice(0, 500),
      });
    }
  } else {
    printCheck(true, 'node_modules present', 'skipping install');
  }

  // ── Step 4: pnpm build ────────────────────────────────────────
  console.log(bold('Building all packages...'));
  const { exitCode: buildCode, stderr: buildErr } = await exec('pnpm', ['build'], {
    timeout: 300_000,
  });
  printCheck(buildCode === 0, 'pnpm build', buildCode !== 0 ? buildErr.slice(0, 200) : undefined);
  if (buildCode !== 0) {
    throw new DeployError('BUILD_FAILED', 'pnpm build failed', {
      stderr: buildErr.slice(0, 500),
    });
  }

  // ── Step 5: DB migration ──────────────────────────────────────
  if (pgPort !== null) {
    console.log(bold('Running database migration...'));
    const { exitCode: migrateCode, stderr: migrateErr } = await exec(
      'pnpm',
      ['--filter', '@agentctl/control-plane', 'db:migrate'],
      { timeout: 60_000 },
    );
    printCheck(
      migrateCode === 0,
      'DB migration',
      migrateCode !== 0 ? migrateErr.slice(0, 200) : undefined,
    );
    if (migrateCode !== 0) {
      console.log(yellow('  Warning: migration failed — database may not be configured yet'));
    }
  } else {
    printCheck(false, 'DB migration', 'skipped — PostgreSQL not reachable');
  }

  console.log(`\n${green('Init complete.')} Run ${cyan('pnpm deploy up')} to start services.\n`);
}

// ---------------------------------------------------------------------------
// Command: up
// ---------------------------------------------------------------------------

/** Tracked child processes for dev mode cleanup */
const devProcesses: ChildProcess[] = [];

function cleanupDevProcesses(): void {
  for (const proc of devProcesses) {
    if (proc.pid && !proc.killed) {
      proc.kill('SIGTERM');
    }
  }
}

function spawnService(
  label: string,
  cmd: string,
  args: readonly string[],
  cwd: string,
): ChildProcess {
  const child = spawn(cmd, [...args], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  child.stdout?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      console.log(`${dim(`[${label}]`)} ${line}`);
    }
  });

  child.stderr?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      console.log(`${yellow(`[${label}]`)} ${line}`);
    }
  });

  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.log(red(`[${label}] exited with code ${String(code)}`));
    }
  });

  devProcesses.push(child);
  return child;
}

async function waitForHealthy(
  port: number,
  healthPath: string,
  label: string,
  timeoutMs: number = 30_000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { ok } = await fetchHealth(port, healthPath);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(
    yellow(`  Warning: ${label} did not become healthy within ${String(timeoutMs / 1000)}s`),
  );
  return false;
}

async function cmdUp(isProd: boolean, isWorkerOnly: boolean, controlUrl?: string): Promise<void> {
  console.log(`\n${bold('agentctl deploy up')}\n`);

  // ── Prod mode: docker compose ─────────────────────────────────
  if (isProd) {
    console.log(bold('Starting production services via Docker Compose...'));

    if (!fs.existsSync(COMPOSE_FILE)) {
      throw new DeployError(
        'COMPOSE_NOT_FOUND',
        `docker-compose.prod.yml not found at ${COMPOSE_FILE}`,
      );
    }

    const { exitCode, stderr } = await exec(
      'docker',
      ['compose', '-f', COMPOSE_FILE, 'up', '-d', '--build'],
      { timeout: 600_000 },
    );

    if (exitCode !== 0) {
      throw new DeployError('DOCKER_COMPOSE_FAILED', 'docker compose up failed', {
        stderr: stderr.slice(0, 500),
      });
    }

    console.log(green('  Docker Compose services started.'));

    // Wait for health checks
    console.log(bold('\nWaiting for services to become healthy...'));
    const cpOk = await waitForHealthy(8080, '/health', 'Control Plane', 45_000);
    const workerOk = await waitForHealthy(9000, '/health', 'Agent Worker', 45_000);

    console.log();
    printServiceTable([
      {
        name: 'Control Plane',
        url: 'http://localhost:8080',
        status: cpOk ? 'OK' : 'STARTING',
      },
      {
        name: 'Agent Worker',
        url: 'http://localhost:9000',
        status: workerOk ? 'OK' : 'STARTING',
      },
    ]);
    return;
  }

  // ── Dev mode ──────────────────────────────────────────────────

  // Register cleanup handlers
  process.on('SIGINT', () => {
    console.log(dim('\nShutting down dev services...'));
    cleanupDevProcesses();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanupDevProcesses();
    process.exit(0);
  });

  if (isWorkerOnly) {
    // Worker-only mode
    const env = controlUrl ? { ...process.env, CONTROL_URL: controlUrl } : process.env;

    console.log(bold('Starting agent-worker only...'));
    if (controlUrl) {
      console.log(dim(`  Control plane URL: ${controlUrl}`));
    }

    const workerChild = spawn('pnpm', ['--filter', '@agentctl/agent-worker', 'dev'], {
      cwd: ROOT_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...env },
    });

    workerChild.stdout?.on('data', (data: Buffer) => {
      process.stdout.write(data);
    });
    workerChild.stderr?.on('data', (data: Buffer) => {
      process.stderr.write(data);
    });

    devProcesses.push(workerChild);

    await waitForHealthy(9000, '/health', 'Agent Worker');
    console.log(`\n${green('Agent Worker ready')} at ${cyan('http://localhost:9000')}\n`);

    // Keep process alive
    await new Promise(() => {});
    return;
  }

  // Full dev mode: start all three services
  console.log(bold('Starting dev services...\n'));

  spawnService('cp', 'pnpm', ['--filter', '@agentctl/control-plane', 'dev'], ROOT_DIR);

  spawnService('worker', 'pnpm', ['--filter', '@agentctl/agent-worker', 'dev'], ROOT_DIR);

  spawnService('web', 'pnpm', ['--filter', '@agentctl/web', 'dev'], ROOT_DIR);

  // Wait for health checks
  console.log(bold('Waiting for services to become healthy...\n'));

  const [cpOk, workerOk, webOk] = await Promise.all([
    waitForHealthy(8080, '/health', 'Control Plane'),
    waitForHealthy(9000, '/health', 'Agent Worker'),
    waitForHealthy(5173, '/', 'Web UI'),
  ]);

  console.log();
  printServiceTable([
    {
      name: 'Control Plane',
      url: 'http://localhost:8080',
      status: cpOk ? 'OK' : 'STARTING',
    },
    {
      name: 'Agent Worker',
      url: 'http://localhost:9000',
      status: workerOk ? 'OK' : 'STARTING',
    },
    {
      name: 'Web UI',
      url: 'http://localhost:5173',
      status: webOk ? 'OK' : 'STARTING',
    },
  ]);

  console.log(dim('\nPress Ctrl+C to stop all services.\n'));

  // Keep process alive
  await new Promise(() => {});
}

// ---------------------------------------------------------------------------
// Command: down
// ---------------------------------------------------------------------------

async function cmdDown(): Promise<void> {
  console.log(`\n${bold('agentctl deploy down')}\n`);

  let stoppedAny = false;

  // Try Docker Compose first
  if (fs.existsSync(COMPOSE_FILE)) {
    const { exitCode } = await exec('docker', ['compose', '-f', COMPOSE_FILE, 'ps', '--quiet']);

    if (exitCode === 0) {
      console.log(bold('Stopping Docker Compose services...'));
      const { exitCode: downCode } = await exec('docker', ['compose', '-f', COMPOSE_FILE, 'down']);
      printCheck(downCode === 0, 'Docker Compose services stopped');
      stoppedAny = true;
    }
  }

  // Kill dev processes on known ports
  console.log(bold('Checking for dev processes on known ports...'));

  for (const [_name, cfg] of Object.entries(SERVICES)) {
    const listening = await isPortListening(cfg.port);
    if (listening) {
      // Find PID using lsof
      const { stdout } = await exec('lsof', ['-ti', `tcp:${String(cfg.port)}`]);
      const pids = stdout.trim().split('\n').filter(Boolean);

      for (const pid of pids) {
        await exec('kill', ['-TERM', pid]);
      }

      if (pids.length > 0) {
        printCheck(
          true,
          `${cfg.label} (port ${String(cfg.port)})`,
          `killed PID(s) ${pids.join(', ')}`,
        );
        stoppedAny = true;
      }
    } else {
      printCheck(true, `${cfg.label} (port ${String(cfg.port)})`, 'not running');
    }
  }

  if (!stoppedAny) {
    console.log(dim('  No running services found.'));
  }

  console.log();
}

// ---------------------------------------------------------------------------
// Command: status
// ---------------------------------------------------------------------------

type ServiceRow = {
  readonly name: string;
  readonly url: string;
  readonly status: string;
  readonly uptime?: string;
  readonly memory?: string;
};

function printServiceTable(rows: readonly ServiceRow[]): void {
  const colWidths = {
    name: 16,
    url: 28,
    status: 10,
    uptime: 12,
    memory: 10,
  };

  const header = [
    'Service'.padEnd(colWidths.name),
    'URL'.padEnd(colWidths.url),
    'Status'.padEnd(colWidths.status),
    'Uptime'.padEnd(colWidths.uptime),
    'Memory'.padEnd(colWidths.memory),
  ].join('  ');

  const separator = '-'.repeat(header.length);

  console.log(bold(header));
  console.log(dim(separator));

  for (const row of rows) {
    const statusColor = row.status === 'OK' ? green : row.status === 'DOWN' ? red : yellow;
    console.log(
      [
        row.name.padEnd(colWidths.name),
        cyan(row.url.padEnd(colWidths.url)),
        statusColor(row.status.padEnd(colWidths.status)),
        (row.uptime ?? '-').padEnd(colWidths.uptime),
        (row.memory ?? '-').padEnd(colWidths.memory),
      ].join('  '),
    );
  }
}

async function cmdStatus(): Promise<void> {
  console.log(`\n${bold('agentctl deploy status')}\n`);

  // Check services in parallel
  const [cpHealth, workerHealth, webHealth] = await Promise.all([
    fetchHealth(SERVICES['control-plane'].port, SERVICES['control-plane'].healthPath),
    fetchHealth(SERVICES.worker.port, SERVICES.worker.healthPath),
    fetchHealth(SERVICES.web.port, SERVICES.web.healthPath),
  ]);

  // Extract uptime from health bodies if available
  const cpUptime = cpHealth.body?.uptime ? formatUptime(Number(cpHealth.body.uptime)) : undefined;
  const workerUptime = workerHealth.body?.uptime
    ? formatUptime(Number(workerHealth.body.uptime))
    : undefined;

  // Extract memory from health bodies if available
  const cpMemory = cpHealth.body?.memory
    ? formatMemory(cpHealth.body.memory as Record<string, unknown>)
    : undefined;
  const workerMemory = workerHealth.body?.memory
    ? formatMemory(workerHealth.body.memory as Record<string, unknown>)
    : undefined;

  const rows: ServiceRow[] = [
    {
      name: 'Control Plane',
      url: 'http://localhost:8080',
      status: cpHealth.ok ? 'OK' : 'DOWN',
      uptime: cpUptime,
      memory: cpMemory,
    },
    {
      name: 'Agent Worker',
      url: 'http://localhost:9000',
      status: workerHealth.ok ? 'OK' : 'DOWN',
      uptime: workerUptime,
      memory: workerMemory,
    },
    {
      name: 'Web UI',
      url: 'http://localhost:5173',
      status: webHealth.ok ? 'OK' : 'DOWN',
    },
  ];

  printServiceTable(rows);

  // Check infrastructure
  console.log(`\n${bold('Infrastructure:')}`);

  const pgPort = await detectPostgresPort();
  printCheck(
    pgPort !== null,
    'PostgreSQL',
    pgPort !== null ? `port ${String(pgPort)}` : 'not reachable',
  );

  const redisPort = await detectRedisPort();
  printCheck(
    redisPort !== null,
    'Redis',
    redisPort !== null ? `port ${String(redisPort)}` : 'not reachable',
  );

  console.log();
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${String(Math.floor(seconds))}s`;
  if (seconds < 3600)
    return `${String(Math.floor(seconds / 60))}m ${String(Math.floor(seconds % 60))}s`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${String(hours)}h ${String(mins)}m`;
}

function formatMemory(mem: Record<string, unknown>): string {
  const heapUsed = Number(mem.heapUsed ?? mem.rss ?? 0);
  if (heapUsed === 0) return '-';
  const mb = heapUsed / (1024 * 1024);
  return `${mb.toFixed(1)}MB`;
}

// ---------------------------------------------------------------------------
// Command: logs
// ---------------------------------------------------------------------------

async function cmdLogs(service: string): Promise<void> {
  const serviceMap: Record<string, string> = {
    cp: 'control-plane',
    'control-plane': 'control-plane',
    worker: 'agent-worker',
    'agent-worker': 'agent-worker',
    web: 'web',
  };

  const resolved = serviceMap[service];
  if (!resolved) {
    throw new DeployError('UNKNOWN_SERVICE', `Unknown service: ${service}. Valid: cp, worker, web`);
  }

  // Check if Docker Compose is running
  const { exitCode } = await exec('docker', ['compose', '-f', COMPOSE_FILE, 'ps', '--quiet']);

  if (exitCode === 0) {
    // Prod mode: use docker compose logs
    console.log(dim(`Streaming logs for ${resolved} (Docker Compose)...\n`));
    const child = spawn(
      'docker',
      ['compose', '-f', COMPOSE_FILE, 'logs', '-f', '--tail', '100', resolved],
      { cwd: ROOT_DIR, stdio: 'inherit' },
    );

    devProcesses.push(child);

    process.on('SIGINT', () => {
      child.kill('SIGTERM');
      process.exit(0);
    });

    await new Promise((resolve) => {
      child.on('exit', resolve);
    });
  } else {
    // Dev mode: use pnpm filter to run dev and stream
    console.log(dim(`Streaming logs for ${resolved} (dev mode)...\n`));

    const filterName =
      resolved === 'control-plane'
        ? '@agentctl/control-plane'
        : resolved === 'agent-worker'
          ? '@agentctl/agent-worker'
          : '@agentctl/web';

    const child = spawn('pnpm', ['--filter', filterName, 'dev'], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
    });

    devProcesses.push(child);

    process.on('SIGINT', () => {
      child.kill('SIGTERM');
      process.exit(0);
    });

    await new Promise((resolve) => {
      child.on('exit', resolve);
    });
  }
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`
${bold('agentctl deploy')} — Deployment management for AgentCTL

${bold('USAGE')}
  pnpm deploy ${cyan('<command>')} [options]

${bold('COMMANDS')}
  ${cyan('init')} [--prod]                 Check deps, generate .env, install, build, migrate
  ${cyan('up')} [--prod] [--worker]        Start all services (or Docker prod / worker-only)
  ${cyan('down')}                          Stop running services (dev or Docker)
  ${cyan('status')}                        Show health of all services + infrastructure
  ${cyan('logs')} <service>                Tail logs for a service (${dim('cp|worker|web')})
  ${cyan('help')}                          Show this help message

${bold('OPTIONS')}
  ${cyan('--prod')}                        Use production Docker Compose deployment
  ${cyan('--worker')}                      Start only the agent-worker (with ${cyan('up')})
  ${cyan('--control-url')}=<url>           Remote control plane URL (with ${cyan('--worker')})

${bold('EXAMPLES')}
  ${dim('# First-time setup')}
  pnpm deploy init

  ${dim('# Start all services in dev mode')}
  pnpm deploy up

  ${dim('# Start production Docker deployment')}
  pnpm deploy up --prod

  ${dim('# Start only worker, connecting to remote control plane')}
  pnpm deploy up --worker --control-url=http://ec2-host:8080

  ${dim('# Check status of all services')}
  pnpm deploy status

  ${dim('# Stop all running services')}
  pnpm deploy down

  ${dim('# Tail control plane logs')}
  pnpm deploy logs cp
`);
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

type ParsedArgs = {
  readonly command: string | undefined;
  readonly subArgs: readonly string[];
  readonly flags: {
    readonly prod: boolean;
    readonly worker: boolean;
    readonly controlUrl: string | undefined;
  };
};

function parseArgs(rawArgs: readonly string[]): ParsedArgs {
  let prod = false;
  let worker = false;
  let controlUrl: string | undefined;
  const positional: string[] = [];

  for (const arg of rawArgs) {
    if (arg === '--prod') {
      prod = true;
    } else if (arg === '--worker') {
      worker = true;
    } else if (arg.startsWith('--control-url=')) {
      controlUrl = arg.slice('--control-url='.length);
    } else if (arg.startsWith('-')) {
      // Ignore unknown flags
    } else {
      positional.push(arg);
    }
  }

  return {
    command: positional[0],
    subArgs: positional.slice(1),
    flags: { prod, worker, controlUrl },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { command, subArgs, flags } = parseArgs(process.argv.slice(2));

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  switch (command) {
    case 'init':
      await cmdInit(flags.prod);
      break;

    case 'up':
      await cmdUp(flags.prod, flags.worker, flags.controlUrl);
      break;

    case 'down':
      await cmdDown();
      break;

    case 'status':
      await cmdStatus();
      break;

    case 'logs': {
      const service = subArgs[0];
      if (!service) {
        console.error(`${red('Error: ')}Usage: pnpm deploy logs <service>`);
        console.error(`Valid services: ${dim('cp, worker, web')}`);
        process.exit(1);
      }
      await cmdLogs(service);
      break;
    }

    default:
      console.error(`${red('Error: ')}Unknown deploy command: ${command}`);
      console.error('Run "pnpm deploy help" for usage information.');
      process.exit(1);
  }
}

main().catch((error: unknown) => {
  if (error instanceof DeployError) {
    console.error(`${red('Error')} [${error.code}]: ${error.message}`);
    if (error.context) {
      for (const [key, value] of Object.entries(error.context)) {
        console.error(dim(`  ${key}: ${String(value)}`));
      }
    }
    process.exit(1);
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error(`${red('Error:')} ${message}`);
  process.exit(1);
});
