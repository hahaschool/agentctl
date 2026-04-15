#!/usr/bin/env npx tsx
// =============================================================================
// peer-update — PM2 mesh peer self-update CLI for AgentCTL.
//
// Usage:
//   pnpm peer-update [--tag vX.Y.Z] [--dry-run] [--rollback] [--no-attestation]
//   npx tsx scripts/peer-update.ts ...
//
// Algorithm (roadmap §33.11 — PM2 mesh topology):
//   1. Resolve target tag (gh api latest release, or --tag flag)
//   2. Verify release asset signature via `gh attestation verify`
//      (skipped with warning if attestations are not enabled on the repo)
//   3. git fetch --tags && git checkout <tag>   (skipped if already on tag)
//   4. ./scripts/env-migrate.sh mesh
//   5. pnpm build
//   6. pm2 reload infra/pm2/ecosystem.mesh.config.cjs
//   7. Poll http://localhost:8080/health until appVersion matches the
//      target tag or a 60s timeout expires
//   8. On failure, rollback to the previously-successful tag (if any):
//      checkout -> rebuild -> reload
//
// Run metadata is appended to ~/.agentctl/update-history.json, capped at
// 100 entries. When stdout is not a TTY, the final result is emitted as a
// single JSON object for machine consumption.
// =============================================================================

import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ROOT_DIR = path.resolve(import.meta.dirname ?? __dirname, '..');
export const PM2_ECOSYSTEM = path.join(ROOT_DIR, 'infra/pm2/ecosystem.mesh.config.cjs');
export const ENV_MIGRATE_SCRIPT = path.join(ROOT_DIR, 'scripts/env-migrate.sh');
export const HISTORY_FILE = path.join(os.homedir(), '.agentctl', 'update-history.json');
export const HISTORY_MAX_ENTRIES = 100;
export const HEALTH_URL = 'http://localhost:8080/health';
export const HEALTH_POLL_TIMEOUT_MS = 60_000;
export const HEALTH_POLL_INTERVAL_MS = 2_000;

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
} as const;

function isTty(): boolean {
  return Boolean(process.stdout.isTTY);
}

function colorize(code: string, text: string): string {
  return isTty() ? `${code}${text}${ANSI.reset}` : text;
}

function bold(text: string): string {
  return colorize(ANSI.bold, text);
}

function dim(text: string): string {
  return colorize(ANSI.dim, text);
}

function green(text: string): string {
  return colorize(ANSI.green, text);
}

function red(text: string): string {
  return colorize(ANSI.red, text);
}

function yellow(text: string): string {
  return colorize(ANSI.yellow, text);
}

