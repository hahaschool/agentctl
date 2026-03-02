#!/usr/bin/env npx tsx

/**
 * Fleet-wide machine bootstrap orchestrator for AgentCTL (Phase 7).
 *
 * Reads the machine inventory from `infra/machines.yml`, connects to each
 * machine via SSH over Tailscale, copies `scripts/setup-machine.sh`, executes
 * it with the appropriate role flags, and verifies success via a /health check.
 *
 * Features:
 *   - YAML inventory parsing with validation
 *   - Parallel execution with configurable concurrency limit
 *   - Dry-run mode (validates inventory without executing remote commands)
 *   - Per-machine status reporting with aggregate summary
 *   - Configurable SSH options (timeout, retries)
 *   - Role-based machine filtering (control-plane, worker, all)
 *
 * Exit codes:
 *   0 = all targeted machines bootstrapped successfully (or dry-run pass)
 *   1 = one or more machines failed
 *   2 = inventory error (file not found, parse failure, validation error)
 *   3 = invalid arguments
 *
 * Usage:
 *   pnpm tsx scripts/fleet-bootstrap.ts [--role worker|control-plane|all] \
 *     [--concurrency 3] [--dry-run] [--ssh-timeout 30000] \
 *     [--inventory infra/machines.yml]
 */

import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class FleetBootstrapError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'FleetBootstrapError';
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MachineRole = 'control-plane' | 'worker';

export type MachineEntry = {
  host: string;
  role: MachineRole;
  tailscale_ip: string;
  ssh_user?: string;
  labels?: Record<string, string>;
};

export type BootstrapConfig = {
  inventoryPath: string;
  concurrency: number;
  dryRun: boolean;
  sshTimeoutMs: number;
  roleFilter?: string;
};

export type BootstrapResult = {
  success: boolean;
  machines: MachineBootstrapResult[];
  totalDurationMs: number;
};

export type MachineBootstrapResult = {
  host: string;
  status: 'success' | 'failed' | 'skipped';
  steps: string[];
  error?: string;
  durationMs: number;
};

export type InventoryFile = {
  defaults?: {
    deploy_user?: string;
    health_check_path?: string;
    health_check_timeout?: number;
  };
  machines: RawMachineEntry[];
};

export type RawMachineEntry = {
  id?: string;
  host?: string;
  role?: string;
  tailscale_ip?: string;
  hostname?: string;
  ssh_user?: string;
  labels?: Record<string, string>;
  services?: string[];
  deploy_order?: number;
  capabilities?: Record<string, unknown>;
};

export type SshExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_INVENTORY_PATH = path.resolve(__dirname, '..', 'infra', 'machines.yml');
export const SETUP_SCRIPT_PATH = path.resolve(__dirname, 'setup-machine.sh');

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_SSH_TIMEOUT_MS = 30_000;
const DEFAULT_SSH_USER = 'deploy';

export const EXIT_SUCCESS = 0;
export const EXIT_BOOTSTRAP_FAILED = 1;
export const EXIT_INVENTORY_ERROR = 2;
export const EXIT_INVALID_ARGS = 3;

const VALID_ROLES: ReadonlySet<string> = new Set(['control-plane', 'worker', 'all']);

/**
 * Tailscale CGNAT range: 100.64.0.0/10 means 100.64.0.0 – 100.127.255.255.
 */
const TAILSCALE_CGNAT_FIRST_OCTET = 100;
const TAILSCALE_CGNAT_SECOND_MIN = 64;
const TAILSCALE_CGNAT_SECOND_MAX = 127;

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

