// ---------------------------------------------------------------------------
// Mesh auto-update — routes backing the `/settings` Mesh auto-update panel
// (roadmap §33.11).
//
// GET  /api/mesh/auto-update         → AutoUpdateStatus
// POST /api/mesh/auto-update/toggle  → AutoUpdateStatus after enabling/disabling
//                                      the platform scheduler (launchd on
//                                      darwin, systemd-user on linux).
// POST /api/mesh/auto-update/dry-run → SSE stream of AutoUpdateDryRunEvent
//                                      chunks while `pnpm agentctl peer update
//                                      --dry-run` runs.
//
// All three routes are IP-rate-limited (10/min for the read, 5/min for the
// mutating + streaming variants) so the endpoints cannot be hammered as a
// spawn-oracle. The scheduler toggle does NOT take a raw shell command —
// everything is dispatched via `execFile` with a hard-coded allow-list so the
// request body cannot influence argv.
// ---------------------------------------------------------------------------

import { execFile, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AutoUpdateDryRunEvent, AutoUpdateLastRun, AutoUpdateStatus } from '@agentctl/shared';
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';

import { readRateLimitEnv } from '../rate-limit.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_RATE_LIMIT = { max: 30, timeWindow: 60_000 } as const;
const TOGGLE_RATE_LIMIT = { max: 5, timeWindow: 60_000 } as const;
const DRY_RUN_RATE_LIMIT = { max: 5, timeWindow: 60_000 } as const;

const SCHEDULER_CMD_TIMEOUT_MS = 5_000;
const DRY_RUN_TIMEOUT_MS = 300_000;
const DRY_RUN_MAX_OUTPUT_BYTES = 2 * 1024 * 1024; // 2 MiB — hard cap on stdout + stderr.

const LAUNCHD_LABEL = 'com.agentctl.peer-update';
const SYSTEMD_UNIT = 'agentctl-peer-update.timer';

const HISTORY_FILE = path.join(os.homedir(), '.agentctl', 'update-history.json');

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class MeshAutoUpdateError extends Error {
  constructor(
    public code: string,
    message: string,
    public context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'MeshAutoUpdateError';
  }
}

// ---------------------------------------------------------------------------
// Injectable surface (kept tiny so the tests can stub platform interactions
// without touching node:child_process or the real filesystem).
// ---------------------------------------------------------------------------

export type ExecCapturedResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
};

export type ExecCaptured = (
  cmd: string,
  args: readonly string[],
  opts?: { timeoutMs?: number },
) => Promise<ExecCapturedResult>;

export type SpawnStreamed = (
  cmd: string,
  args: readonly string[],
  opts: {
    readonly cwd: string;
    readonly timeoutMs: number;
    readonly onStdout: (chunk: string) => void;
    readonly onStderr: (chunk: string) => void;
    readonly onClose: (exitCode: number | null) => void;
    readonly onError: (err: Error) => void;
  },
) => { kill: () => void };

export type ReadHistoryFile = (filePath: string) => Promise<string | null>;

export type MeshAutoUpdatePlatform = 'darwin' | 'linux' | 'unsupported';

export type MeshAutoUpdateDeps = {
  readonly platform: MeshAutoUpdatePlatform;
  readonly exec: ExecCaptured;
  readonly spawnProcess: SpawnStreamed;
  readonly readHistoryFile: ReadHistoryFile;
  readonly historyFilePath: string;
  readonly repoRoot: string;
  readonly logger?: Pick<Logger, 'warn' | 'debug' | 'info' | 'error'>;
};

// ---------------------------------------------------------------------------
// Default implementations
// ---------------------------------------------------------------------------

function detectPlatform(): MeshAutoUpdatePlatform {
  if (process.platform === 'darwin') return 'darwin';
  if (process.platform === 'linux') return 'linux';
  return 'unsupported';
}

const defaultExec: ExecCaptured = (cmd, args, opts) => {
  return new Promise((resolve) => {
    execFile(
      cmd,
      [...args],
      { timeout: opts?.timeoutMs ?? SCHEDULER_CMD_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        const exitCode =
          err && 'code' in err && typeof err.code === 'number' ? err.code : err ? 1 : 0;
        resolve({ stdout: String(stdout), stderr: String(stderr), exitCode });
      },
    );
  });
};

