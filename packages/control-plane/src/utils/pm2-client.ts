import { execFile } from 'node:child_process';

// ── Types ────────────────────────────────────────────────────────

export type Pm2ProcessInfo = {
  readonly name: string;
  readonly pid: number | null;
  readonly status: string;
  readonly memoryMb: number;
  readonly uptimeMs: number;
  readonly restarts: number;
};

export type Pm2Logger = {
  error: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
};

type Pm2ProcessDescription = {
  readonly name?: string;
  readonly pid?: number;
  readonly monit?: { readonly memory?: number };
  readonly pm2_env?: {
    readonly status?: string;
    readonly pm_uptime?: number;
    readonly restart_time?: number;
  };
};

const PM2_TIMEOUT_MS = 5_000;
const PM2_MAX_BUFFER_BYTES = 1_048_576;

// ── Serialization queue ──────────────────────────────────────────

/**
 * Serialize PM2 CLI calls so status reads and restarts do not interleave.
 */
let queueTail: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = queueTail.then(fn, fn);
  queueTail = next.catch(() => {
    /* swallow to keep chain alive */
  });
  return next;
}

// ── Helpers ──────────────────────────────────────────────────────

function runPm2Command(args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'pm2',
      [...args],
      {
        timeout: PM2_TIMEOUT_MS,
        maxBuffer: PM2_MAX_BUFFER_BYTES,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function toProcessInfo(proc: Pm2ProcessDescription): Pm2ProcessInfo {
  return {
    name: proc.name ?? 'unknown',
    pid: proc.pid ?? null,
    status: proc.pm2_env?.status ?? 'unknown',
    memoryMb: Math.round(((proc.monit?.memory ?? 0) / 1024 / 1024) * 100) / 100,
    uptimeMs: proc.pm2_env?.pm_uptime ? Date.now() - proc.pm2_env.pm_uptime : 0,
    restarts: proc.pm2_env?.restart_time ?? 0,
  };
}

// ── Public API ───────────────────────────────────────────────────

/**
 * List all PM2-managed processes with typed info.
 *
 * Uses the PM2 CLI that is already required on beta hosts.
 * If PM2 is not running, returns an empty array (graceful degradation).
 */
export function pm2List(logger?: Pm2Logger): Promise<readonly Pm2ProcessInfo[]> {
  return enqueue(async () => {
    try {
      const stdout = await runPm2Command(['jlist']);
      const parsed = JSON.parse(stdout) as Pm2ProcessDescription[];
      return parsed.map(toProcessInfo);
    } catch (err) {
      logger?.warn(
        { error: err instanceof Error ? err.message : String(err) },
        'PM2 list failed — daemon may not be running',
      );
      return [];
    }
  });
}

/**
 * Restart a PM2 process by name.
 *
 * Uses the PM2 CLI that is already required on beta hosts.
 * If PM2 is not running or the process is not found, the error is logged
 * but not thrown (graceful degradation).
 */
export function pm2Restart(name: string, logger?: Pm2Logger): Promise<void> {
  return enqueue(async () => {
    try {
      await runPm2Command(['restart', name]);
    } catch (err) {
      logger?.error(
        { error: err instanceof Error ? err.message : String(err), processName: name },
        'PM2 restart failed',
      );
    }
  });
}