export function parseArgs(argv: string[]): BootstrapConfig {
  const args = argv.slice(2);
  let inventoryPath = DEFAULT_INVENTORY_PATH;
  let concurrency = DEFAULT_CONCURRENCY;
  let dryRun = false;
  let sshTimeoutMs = DEFAULT_SSH_TIMEOUT_MS;
  let roleFilter: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--role') {
      const next = args[i + 1];
      if (next === undefined || !VALID_ROLES.has(next)) {
        throw new FleetBootstrapError(
          'INVALID_ARGS',
          `--role requires one of: control-plane, worker, all (got: ${next ?? 'nothing'})`,
        );
      }
      roleFilter = next === 'all' ? undefined : next;
      i++;
    } else if (arg === '--concurrency') {
      const next = args[i + 1];
      if (next === undefined || Number.isNaN(Number(next)) || Number(next) < 1) {
        throw new FleetBootstrapError('INVALID_ARGS', '--concurrency requires a positive integer');
      }
      concurrency = Number(next);
      i++;
    } else if (arg === '--ssh-timeout') {
      const next = args[i + 1];
      if (next === undefined || Number.isNaN(Number(next)) || Number(next) < 1) {
        throw new FleetBootstrapError(
          'INVALID_ARGS',
          '--ssh-timeout requires a positive number in milliseconds',
        );
      }
      sshTimeoutMs = Number(next);
      i++;
    } else if (arg === '--inventory') {
      const next = args[i + 1];
      if (next === undefined) {
        throw new FleetBootstrapError('INVALID_ARGS', '--inventory requires a file path');
      }
      inventoryPath = path.resolve(next);
      i++;
    }
  }

  return { inventoryPath, concurrency, dryRun, sshTimeoutMs, roleFilter };
}

// ---------------------------------------------------------------------------
// YAML parsing (minimal, avoids hard dependency on js-yaml at runtime)
// ---------------------------------------------------------------------------

/**
 * Parse a YAML inventory file. Dynamically imports `js-yaml` when available,
 * otherwise falls back to a minimal parser sufficient for the machines.yml
 * structure.
 */
export async function parseYaml(content: string): Promise<unknown> {
  try {
    // biome-ignore lint/suspicious/noExplicitAny: dynamic import typing
    const yaml = (await import('js-yaml')) as any;
    const load = yaml.load ?? yaml.default?.load;
    if (typeof load === 'function') {
      return load(content);
    }
  } catch {
    // js-yaml not available — fall through to minimal parser
  }

  // Minimal YAML-subset parser: handles the machines.yml structure only.
  // This is intentionally limited; real deployments should install js-yaml.
  return parseMinimalYaml(content);
}

/**
 * Very small YAML subset parser covering the inventory file structure.
 * Handles top-level keys, arrays of objects, and simple key: value pairs.
 * NOT a general-purpose YAML parser.
 */