const defaultSpawn: SpawnStreamed = (cmd, args, opts) => {
  const child = spawn(cmd, [...args], {
    cwd: opts.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  const timer = setTimeout(() => {
    opts.onError(new MeshAutoUpdateError('DRY_RUN_TIMEOUT', 'Dry-run exceeded timeout'));
    child.kill('SIGTERM');
  }, opts.timeoutMs);

  child.stdout?.setEncoding('utf-8');
  child.stderr?.setEncoding('utf-8');

  child.stdout?.on('data', (chunk: string) => opts.onStdout(chunk));
  child.stderr?.on('data', (chunk: string) => opts.onStderr(chunk));

  child.on('error', (err) => {
    clearTimeout(timer);
    opts.onError(err);
  });

  child.on('close', (code) => {
    clearTimeout(timer);
    opts.onClose(code);
  });

  return {
    kill: () => {
      clearTimeout(timer);
      try {
        child.kill('SIGTERM');
      } catch {
        // best-effort
      }
    },
  };
};

const defaultReadHistoryFile: ReadHistoryFile = async (filePath) => {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
};

function defaultRepoRoot(): string {
  // control-plane runs from packages/control-plane/dist — we need the monorepo
  // root so `pnpm agentctl peer update --dry-run` finds the workspace script.
  return path.resolve(process.cwd());
}

// ---------------------------------------------------------------------------
// History parsing — mirrors the HistoryEntry shape written by peer-update.ts.
// ---------------------------------------------------------------------------

type RawHistoryEntry = {
  startedAt?: unknown;
  finishedAt?: unknown;
  fromTag?: unknown;
  toTag?: unknown;
  success?: unknown;
  errorMessage?: unknown;
  dryRun?: unknown;
};

function asIso(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? value : null;
}

function parseLastRun(raw: string | null): AutoUpdateLastRun | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;

  const latest = parsed[parsed.length - 1] as RawHistoryEntry;
  if (!latest || typeof latest !== 'object') return null;

  const startedAt = asIso(latest.startedAt);
  const finishedAt = asIso(latest.finishedAt);
  const toTag = typeof latest.toTag === 'string' ? latest.toTag : null;
  const success = typeof latest.success === 'boolean' ? latest.success : null;
  const dryRun = typeof latest.dryRun === 'boolean' ? latest.dryRun : false;

  if (!startedAt || !finishedAt || !toTag || success === null) return null;

  const durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));
  const error =
    !success && typeof latest.errorMessage === 'string' ? latest.errorMessage : undefined;

  return {
    version: toTag,
    startedAt,
    durationMs,
    status: success ? 'success' : 'failure',
    error,
    dryRun,
  };
}

// ---------------------------------------------------------------------------
// Platform scheduler adapters
// ---------------------------------------------------------------------------

/** Extract the next-run unix timestamp (in seconds) from a `launchctl print` block. */
function parseLaunchdNextFireFromPrint(raw: string): string | null {
  // launchctl print emits lines like:   next fire = 2026-04-15 03:00:00 -0700
  // or, depending on macOS version:     next invocation = 1734556800
  const epochMatch = /next (?:fire|invocation)\s*=\s*(\d{9,13})/i.exec(raw);
  if (epochMatch?.[1]) {
    const epoch = Number(epochMatch[1]);
    if (Number.isFinite(epoch)) {
      const ms = epoch < 1e12 ? epoch * 1000 : epoch;
      return new Date(ms).toISOString();
    }
  }
  const isoMatch = /next (?:fire|invocation)\s*=\s*([0-9\-:\sT+]+)/i.exec(raw);
  if (isoMatch?.[1]) {
    const t = Date.parse(isoMatch[1].trim());
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }
  return null;
}