function cyan(text: string): string {
  return colorize(ANSI.cyan, text);
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class PeerUpdateError extends Error {
  constructor(
    public code: string,
    message: string,
    public context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'PeerUpdateError';
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CliFlags = {
  readonly tag: string | undefined;
  readonly dryRun: boolean;
  readonly rollback: boolean;
  readonly noAttestation: boolean;
  readonly help: boolean;
};

export type HistoryEntry = {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly fromTag: string | null;
  readonly toTag: string;
  readonly success: boolean;
  readonly errorMessage?: string;
  readonly dryRun: boolean;
};

export type UpdateOptions = {
  readonly flags: CliFlags;
  readonly rootDir?: string;
  readonly historyFile?: string;
  readonly healthUrl?: string;
  readonly healthTimeoutMs?: number;
  readonly healthIntervalMs?: number;
  readonly logger?: Logger;
};

export type UpdateResult = {
  readonly success: boolean;
  readonly dryRun: boolean;
  readonly fromTag: string | null;
  readonly toTag: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly attestationVerified: boolean;
  readonly attestationSkipped: boolean;
  readonly rolledBack: boolean;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly steps: readonly StepRecord[];
};

export type StepRecord = {
  readonly name: string;
  readonly ok: boolean;
  readonly dryRun: boolean;
  readonly message?: string;
};

export type Logger = {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
};

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

export function parseArgs(raw: readonly string[]): CliFlags {
  let tag: string | undefined;
  let dryRun = false;
  let rollback = false;
  let noAttestation = false;
  let help = false;

  for (let i = 0; i < raw.length; i += 1) {
    const arg = raw[i];
    if (arg === '--help' || arg === '-h' || arg === 'help') {
      help = true;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--rollback') {
      rollback = true;
    } else if (arg === '--no-attestation') {
      noAttestation = true;
    } else if (arg === '--tag') {
      const next = raw[i + 1];
      if (!next) {
        throw new PeerUpdateError('INVALID_ARGS', '--tag requires a value');
      }
      tag = next;
      i += 1;
    } else if (arg?.startsWith('--tag=')) {
      tag = arg.slice('--tag='.length);
      if (!tag) {
        throw new PeerUpdateError('INVALID_ARGS', '--tag requires a value');
      }
    } else {
      throw new PeerUpdateError('INVALID_ARGS', `Unknown argument: ${String(arg)}`);
    }
  }

  return { tag, dryRun, rollback, noAttestation, help };
}

// ---------------------------------------------------------------------------
// Exec wrapper (overridable for tests)
// ---------------------------------------------------------------------------

export type ExecResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
};

export type ExecFn = (
  cmd: string,
  args: readonly string[],
  options?: { cwd?: string; timeout?: number },
) => Promise<ExecResult>;

const defaultExec: ExecFn = (cmd, args, options) => {
  return new Promise((resolve) => {
    execFile(
      cmd,
      [...args],
      {
        cwd: options?.cwd,
        timeout: options?.timeout ?? 300_000,
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const exitCode =
          error && 'code' in error && typeof error.code === 'number' ? error.code : error ? 1 : 0;
        resolve({ stdout: String(stdout), stderr: String(stderr), exitCode });
      },
    );
  });
};

let execOverride: ExecFn | null = null;

export function setExecOverride(fn: ExecFn | null): void {
  execOverride = fn;
}

function run(
  cmd: string,
  args: readonly string[],
  options?: { cwd?: string; timeout?: number },
): Promise<ExecResult> {
  const exec = execOverride ?? defaultExec;
  return exec(cmd, args, options);
}

// ---------------------------------------------------------------------------
// History file helpers
// ---------------------------------------------------------------------------

export function readHistory(filePath: string = HISTORY_FILE): HistoryEntry[] {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isHistoryEntry);
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return [];
    }
    return [];
  }
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.startedAt === 'string' &&
    typeof v.finishedAt === 'string' &&
    (v.fromTag === null || typeof v.fromTag === 'string') &&
    typeof v.toTag === 'string' &&
    typeof v.success === 'boolean' &&
    typeof v.dryRun === 'boolean'
  );
}

export function appendHistory(
  entry: HistoryEntry,
  filePath: string = HISTORY_FILE,
  maxEntries: number = HISTORY_MAX_ENTRIES,
): HistoryEntry[] {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const existing = readHistory(filePath);
  const appended = [...existing, entry];
  const capped =
    appended.length > maxEntries ? appended.slice(appended.length - maxEntries) : appended;
  fs.writeFileSync(filePath, `${JSON.stringify(capped, null, 2)}\n`, {
    encoding: 'utf-8',
    mode: 0o600,
  });
  return capped;
}