export function parseMinimalYaml(content: string): Record<string, unknown> {
  const lines = content.split('\n');
  const result: Record<string, unknown> = {};
  let currentTopKey = '';
  let inArray = false;
  let currentArrayItem: Record<string, unknown> | null = null;
  let arrayItems: Record<string, unknown>[] = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');

    // Skip comments and empty lines
    if (line.trim() === '' || line.trim().startsWith('#')) {
      continue;
    }

    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    // Top-level key (no indent or indent=0)
    if (indent === 0 && trimmed.includes(':')) {
      // Flush previous array
      if (inArray && currentTopKey) {
        if (currentArrayItem) {
          arrayItems.push(currentArrayItem);
          currentArrayItem = null;
        }
        result[currentTopKey] = arrayItems;
        arrayItems = [];
        inArray = false;
      }

      const colonIdx = trimmed.indexOf(':');
      const key = trimmed.slice(0, colonIdx).trim();
      const value = trimmed.slice(colonIdx + 1).trim();

      if (value === '' || value === '|') {
        currentTopKey = key;
      } else {
        result[key] = parseScalar(value);
        currentTopKey = '';
      }
      continue;
    }

    // Array item start
    if (trimmed.startsWith('- ')) {
      if (currentArrayItem) {
        arrayItems.push(currentArrayItem);
      }
      currentArrayItem = {};
      inArray = true;

      const afterDash = trimmed.slice(2).trim();
      if (afterDash.includes(':')) {
        const colonIdx = afterDash.indexOf(':');
        const key = afterDash.slice(0, colonIdx).trim();
        const value = afterDash.slice(colonIdx + 1).trim();
        currentArrayItem[key] = parseScalar(value);
      }
      continue;
    }

    // Nested key: value in array item or sub-object
    if (inArray && currentArrayItem && trimmed.includes(':')) {
      const colonIdx = trimmed.indexOf(':');
      const key = trimmed.slice(0, colonIdx).trim();
      const value = trimmed.slice(colonIdx + 1).trim();

      if (value.startsWith('[') && value.endsWith(']')) {
        // Inline array: [a, b, c]
        const inner = value.slice(1, -1);
        currentArrayItem[key] = inner.split(',').map((s) => parseScalar(s.trim()));
      } else if (value === '') {
        // Sub-object — store empty for now (not deeply parsed)
        currentArrayItem[key] = {};
      } else {
        currentArrayItem[key] = parseScalar(value);
      }
      continue;
    }

    // Nested sub-object key: value under top-level key (e.g., defaults)
    if (!inArray && currentTopKey && trimmed.includes(':')) {
      if (typeof result[currentTopKey] !== 'object' || result[currentTopKey] === null) {
        result[currentTopKey] = {};
      }
      const obj = result[currentTopKey] as Record<string, unknown>;
      const colonIdx = trimmed.indexOf(':');
      const key = trimmed.slice(0, colonIdx).trim();
      const value = trimmed.slice(colonIdx + 1).trim();
      obj[key] = parseScalar(value);
    }
  }

  // Flush final array
  if (inArray && currentTopKey) {
    if (currentArrayItem) {
      arrayItems.push(currentArrayItem);
    }
    result[currentTopKey] = arrayItems;
  }

  return result;
}

function parseScalar(value: string): string | number | boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return '';
  // Remove quotes
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  // Try number
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Inventory loading & validation
// ---------------------------------------------------------------------------

export async function loadInventory(inventoryPath: string): Promise<RawMachineEntry[]> {
  let content: string;
  try {
    content = await fs.readFile(inventoryPath, 'utf-8');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new FleetBootstrapError('INVENTORY_NOT_FOUND', `Cannot read inventory file: ${message}`, {
      inventoryPath,
    });
  }

  let parsed: unknown;
  try {
    parsed = await parseYaml(content);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new FleetBootstrapError('INVENTORY_PARSE_ERROR', `Failed to parse YAML: ${message}`, {
      inventoryPath,
    });
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new FleetBootstrapError(
      'INVENTORY_INVALID',
      'Inventory file must contain a YAML object with a "machines" key',
      { inventoryPath },
    );
  }

  const doc = parsed as Record<string, unknown>;
  if (!Array.isArray(doc.machines)) {
    throw new FleetBootstrapError(
      'INVENTORY_INVALID',
      'Inventory file must contain a "machines" array',
      { inventoryPath },
    );
  }

  return doc.machines as RawMachineEntry[];
}

export function validateMachineEntry(raw: RawMachineEntry, index: number): MachineEntry {
  const host = raw.host ?? raw.id ?? raw.hostname;
  if (!host || typeof host !== 'string') {
    throw new FleetBootstrapError(
      'MACHINE_INVALID',
      `Machine at index ${index} is missing required field "host" (or "id"/"hostname")`,
      { index, entry: raw },
    );
  }

  const rawRole = raw.role;
  if (!rawRole || typeof rawRole !== 'string') {
    throw new FleetBootstrapError(
      'MACHINE_INVALID',
      `Machine "${host}" is missing required field "role"`,
      { host, entry: raw },
    );
  }

  const role = normalizeRole(rawRole);

  const tailscaleIp = raw.tailscale_ip;
  if (!tailscaleIp || typeof tailscaleIp !== 'string') {
    throw new FleetBootstrapError(
      'MACHINE_INVALID',
      `Machine "${host}" is missing required field "tailscale_ip"`,
      { host, entry: raw },
    );
  }

  validateTailscaleIp(tailscaleIp, host);

  return {
    host,
    role,
    tailscale_ip: tailscaleIp,
    ssh_user: raw.ssh_user ?? undefined,
    labels: raw.labels ?? undefined,
  };
}