async function readDarwinStatus(
  deps: MeshAutoUpdateDeps,
): Promise<{ enabled: boolean; nextScheduledRun: string | null }> {
  const list = await deps.exec('launchctl', ['list']);
  const enabled =
    list.exitCode === 0 && list.stdout.split('\n').some((line) => line.includes(LAUNCHD_LABEL));
  if (!enabled) return { enabled: false, nextScheduledRun: null };

  const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
  const print = await deps.exec('launchctl', ['print', `gui/${uid}/${LAUNCHD_LABEL}`]);
  const nextScheduledRun =
    print.exitCode === 0 ? parseLaunchdNextFireFromPrint(print.stdout) : null;
  return { enabled, nextScheduledRun };
}

/** Extract the first ISO timestamp from a `systemctl list-timers` row. */
function parseSystemdNextRun(raw: string): string | null {
  for (const line of raw.split('\n')) {
    if (!line.includes(SYSTEMD_UNIT)) continue;
    // Column: NEXT (local time in RFC2822-ish) — take the first chunk that parses.
    const isoHit = /(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)/.exec(line);
    if (isoHit?.[1]) {
      const t = Date.parse(isoHit[1].replace(' ', 'T'));
      if (Number.isFinite(t)) return new Date(t).toISOString();
    }
  }
  return null;
}

async function readLinuxStatus(
  deps: MeshAutoUpdateDeps,
): Promise<{ enabled: boolean; nextScheduledRun: string | null }> {
  const isEnabled = await deps.exec('systemctl', ['--user', 'is-enabled', SYSTEMD_UNIT]);
  const enabled = isEnabled.exitCode === 0 && isEnabled.stdout.trim() === 'enabled';
  if (!enabled) return { enabled: false, nextScheduledRun: null };

  const timers = await deps.exec('systemctl', [
    '--user',
    'list-timers',
    '--no-pager',
    '--no-legend',
    SYSTEMD_UNIT,
  ]);
  const nextScheduledRun = timers.exitCode === 0 ? parseSystemdNextRun(timers.stdout) : null;
  return { enabled, nextScheduledRun };
}

export async function readSchedulerStatus(
  deps: MeshAutoUpdateDeps,
): Promise<{ enabled: boolean; nextScheduledRun: string | null }> {
  try {
    if (deps.platform === 'darwin') return await readDarwinStatus(deps);
    if (deps.platform === 'linux') return await readLinuxStatus(deps);
  } catch (err) {
    deps.logger?.warn?.({ err }, 'mesh auto-update scheduler probe failed');
  }
  return { enabled: false, nextScheduledRun: null };
}

async function toggleDarwinScheduler(deps: MeshAutoUpdateDeps, enabled: boolean): Promise<void> {
  const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
  const domain = `gui/${uid}`;
  const plistPath = path.join(os.homedir(), 'Library/LaunchAgents', `${LAUNCHD_LABEL}.plist`);
  const sub = enabled ? 'bootstrap' : 'bootout';
  const args = sub === 'bootstrap' ? [sub, domain, plistPath] : [sub, `${domain}/${LAUNCHD_LABEL}`];
  const result = await deps.exec('launchctl', args);
  if (result.exitCode !== 0) {
    throw new MeshAutoUpdateError('LAUNCHCTL_FAILED', `launchctl ${sub} failed`, {
      exitCode: result.exitCode,
      stderr: result.stderr.slice(0, 500),
    });
  }
}

async function toggleLinuxScheduler(deps: MeshAutoUpdateDeps, enabled: boolean): Promise<void> {
  const verb = enabled ? 'enable' : 'disable';
  const result = await deps.exec('systemctl', ['--user', verb, '--now', SYSTEMD_UNIT]);
  if (result.exitCode !== 0) {
    throw new MeshAutoUpdateError('SYSTEMCTL_FAILED', `systemctl --user ${verb} failed`, {
      exitCode: result.exitCode,
      stderr: result.stderr.slice(0, 500),
    });
  }
}

async function toggleScheduler(deps: MeshAutoUpdateDeps, enabled: boolean): Promise<void> {
  if (deps.platform === 'darwin') return toggleDarwinScheduler(deps, enabled);
  if (deps.platform === 'linux') return toggleLinuxScheduler(deps, enabled);
  throw new MeshAutoUpdateError(
    'PLATFORM_UNSUPPORTED',
    'Auto-update toggle is only supported on darwin or linux',
  );
}