export function findLastSuccessfulTag(
  history: readonly HistoryEntry[],
  excludeTag?: string,
): string | null {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const entry = history[i];
    if (!entry) continue;
    if (entry.success && !entry.dryRun && entry.toTag !== excludeTag) {
      return entry.toTag;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Step primitives
// ---------------------------------------------------------------------------

type StepContext = {
  readonly rootDir: string;
  readonly dryRun: boolean;
  readonly logger: Logger;
  readonly steps: StepRecord[];
};

function recordStep(ctx: StepContext, step: StepRecord): void {
  ctx.steps.push(step);
  const prefix = step.dryRun ? `${cyan('[dry-run]')} ` : '';
  const icon = step.ok ? green('[OK]') : red('[FAIL]');
  const extra = step.message ? ` ${dim(step.message)}` : '';
  ctx.logger.info(`${prefix}${icon} ${step.name}${extra}`);
}

async function resolveTargetTag(
  ctx: StepContext,
  explicitTag: string | undefined,
): Promise<string> {
  if (explicitTag) {
    recordStep(ctx, {
      name: 'Resolve target tag',
      ok: true,
      dryRun: ctx.dryRun,
      message: `--tag override: ${explicitTag}`,
    });
    return explicitTag;
  }

  if (ctx.dryRun) {
    recordStep(ctx, {
      name: 'Resolve target tag',
      ok: true,
      dryRun: true,
      message: 'would query gh api /releases/latest',
    });
    return 'vDRYRUN';
  }

  const { stdout, stderr, exitCode } = await run('gh', [
    'api',
    '/repos/:owner/:repo/releases/latest',
    '--jq',
    '.tag_name',
  ]);
  if (exitCode !== 0) {
    recordStep(ctx, {
      name: 'Resolve target tag',
      ok: false,
      dryRun: false,
      message: `gh api exited ${String(exitCode)}`,
    });
    throw new PeerUpdateError('TAG_RESOLVE_FAILED', 'Could not fetch latest release tag', {
      stderr: stderr.slice(0, 500),
    });
  }
  const tag = stdout.trim();
  if (!tag) {
    throw new PeerUpdateError('TAG_RESOLVE_FAILED', 'Empty tag from gh api response');
  }
  recordStep(ctx, {
    name: 'Resolve target tag',
    ok: true,
    dryRun: false,
    message: tag,
  });
  return tag;
}

async function currentTag(rootDir: string): Promise<string | null> {
  const { stdout, exitCode } = await run('git', ['describe', '--tags', '--exact-match', 'HEAD'], {
    cwd: rootDir,
  });
  if (exitCode !== 0) return null;
  return stdout.trim() || null;
}

type AttestationOutcome = {
  readonly verified: boolean;
  readonly skipped: boolean;
  readonly message: string;
};

async function verifyAttestation(
  ctx: StepContext,
  targetTag: string,
  noAttestation: boolean,
): Promise<AttestationOutcome> {
  if (noAttestation) {
    const outcome: AttestationOutcome = {
      verified: false,
      skipped: true,
      message: 'skipped via --no-attestation',
    };
    recordStep(ctx, { name: 'Verify attestation', ok: true, dryRun: ctx.dryRun, ...outcome });
    return outcome;
  }

  if (ctx.dryRun) {
    const outcome: AttestationOutcome = {
      verified: false,
      skipped: true,
      message: `would run gh attestation verify for ${targetTag}`,
    };
    recordStep(ctx, { name: 'Verify attestation', ok: true, dryRun: true, ...outcome });
    return outcome;
  }

  const { stdout, stderr, exitCode } = await run('gh', [
    'attestation',
    'verify',
    '--repo',
    ':owner/:repo',
    targetTag,
  ]);

  if (exitCode === 0) {
    const outcome: AttestationOutcome = { verified: true, skipped: false, message: 'verified' };
    recordStep(ctx, { name: 'Verify attestation', ok: true, dryRun: false, ...outcome });
    return outcome;
  }

  // gh emits a specific error when attestations aren't enabled — treat as skip.
  const combined = `${stdout}\n${stderr}`.toLowerCase();
  const notEnabled =
    combined.includes('no attestations found') ||
    combined.includes('attestations are not enabled') ||
    (combined.includes('attestation') && combined.includes('not found'));

  if (notEnabled) {
    ctx.logger.warn(
      'gh attestation verify reported no attestations; continuing without signature check',
    );
    const outcome: AttestationOutcome = {
      verified: false,
      skipped: true,
      message: 'attestations not enabled',
    };
    recordStep(ctx, { name: 'Verify attestation', ok: true, dryRun: false, ...outcome });
    return outcome;
  }

  recordStep(ctx, {
    name: 'Verify attestation',
    ok: false,
    dryRun: false,
    message: `gh attestation verify exited ${String(exitCode)}`,
  });
  throw new PeerUpdateError('ATTESTATION_FAILED', 'Attestation verification failed', {
    stderr: stderr.slice(0, 500),
  });
}

async function checkoutTag(ctx: StepContext, targetTag: string): Promise<boolean> {
  if (ctx.dryRun) {
    recordStep(ctx, {
      name: 'Checkout tag',
      ok: true,
      dryRun: true,
      message: `would fetch + checkout ${targetTag}`,
    });
    return false;
  }

  const already = await currentTag(ctx.rootDir);
  if (already === targetTag) {
    recordStep(ctx, {
      name: 'Checkout tag',
      ok: true,
      dryRun: false,
      message: `already on ${targetTag}`,
    });
    return false;
  }

  const fetchResult = await run('git', ['fetch', '--tags'], { cwd: ctx.rootDir });
  if (fetchResult.exitCode !== 0) {
    recordStep(ctx, {
      name: 'Checkout tag',
      ok: false,
      dryRun: false,
      message: 'git fetch --tags failed',
    });
    throw new PeerUpdateError('GIT_FETCH_FAILED', 'git fetch --tags failed', {
      stderr: fetchResult.stderr.slice(0, 500),
    });
  }

  const checkout = await run('git', ['checkout', targetTag], { cwd: ctx.rootDir });
  if (checkout.exitCode !== 0) {
    recordStep(ctx, {
      name: 'Checkout tag',
      ok: false,
      dryRun: false,
      message: `checkout ${targetTag} failed`,
    });
    throw new PeerUpdateError('GIT_CHECKOUT_FAILED', `git checkout ${targetTag} failed`, {
      stderr: checkout.stderr.slice(0, 500),
    });
  }

  recordStep(ctx, {
    name: 'Checkout tag',
    ok: true,
    dryRun: false,
    message: `checked out ${targetTag}`,
  });
  return true;
}

async function runMigrations(ctx: StepContext): Promise<void> {
  if (ctx.dryRun) {
    recordStep(ctx, {
      name: 'env-migrate.sh mesh',
      ok: true,
      dryRun: true,
      message: 'would run ./scripts/env-migrate.sh mesh',
    });
    return;
  }
  const result = await run(ENV_MIGRATE_SCRIPT, ['mesh'], { cwd: ctx.rootDir });
  if (result.exitCode !== 0) {
    recordStep(ctx, {
      name: 'env-migrate.sh mesh',
      ok: false,
      dryRun: false,
      message: `exited ${String(result.exitCode)}`,
    });
    throw new PeerUpdateError('MIGRATE_FAILED', 'env-migrate.sh mesh failed', {
      stderr: result.stderr.slice(0, 500),
    });
  }
  recordStep(ctx, { name: 'env-migrate.sh mesh', ok: true, dryRun: false });
}

async function runBuild(ctx: StepContext): Promise<void> {
  if (ctx.dryRun) {
    recordStep(ctx, {
      name: 'pnpm build',
      ok: true,
      dryRun: true,
      message: 'would run pnpm build',
    });
    return;
  }
  const result = await run('pnpm', ['build'], { cwd: ctx.rootDir, timeout: 600_000 });
  if (result.exitCode !== 0) {
    recordStep(ctx, {
      name: 'pnpm build',
      ok: false,
      dryRun: false,
      message: `exited ${String(result.exitCode)}`,
    });
    throw new PeerUpdateError('BUILD_FAILED', 'pnpm build failed', {
      stderr: result.stderr.slice(0, 500),
    });
  }
  recordStep(ctx, { name: 'pnpm build', ok: true, dryRun: false });
}

async function pm2Reload(ctx: StepContext): Promise<void> {
  if (ctx.dryRun) {
    recordStep(ctx, {
      name: 'pm2 reload mesh ecosystem',
      ok: true,
      dryRun: true,
      message: `would reload ${PM2_ECOSYSTEM}`,
    });
    return;
  }
  const result = await run('pm2', ['reload', PM2_ECOSYSTEM], { cwd: ctx.rootDir });
  if (result.exitCode !== 0) {
    recordStep(ctx, {
      name: 'pm2 reload mesh ecosystem',
      ok: false,
      dryRun: false,
      message: `exited ${String(result.exitCode)}`,
    });
    throw new PeerUpdateError('PM2_RELOAD_FAILED', 'pm2 reload failed', {
      stderr: result.stderr.slice(0, 500),
    });
  }
  recordStep(ctx, { name: 'pm2 reload mesh ecosystem', ok: true, dryRun: false });
}

// ---------------------------------------------------------------------------
// Health polling
// ---------------------------------------------------------------------------

export type FetchFn = (url: string) => Promise<{ ok: boolean; body?: Record<string, unknown> }>;

const defaultFetch: FetchFn = async (url) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    let body: Record<string, unknown> | undefined;
    try {
      body = (await resp.json()) as Record<string, unknown>;
    } catch {
      body = undefined;
    }
    return { ok: resp.ok, body };
  } catch {
    return { ok: false };
  }
};