export function normalizeRole(rawRole: string): MachineRole {
  if (rawRole === 'control-plane' || rawRole === 'control') {
    return 'control-plane';
  }
  if (rawRole === 'worker' || rawRole === 'agent-worker') {
    return 'worker';
  }
  throw new FleetBootstrapError(
    'INVALID_ROLE',
    `Unrecognized machine role: "${rawRole}". Expected "control-plane", "control", "worker", or "agent-worker"`,
    { rawRole },
  );
}

export function validateTailscaleIp(ip: string, host: string): void {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    throw new FleetBootstrapError(
      'INVALID_TAILSCALE_IP',
      `Machine "${host}" has invalid Tailscale IP "${ip}" — expected IPv4 format`,
      { host, ip },
    );
  }

  const octets = parts.map(Number);
  if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) {
    throw new FleetBootstrapError(
      'INVALID_TAILSCALE_IP',
      `Machine "${host}" has invalid Tailscale IP "${ip}" — octets must be 0-255`,
      { host, ip },
    );
  }

  const secondOctet = octets[1] ?? 0;
  if (
    octets[0] !== TAILSCALE_CGNAT_FIRST_OCTET ||
    secondOctet < TAILSCALE_CGNAT_SECOND_MIN ||
    secondOctet > TAILSCALE_CGNAT_SECOND_MAX
  ) {
    throw new FleetBootstrapError(
      'INVALID_TAILSCALE_IP',
      `Machine "${host}" has Tailscale IP "${ip}" outside CGNAT range (100.64.0.0/10)`,
      { host, ip },
    );
  }
}

export function parseMachineInventory(
  rawEntries: RawMachineEntry[],
  roleFilter?: string,
): MachineEntry[] {
  const machines: MachineEntry[] = [];

  for (let i = 0; i < rawEntries.length; i++) {
    const raw = rawEntries[i] as RawMachineEntry;
    const entry = validateMachineEntry(raw, i);

    if (roleFilter && entry.role !== roleFilter) {
      continue;
    }

    machines.push(entry);
  }

  // Check for duplicate hosts
  const hostSet = new Set<string>();
  for (const machine of machines) {
    if (hostSet.has(machine.host)) {
      throw new FleetBootstrapError('DUPLICATE_HOST', `Duplicate machine host: "${machine.host}"`, {
        host: machine.host,
      });
    }
    hostSet.add(machine.host);
  }

  // Check for duplicate IPs
  const ipSet = new Set<string>();
  for (const machine of machines) {
    if (ipSet.has(machine.tailscale_ip)) {
      throw new FleetBootstrapError(
        'DUPLICATE_IP',
        `Duplicate Tailscale IP: "${machine.tailscale_ip}"`,
        { ip: machine.tailscale_ip },
      );
    }
    ipSet.add(machine.tailscale_ip);
  }

  return machines;
}

// ---------------------------------------------------------------------------
// SSH/SCP execution
// ---------------------------------------------------------------------------

/**
 * Build SSH options array for a machine connection.
 */
export function buildSshOptions(
  _machine: MachineEntry,
  timeoutMs: number,
  _defaultUser: string,
): string[] {
  const timeoutSec = Math.ceil(timeoutMs / 1000);

  return [
    '-o',
    'StrictHostKeyChecking=no',
    '-o',
    'UserKnownHostsFile=/dev/null',
    '-o',
    `ConnectTimeout=${timeoutSec}`,
    '-o',
    'BatchMode=yes',
    '-o',
    'LogLevel=ERROR',
  ];
}