// ---------------------------------------------------------------------------
// Route options + rate-limit plumbing
// ---------------------------------------------------------------------------

export type MeshAutoUpdateRoutesOptions = Partial<MeshAutoUpdateDeps>;

function resolveDeps(opts: MeshAutoUpdateRoutesOptions): MeshAutoUpdateDeps {
  return {
    platform: opts.platform ?? detectPlatform(),
    exec: opts.exec ?? defaultExec,
    spawnProcess: opts.spawnProcess ?? defaultSpawn,
    readHistoryFile: opts.readHistoryFile ?? defaultReadHistoryFile,
    historyFilePath: opts.historyFilePath ?? HISTORY_FILE,
    repoRoot: opts.repoRoot ?? defaultRepoRoot(),
    logger: opts.logger,
  };
}

function getRateLimitKey(request: {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}): string {
  return (
    request.ip ??
    (typeof request.headers['x-forwarded-for'] === 'string'
      ? request.headers['x-forwarded-for']
      : 'unknown')
  );
}

type RateLimitConfig = {
  max: number;
  timeWindow: number;
  keyGenerator: typeof getRateLimitKey;
  errorResponseBuilder: () => { statusCode: 429; error: 'RATE_LIMITED'; message: string };
};

function buildRateLimit(
  envPrefix: string,
  fallback: { max: number; timeWindow: number },
): RateLimitConfig {
  return {
    max: readRateLimitEnv(`${envPrefix}_MAX`, fallback.max),
    timeWindow: readRateLimitEnv(`${envPrefix}_WINDOW_MS`, fallback.timeWindow),
    keyGenerator: getRateLimitKey,
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'RATE_LIMITED',
      message: 'Too many mesh auto-update requests',
    }),
  };
}

// ---------------------------------------------------------------------------
// Core status + toggle builders (exported for unit tests)
// ---------------------------------------------------------------------------

export async function buildStatus(deps: MeshAutoUpdateDeps): Promise<AutoUpdateStatus> {
  const [{ enabled, nextScheduledRun }, historyRaw] = await Promise.all([
    readSchedulerStatus(deps),
    deps.readHistoryFile(deps.historyFilePath).catch(() => null),
  ]);
  const lastRun = parseLastRun(historyRaw);
  return {
    enabled,
    nextScheduledRun,
    lastRun,
    platform: deps.platform,
  };
}