let fetchOverride: FetchFn | null = null;

export function setFetchOverride(fn: FetchFn | null): void {
  fetchOverride = fn;
}

export function normalizeTag(tag: string): string {
  return tag.startsWith('v') ? tag.slice(1) : tag;
}

async function pollHealth(
  ctx: StepContext,
  targetTag: string,
  healthUrl: string,
  timeoutMs: number,
  intervalMs: number,
): Promise<void> {
  if (ctx.dryRun) {
    recordStep(ctx, {
      name: 'Poll /health appVersion',
      ok: true,
      dryRun: true,
      message: `would poll ${healthUrl} for ${targetTag}`,
    });
    return;
  }

  const expected = normalizeTag(targetTag);
  const start = Date.now();
  const fetchFn = fetchOverride ?? defaultFetch;

  while (Date.now() - start < timeoutMs) {
    const { ok, body } = await fetchFn(healthUrl);
    const appVersion = typeof body?.appVersion === 'string' ? body.appVersion : undefined;
    if (ok && appVersion && normalizeTag(appVersion) === expected) {
      recordStep(ctx, {
        name: 'Poll /health appVersion',
        ok: true,
        dryRun: false,
        message: `matched ${appVersion}`,
      });
      return;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  recordStep(ctx, {
    name: 'Poll /health appVersion',
    ok: false,
    dryRun: false,
    message: `timeout after ${String(timeoutMs)}ms`,
  });
  throw new PeerUpdateError('HEALTH_TIMEOUT', `Health did not report ${targetTag} within timeout`, {
    healthUrl,
    timeoutMs,
  });
}

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

async function performRollback(ctx: StepContext, previousTag: string): Promise<void> {
  ctx.logger.warn(`Rolling back to previous tag: ${previousTag}`);

  if (ctx.dryRun) {
    recordStep(ctx, {
      name: 'Rollback',
      ok: true,
      dryRun: true,
      message: `would roll back to ${previousTag}`,
    });
    return;
  }

  const checkout = await run('git', ['checkout', previousTag], { cwd: ctx.rootDir });
  if (checkout.exitCode !== 0) {
    recordStep(ctx, {
      name: 'Rollback',
      ok: false,
      dryRun: false,
      message: 'git checkout previous tag failed',
    });
    throw new PeerUpdateError('ROLLBACK_FAILED', 'rollback checkout failed', {
      stderr: checkout.stderr.slice(0, 500),
    });
  }

  const build = await run('pnpm', ['build'], { cwd: ctx.rootDir, timeout: 600_000 });
  if (build.exitCode !== 0) {
    recordStep(ctx, {
      name: 'Rollback',
      ok: false,
      dryRun: false,
      message: 'pnpm build during rollback failed',
    });
    throw new PeerUpdateError('ROLLBACK_FAILED', 'rollback build failed', {
      stderr: build.stderr.slice(0, 500),
    });
  }

  const reload = await run('pm2', ['reload', PM2_ECOSYSTEM], { cwd: ctx.rootDir });
  if (reload.exitCode !== 0) {
    recordStep(ctx, {
      name: 'Rollback',
      ok: false,
      dryRun: false,
      message: 'pm2 reload during rollback failed',
    });
    throw new PeerUpdateError('ROLLBACK_FAILED', 'rollback pm2 reload failed', {
      stderr: reload.stderr.slice(0, 500),
    });
  }

  recordStep(ctx, {
    name: 'Rollback',
    ok: true,
    dryRun: false,
    message: `restored ${previousTag}`,
  });
}

// ---------------------------------------------------------------------------
// Default logger
// ---------------------------------------------------------------------------

function consoleLogger(): Logger {
  return {
    info(message: string) {
      console.log(message);
    },
    warn(message: string) {
      console.log(`${yellow('[warn]')} ${message}`);
    },
    error(message: string) {
      console.error(`${red('[error]')} ${message}`);
    },
  };
}

// ---------------------------------------------------------------------------
// Core orchestration
// ---------------------------------------------------------------------------

export async function runPeerUpdate(options: UpdateOptions): Promise<UpdateResult> {
  const { flags } = options;
  const rootDir = options.rootDir ?? ROOT_DIR;
  const historyFile = options.historyFile ?? HISTORY_FILE;
  const healthUrl = options.healthUrl ?? HEALTH_URL;
  const healthTimeoutMs = options.healthTimeoutMs ?? HEALTH_POLL_TIMEOUT_MS;
  const healthIntervalMs = options.healthIntervalMs ?? HEALTH_POLL_INTERVAL_MS;
  const logger = options.logger ?? consoleLogger();

  const startedAt = new Date().toISOString();
  const steps: StepRecord[] = [];
  const ctx: StepContext = { rootDir, dryRun: flags.dryRun, logger, steps };

  const fromTag = await currentTag(rootDir).catch(() => null);

  // --rollback picks the previous successful tag from history, unless --tag overrides.
  let targetTag: string;
  try {
    if (flags.rollback) {
      const explicit = flags.tag;
      if (explicit) {
        targetTag = explicit;
        recordStep(ctx, {
          name: 'Resolve rollback tag',
          ok: true,
          dryRun: flags.dryRun,
          message: `--tag override: ${explicit}`,
        });
      } else {
        const history = readHistory(historyFile);
        const previous = findLastSuccessfulTag(history, fromTag ?? undefined);
        if (!previous) {
          throw new PeerUpdateError(
            'NO_ROLLBACK_TARGET',
            'No previous successful tag in update history',
          );
        }
        targetTag = previous;
        recordStep(ctx, {
          name: 'Resolve rollback tag',
          ok: true,
          dryRun: flags.dryRun,
          message: `using last successful tag: ${previous}`,
        });
      }
    } else {
      targetTag = await resolveTargetTag(ctx, flags.tag);
    }
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const result = errorResult(error, {
      dryRun: flags.dryRun,
      fromTag,
      toTag: 'unknown',
      startedAt,
      finishedAt,
      attestationVerified: false,
      attestationSkipped: false,
      rolledBack: false,
      steps,
    });
    appendHistory(toHistoryEntry(result), historyFile);
    return result;
  }

  let attestationVerified = false;
  let attestationSkipped = false;
  let rolledBack = false;

  try {
    // Rollback flag skips the fresh attestation check (target was previously verified).
    if (!flags.rollback) {
      const attestation = await verifyAttestation(ctx, targetTag, flags.noAttestation);
      attestationVerified = attestation.verified;
      attestationSkipped = attestation.skipped;
    } else {
      recordStep(ctx, {
        name: 'Verify attestation',
        ok: true,
        dryRun: flags.dryRun,
        message: 'skipped (rollback path, target previously verified)',
      });
      attestationSkipped = true;
    }

    await checkoutTag(ctx, targetTag);
    await runMigrations(ctx);
    await runBuild(ctx);
    await pm2Reload(ctx);
    await pollHealth(ctx, targetTag, healthUrl, healthTimeoutMs, healthIntervalMs);
  } catch (error) {
    // Trigger rollback (unless we are already in rollback or dry-run).
    if (!flags.rollback && !flags.dryRun && fromTag) {
      try {
        await performRollback(ctx, fromTag);
        rolledBack = true;
      } catch (rollbackErr) {
        logger.error(
          `Rollback failed: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`,
        );
      }
    }

    const finishedAt = new Date().toISOString();
    const result = errorResult(error, {
      dryRun: flags.dryRun,
      fromTag,
      toTag: targetTag,
      startedAt,
      finishedAt,
      attestationVerified,
      attestationSkipped,
      rolledBack,
      steps,
    });
    appendHistory(toHistoryEntry(result), historyFile);
    return result;
  }

  const finishedAt = new Date().toISOString();
  const result: UpdateResult = {
    success: true,
    dryRun: flags.dryRun,
    fromTag,
    toTag: targetTag,
    startedAt,
    finishedAt,
    attestationVerified,
    attestationSkipped,
    rolledBack,
    steps,
  };
  appendHistory(toHistoryEntry(result), historyFile);
  return result;
}

function toHistoryEntry(result: UpdateResult): HistoryEntry {
  return {
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    fromTag: result.fromTag,
    toTag: result.toTag,
    success: result.success,
    errorMessage: result.errorMessage,
    dryRun: result.dryRun,
  };
}

function errorResult(
  error: unknown,
  base: {
    dryRun: boolean;
    fromTag: string | null;
    toTag: string;
    startedAt: string;
    finishedAt: string;
    attestationVerified: boolean;
    attestationSkipped: boolean;
    rolledBack: boolean;
    steps: readonly StepRecord[];
  },
): UpdateResult {
  const code = error instanceof PeerUpdateError ? error.code : 'UNKNOWN';
  const message = error instanceof Error ? error.message : String(error);
  return {
    success: false,
    errorCode: code,
    errorMessage: message,
    ...base,
  };
}

// ---------------------------------------------------------------------------
// CLI main
// ---------------------------------------------------------------------------

function printHelp(): void {
  const out = `
${bold('agentctl peer update')} — self-update the local PM2 mesh node

${bold('USAGE')}
  pnpm peer-update [options]
  npx tsx scripts/peer-update.ts [options]

${bold('OPTIONS')}
  ${cyan('--tag <tag>')}        Use an explicit release tag (skips gh api lookup)
  ${cyan('--dry-run')}          Print each step without executing mutations
  ${cyan('--rollback')}         Restore the last successful tag from update-history.json
  ${cyan('--no-attestation')}   Skip ${cyan('gh attestation verify')} (opt-out only)
  ${cyan('--help, -h')}         Show this help message

${bold('HISTORY')}
  Run metadata is appended to ${cyan('~/.agentctl/update-history.json')} (cap 100 entries).

${bold('EXAMPLES')}
  ${dim('# Inspect the planned update without touching anything')}
  pnpm peer-update --dry-run

  ${dim('# Pin to a specific tag')}
  pnpm peer-update --tag v0.3.4

  ${dim('# Roll back to the previously-successful tag')}
  pnpm peer-update --rollback
`;
  process.stdout.write(out);
}

export async function main(argv: readonly string[]): Promise<number> {
  let flags: CliFlags;
  try {
    flags = parseArgs(argv);
  } catch (error) {
    if (error instanceof PeerUpdateError) {
      process.stderr.write(`${red('Error')} [${error.code}]: ${error.message}\n`);
      return 2;
    }
    throw error;
  }

  if (flags.help) {
    printHelp();
    return 0;
  }

  const result = await runPeerUpdate({ flags });

  if (!isTty()) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else if (result.success) {
    const mode = result.dryRun ? ' (dry-run)' : '';
    process.stdout.write(
      `\n${green('peer-update succeeded')}${mode} — ${result.fromTag ?? 'unknown'} -> ${result.toTag}\n`,
    );
  } else {
    const rollback = result.rolledBack ? ' (rolled back)' : '';
    process.stdout.write(
      `\n${red('peer-update failed')}${rollback}: ${result.errorMessage ?? 'unknown error'}\n`,
    );
  }

  return result.success ? 0 : 1;
}

const invokedDirectly =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  typeof process.argv[1] === 'string' &&
  /peer-update\.(ts|js|mjs|cjs)$/.test(process.argv[1]);

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exit(code);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${red('Fatal:')} ${message}\n`);
      process.exit(1);
    });
}