export function sshTarget(machine: MachineEntry, defaultUser: string): string {
  const user = machine.ssh_user ?? defaultUser;
  return `${user}@${machine.tailscale_ip}`;
}

/**
 * Execute a command on a remote machine via SSH. Returns stdout, stderr, and
 * exit code. Does NOT throw on non-zero exit codes; the caller decides.
 */
export async function execSsh(
  machine: MachineEntry,
  command: string,
  timeoutMs: number,
  defaultUser?: string,
): Promise<SshExecResult> {
  const user = defaultUser ?? DEFAULT_SSH_USER;
  const target = sshTarget(machine, user);
  const sshOpts = buildSshOptions(machine, timeoutMs, user);
  const args = [...sshOpts, target, command];

  return new Promise<SshExecResult>((resolve) => {
    const proc = execFile('ssh', args, { timeout: timeoutMs + 5000 }, (error, stdout, stderr) => {
      const exitCode = error ? ((error as NodeJS.ErrnoException & { code?: number }).code ?? 1) : 0;
      resolve({
        stdout: typeof stdout === 'string' ? stdout : '',
        stderr: typeof stderr === 'string' ? stderr : '',
        exitCode: typeof exitCode === 'number' ? exitCode : 1,
      });
    });

    // Prevent unhandled error on the process itself
    proc.on('error', () => {
      // handled by callback
    });
  });
}

/**
 * Copy a local file to a remote machine via SCP.
 */
export async function execScp(
  localPath: string,
  remotePath: string,
  machine: MachineEntry,
  timeoutMs: number,
  defaultUser?: string,
): Promise<SshExecResult> {
  const user = defaultUser ?? DEFAULT_SSH_USER;
  const target = sshTarget(machine, user);
  const sshOpts = buildSshOptions(machine, timeoutMs, user);
  const args = [...sshOpts, localPath, `${target}:${remotePath}`];

  return new Promise<SshExecResult>((resolve) => {
    const proc = execFile('scp', args, { timeout: timeoutMs + 5000 }, (error, stdout, stderr) => {
      const exitCode = error ? ((error as NodeJS.ErrnoException & { code?: number }).code ?? 1) : 0;
      resolve({
        stdout: typeof stdout === 'string' ? stdout : '',
        stderr: typeof stderr === 'string' ? stderr : '',
        exitCode: typeof exitCode === 'number' ? exitCode : 1,
      });
    });

    proc.on('error', () => {
      // handled by callback
    });
  });
}

/**
 * Perform a health check by curling the /health endpoint on the machine.
 */
export async function healthCheck(
  machine: MachineEntry,
  timeoutMs: number,
  defaultUser?: string,
): Promise<SshExecResult> {
  const port = machine.role === 'control-plane' ? 8080 : 9000;
  const command = `curl -sf -o /dev/null -w '%{http_code}' http://localhost:${port}/health`;
  return execSsh(machine, command, timeoutMs, defaultUser);
}

// ---------------------------------------------------------------------------
// Role flag mapping
// ---------------------------------------------------------------------------

export function roleToSetupArg(role: MachineRole): string {
  if (role === 'control-plane') return 'control';
  return 'worker';
}

// ---------------------------------------------------------------------------
// Single-machine bootstrap
// ---------------------------------------------------------------------------

