import pm2 from 'pm2';

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

// ── Serialization queue ──────────────────────────────────────────

/**
 * Simple promise-based queue to serialize PM2 connect/disconnect calls.
 * PM2's programmatic API is not safe for concurrent `connect()` calls.
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

function connectPm2(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    pm2.connect((err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function disconnectPm2(): void {
  try {
    pm2.disconnect();
  } catch {
    // Ignore disconnect errors
  }
}

// ── Public API ───────────────────────────────────────────────────

/**
 * List all PM2-managed processes with typed info.
 *
 * Uses short-lived connections: connect -> list -> disconnect.
 * If PM2 is not running, returns an empty array (graceful degradation).
 */
export function pm2List(logger?: Pm2Logger): Promise<readonly Pm2ProcessInfo[]> {
  return enqueue(async () => {
    try {
      await connectPm2();
      const list = await new Promise<pm2.ProcessDescription[]>((resolve, reject) => {
        pm2.list((err, procs) => {
          if (err) {
            reject(err);
          } else {
            resolve(procs);
          }
        });
      });

      return list.map((proc) => ({
        name: proc.name ?? 'unknown',
        pid: proc.pid ?? null,
        status: proc.pm2_env?.status ?? 'unknown',
        memoryMb: Math.round(((proc.monit?.memory ?? 0) / 1024 / 1024) * 100) / 100,
        uptimeMs: proc.pm2_env?.pm_uptime ? Date.now() - proc.pm2_env.pm_uptime : 0,
        restarts: proc.pm2_env?.restart_time ?? 0,
      }));
    } catch (err) {
      logger?.warn(
        { error: err instanceof Error ? err.message : String(err) },
        'PM2 list failed — daemon may not be running',
      );
      return [];
    } finally {
      disconnectPm2();
    }
  });
}

/**
 * Restart a PM2 process by name.
 *
 * Uses short-lived connections: connect -> restart -> disconnect.
 * If PM2 is not running or the process is not found, the error is logged
 * but not thrown (graceful degradation).
 */
export function pm2Restart(name: string, logger?: Pm2Logger): Promise<void> {
  return enqueue(async () => {
    try {
      await connectPm2();
      await new Promise<void>((resolve, reject) => {
        pm2.restart(name, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    } catch (err) {
      logger?.error(
        { error: err instanceof Error ? err.message : String(err), processName: name },
        'PM2 restart failed',
      );
    } finally {
      disconnectPm2();
    }
  });
}