function isValidToggleBody(body: unknown): body is { enabled: boolean } {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as { enabled?: unknown }).enabled === 'boolean'
  );
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const meshAutoUpdateRoutes: FastifyPluginAsync<MeshAutoUpdateRoutesOptions> = async (
  app,
  rawOpts,
) => {
  const deps = resolveDeps(rawOpts);

  const statusRateLimitConfig = buildRateLimit(
    'MESH_AUTO_UPDATE_STATUS_RATE_LIMIT',
    STATUS_RATE_LIMIT,
  );
  const toggleRateLimitConfig = buildRateLimit(
    'MESH_AUTO_UPDATE_TOGGLE_RATE_LIMIT',
    TOGGLE_RATE_LIMIT,
  );
  const dryRunRateLimitConfig = buildRateLimit(
    'MESH_AUTO_UPDATE_DRY_RUN_RATE_LIMIT',
    DRY_RUN_RATE_LIMIT,
  );

  await app.register(rateLimit, {
    global: false,
    keyGenerator: getRateLimitKey,
    errorResponseBuilder: statusRateLimitConfig.errorResponseBuilder,
  });

  // -------------------------------------------------------------------------
  // GET /api/mesh/auto-update
  // -------------------------------------------------------------------------
  app.get(
    '/auto-update',
    {
      config: { rateLimit: statusRateLimitConfig },
      schema: { tags: ['mesh'], summary: 'Read mesh auto-update status' },
      preHandler: [app.rateLimit(statusRateLimitConfig)],
    },
    // codeql[js/missing-rate-limiting]
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const status = await buildStatus(deps);
        return reply.code(200).send(status);
      } catch (err) {
        deps.logger?.error?.({ err }, 'Failed to build mesh auto-update status');
        return reply
          .code(500)
          .send({ error: 'STATUS_FAILED', message: 'Failed to read auto-update status' });
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/mesh/auto-update/toggle
  // -------------------------------------------------------------------------
  app.post(
    '/auto-update/toggle',
    {
      config: { rateLimit: toggleRateLimitConfig },
      schema: { tags: ['mesh'], summary: 'Enable or disable the mesh auto-update scheduler' },
      preHandler: [app.rateLimit(toggleRateLimitConfig)],
    },
    // codeql[js/missing-rate-limiting]
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!isValidToggleBody(request.body)) {
        return reply
          .code(400)
          .send({ error: 'INVALID_BODY', message: 'Body must be { enabled: boolean }' });
      }
      if (deps.platform === 'unsupported') {
        return reply.code(400).send({
          error: 'PLATFORM_UNSUPPORTED',
          message: 'Auto-update toggle is only supported on darwin or linux',
        });
      }

      try {
        await toggleScheduler(deps, request.body.enabled);
      } catch (err) {
        if (err instanceof MeshAutoUpdateError) {
          deps.logger?.warn?.({ code: err.code }, 'mesh auto-update toggle failed');
          return reply.code(500).send({ error: err.code, message: err.message });
        }
        deps.logger?.error?.({ err }, 'Unexpected mesh auto-update toggle error');
        return reply
          .code(500)
          .send({ error: 'TOGGLE_FAILED', message: 'Failed to toggle auto-update scheduler' });
      }

      const status = await buildStatus(deps);
      return reply.code(200).send(status);
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/mesh/auto-update/dry-run — SSE stream
  // -------------------------------------------------------------------------
  app.post(
    '/auto-update/dry-run',
    {
      config: { rateLimit: dryRunRateLimitConfig },
      schema: { tags: ['mesh'], summary: 'Stream peer update --dry-run output as SSE' },
      preHandler: [app.rateLimit(dryRunRateLimitConfig)],
    },
    // codeql[js/missing-rate-limiting]
    async (request: FastifyRequest, reply: FastifyReply) => {
      const startedAt = new Date().toISOString();
      const started = Date.now();

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const write = (event: AutoUpdateDryRunEvent): void => {
        try {
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        } catch {
          // client disconnected — handled by close listener.
        }
      };

      // Invariant argv: the body cannot influence what gets spawned. Only
      // `pnpm agentctl peer update --dry-run` is executable via this route.
      const cmd = 'pnpm';
      const args = ['agentctl', 'peer', 'update', '--dry-run'] as const;

      write({ type: 'start', startedAt, command: `${cmd} ${args.join(' ')}` });

      let totalBytes = 0;
      let finished = false;
      const finish = (exitCode: number): void => {
        if (finished) return;
        finished = true;
        write({ type: 'done', exitCode, durationMs: Date.now() - started });
        try {
          reply.raw.end();
        } catch {
          // ignore
        }
      };

      const child = deps.spawnProcess(cmd, [...args], {
        cwd: deps.repoRoot,
        timeoutMs: DRY_RUN_TIMEOUT_MS,
        onStdout: (chunk) => {
          totalBytes += Buffer.byteLength(chunk, 'utf-8');
          if (totalBytes > DRY_RUN_MAX_OUTPUT_BYTES) {
            write({ type: 'error', message: 'Output exceeded size cap; truncating' });
            finish(1);
            return;
          }
          write({ type: 'stdout', chunk });
        },
        onStderr: (chunk) => {
          totalBytes += Buffer.byteLength(chunk, 'utf-8');
          if (totalBytes > DRY_RUN_MAX_OUTPUT_BYTES) {
            write({ type: 'error', message: 'Output exceeded size cap; truncating' });
            finish(1);
            return;
          }
          write({ type: 'stderr', chunk });
        },
        onClose: (code) => finish(code ?? 0),
        onError: (err) => {
          deps.logger?.warn?.({ err: err.message }, 'mesh auto-update dry-run spawn error');
          write({ type: 'error', message: err.message });
          finish(1);
        },
      });

      request.raw.on('close', () => {
        if (!finished) {
          child.kill();
          finished = true;
        }
      });
    },
  );
};