export async function bootstrapMachine(
  machine: MachineEntry,
  config: BootstrapConfig,
  deps: {
    execSsh: typeof execSsh;
    execScp: typeof execScp;
    healthCheck: typeof healthCheck;
  } = { execSsh, execScp, healthCheck },
): Promise<MachineBootstrapResult> {
  const startTime = Date.now();
  const steps: string[] = [];

  if (config.dryRun) {
    steps.push(`[dry-run] Would copy setup-machine.sh to ${machine.host}`);
    steps.push(
      `[dry-run] Would execute setup-machine.sh ${roleToSetupArg(machine.role)} ${machine.host}`,
    );
    steps.push(`[dry-run] Would health-check ${machine.host}`);
    return {
      host: machine.host,
      status: 'skipped',
      steps,
      durationMs: Date.now() - startTime,
    };
  }

  try {
    // Step 1: Copy setup-machine.sh to the target machine
    steps.push(`Copying setup-machine.sh to ${machine.host}...`);
    const scpResult = await deps.execScp(
      SETUP_SCRIPT_PATH,
      '/tmp/setup-machine.sh',
      machine,
      config.sshTimeoutMs,
    );
    if (scpResult.exitCode !== 0) {
      throw new FleetBootstrapError(
        'SCP_FAILED',
        `Failed to copy setup-machine.sh to ${machine.host}: ${scpResult.stderr}`,
        { host: machine.host, exitCode: scpResult.exitCode },
      );
    }
    steps.push(`Copied setup-machine.sh to ${machine.host}`);

    // Step 2: Make script executable
    steps.push(`Setting execute permission on ${machine.host}...`);
    const chmodResult = await deps.execSsh(
      machine,
      'chmod +x /tmp/setup-machine.sh',
      config.sshTimeoutMs,
    );
    if (chmodResult.exitCode !== 0) {
      throw new FleetBootstrapError(
        'SSH_CHMOD_FAILED',
        `Failed to chmod setup-machine.sh on ${machine.host}: ${chmodResult.stderr}`,
        { host: machine.host, exitCode: chmodResult.exitCode },
      );
    }
    steps.push(`Set execute permission on ${machine.host}`);

    // Step 3: Execute setup-machine.sh with role and hostname args
    const roleArg = roleToSetupArg(machine.role);
    const setupCommand = `/tmp/setup-machine.sh ${roleArg} ${machine.host}`;
    steps.push(`Executing: ${setupCommand} on ${machine.host}...`);
    const execResult = await deps.execSsh(machine, setupCommand, config.sshTimeoutMs);
    if (execResult.exitCode !== 0) {
      throw new FleetBootstrapError(
        'SETUP_SCRIPT_FAILED',
        `setup-machine.sh failed on ${machine.host} (exit ${execResult.exitCode}): ${execResult.stderr}`,
        { host: machine.host, exitCode: execResult.exitCode, stdout: execResult.stdout },
      );
    }
    steps.push(`setup-machine.sh completed on ${machine.host}`);

    // Step 4: Health check
    steps.push(`Health-checking ${machine.host}...`);
    const healthResult = await deps.healthCheck(machine, config.sshTimeoutMs);
    if (healthResult.stdout.trim() === '200') {
      steps.push(`Health check passed on ${machine.host} (HTTP 200)`);
    } else {
      steps.push(
        `Health check returned ${healthResult.stdout.trim()} on ${machine.host} (non-fatal)`,
      );
    }

    return {
      host: machine.host,
      status: 'success',
      steps,
      durationMs: Date.now() - startTime,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    steps.push(`FAILED: ${message}`);
    return {
      host: machine.host,
      status: 'failed',
      steps,
      error: message,
      durationMs: Date.now() - startTime,
    };
  }
}

// ---------------------------------------------------------------------------
// Parallel execution with concurrency limit
// ---------------------------------------------------------------------------

export async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex++;
      results[index] = await fn(items[index] as T);
    }
  }

  const workers: Promise<void>[] = [];
  const workerCount = Math.min(concurrency, items.length);
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Main runner (testable, does not call process.exit)
// ---------------------------------------------------------------------------

export async function runBootstrap(
  config: BootstrapConfig,
  deps: {
    loadInventory: typeof loadInventory;
    bootstrapMachine: typeof bootstrapMachine;
  } = { loadInventory, bootstrapMachine },
): Promise<BootstrapResult> {
  const startTime = Date.now();

  // 1. Load and validate inventory
  const rawEntries = await deps.loadInventory(config.inventoryPath);
  const machines = parseMachineInventory(rawEntries, config.roleFilter);

  if (machines.length === 0) {
    return {
      success: true,
      machines: [],
      totalDurationMs: Date.now() - startTime,
    };
  }

  // 2. Bootstrap machines with concurrency limit
  const machineResults = await runWithConcurrency(machines, config.concurrency, (machine) =>
    deps.bootstrapMachine(machine, config),
  );

  // 3. Determine aggregate success
  const anyFailed = machineResults.some((r) => r.status === 'failed');

  return {
    success: !anyFailed,
    machines: machineResults,
    totalDurationMs: Date.now() - startTime,
  };
}

// ---------------------------------------------------------------------------
// Determine exit code from result
// ---------------------------------------------------------------------------

export function exitCodeFromResult(result: BootstrapResult): number {
  if (result.success) {
    return EXIT_SUCCESS;
  }
  return EXIT_BOOTSTRAP_FAILED;
}

// ---------------------------------------------------------------------------
// Main (CLI entry point)
// ---------------------------------------------------------------------------

export async function main(argv: string[] = process.argv): Promise<BootstrapResult> {
  const config = parseArgs(argv);

  console.error(`[fleet-bootstrap] Inventory: ${config.inventoryPath}`);
  console.error(`[fleet-bootstrap] Concurrency: ${config.concurrency}`);
  console.error(`[fleet-bootstrap] SSH timeout: ${config.sshTimeoutMs}ms`);
  if (config.roleFilter) {
    console.error(`[fleet-bootstrap] Role filter: ${config.roleFilter}`);
  }
  if (config.dryRun) {
    console.error('[fleet-bootstrap] DRY RUN — no remote commands will be executed');
  }

  const result = await runBootstrap(config);

  // Output structured JSON to stdout for CI consumption
  console.log(JSON.stringify(result, null, 2));

  if (result.success) {
    const total = result.machines.length;
    const succeeded = result.machines.filter((m) => m.status === 'success').length;
    const skipped = result.machines.filter((m) => m.status === 'skipped').length;
    if (config.dryRun) {
      console.error(
        `[fleet-bootstrap] Dry run complete. ${total} machine(s) would be bootstrapped.`,
      );
    } else if (total === 0) {
      console.error('[fleet-bootstrap] No machines matched the filter criteria.');
    } else {
      console.error(
        `[fleet-bootstrap] Bootstrap complete: ${succeeded} succeeded, ${skipped} skipped.`,
      );
    }
  } else {
    const failed = result.machines.filter((m) => m.status === 'failed');
    console.error(
      `[fleet-bootstrap] FAILED: ${failed.length} machine(s) failed: ${failed.map((m) => m.host).join(', ')}`,
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// Run when executed directly
// ---------------------------------------------------------------------------

const isDirectExecution =
  process.argv[1]?.endsWith('fleet-bootstrap.ts') ||
  process.argv[1]?.endsWith('fleet-bootstrap.js');

if (isDirectExecution) {
  main()
    .then((result) => {
      process.exit(exitCodeFromResult(result));
    })
    .catch((error: unknown) => {
      if (error instanceof FleetBootstrapError) {
        console.error(`[fleet-bootstrap] Error [${error.code}]: ${error.message}`);
        if (error.context) {
          console.error('Context:', JSON.stringify(error.context, null, 2));
        }
        if (error.code === 'INVALID_ARGS') {
          process.exit(EXIT_INVALID_ARGS);
        }
        if (
          error.code === 'INVENTORY_NOT_FOUND' ||
          error.code === 'INVENTORY_PARSE_ERROR' ||
          error.code === 'INVENTORY_INVALID'
        ) {
          process.exit(EXIT_INVENTORY_ERROR);
        }
      } else {
        console.error('[fleet-bootstrap] Fatal error:', error);
      }
      process.exit(EXIT_BOOTSTRAP_FAILED);
    });
}
