import { execSync, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import type {
  PreflightCheckName,
  PreflightCheckResult,
  PreflightCheckStatus,
  TierConfig,
} from '@agentctl/shared';
import { eq } from 'drizzle-orm';

import type { Database } from '../db/index.js';
import { promotionHistory } from '../db/schema-deployment.js';
import { pm2Restart } from './pm2-client.js';

// ── Constants ────────────────────────────────────────────────────

const HEALTH_TIMEOUT_MS = 5_000;
const BUILD_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 30_000;

// ── Types ────────────────────────────────────────────────────────

export type PromotionLogger = {
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
};

export type PreflightResponse = {
  readonly passed: boolean;
  readonly checks: readonly PreflightCheckResult[];
};

export type PromotionHandle = {
  readonly id: string;
  readonly events: EventEmitter;
};

// ── Mutex ────────────────────────────────────────────────────────

export type PromotionMutex = ReturnType<typeof createPromotionMutex>;

export function createPromotionMutex(): {
  readonly isLocked: boolean;
  acquire(): Promise<() => void>;
} {
  let locked = false;
  let releaseResolve: (() => void) | null = null;

  return {
    get isLocked() {
      return locked;
    },
    async acquire(): Promise<() => void> {
      while (locked) {
        await new Promise<void>((r) => {
          releaseResolve = r;
        });
      }
      locked = true;
      return () => {
        locked = false;
        releaseResolve?.();
        releaseResolve = null;
      };
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────

async function fetchHealth(port: number): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(`http://localhost:${port}/health`, {
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function tcpCheck(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = createConnection({ port, host: 'localhost' }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, HEALTH_TIMEOUT_MS);
    socket.on('close', () => clearTimeout(timeout));
  });
}

function spawnProcess(
  command: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args as string[], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ ok: false, output: `${output}\nProcess timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, output });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, output: `${output}\nSpawn error: ${err.message}` });
    });
  });
}

function countMigrationFiles(repoRoot: string): number {
  const drizzleDir = join(repoRoot, 'packages', 'control-plane', 'drizzle');
  try {
    const entries = readdirSync(drizzleDir);
    return entries.filter((f) => f.endsWith('.sql')).length;
  } catch {
    return 0;
  }
}

function readJournalEntryCount(repoRoot: string): number {
  const journalPath = join(
    repoRoot,
    'packages',
    'control-plane',
    'drizzle',
    'meta',
    '_journal.json',
  );
  try {
    const raw = readFileSync(journalPath, 'utf-8');
    const journal = JSON.parse(raw) as { entries?: unknown[] };
    return journal.entries?.length ?? 0;
  } catch {
    return 0;
  }
}

function timedCheck(
  name: PreflightCheckName,
  fn: () => Promise<{ status: PreflightCheckStatus; message: string }>,
): Promise<PreflightCheckResult> {
  const start = Date.now();
  return fn().then(
    ({ status, message }) => ({
      name,
      status,
      message,
      durationMs: Date.now() - start,
    }),
    (err: unknown) => ({
      name,
      status: 'fail' as const,
      message: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    }),
  );
}

// ── PromotionRunner ──────────────────────────────────────────────

export class PromotionRunner {
  private readonly repoRoot: string;
  private readonly db: Database;
  private readonly logger: PromotionLogger;

  constructor(repoRoot: string, db: Database, logger: PromotionLogger) {
    this.repoRoot = repoRoot;
    this.db = db;
    this.logger = logger;
  }

  // ── Preflight ────────────────────────────────────────────────

  async runPreflight(
    source: string,
    tierConfigs: readonly TierConfig[],
  ): Promise<PreflightResponse> {
    const sourceTier = tierConfigs.find((c) => c.name === source);
    const betaTier = tierConfigs.find((c) => c.name === 'beta');

    if (!sourceTier) {
      return {
        passed: false,
        checks: [
          {
            name: 'source_health',
            status: 'fail',
            message: `Source tier "${source}" not found in config`,
          },
          { name: 'target_health', status: 'skipped', message: 'Skipped: source check failed' },
          { name: 'migration_parity', status: 'skipped', message: 'Skipped: source check failed' },
          { name: 'build', status: 'skipped', message: 'Skipped: source check failed' },
        ],
      };
    }

    const checks: PreflightCheckResult[] = [];

    // 1. Source health
    const sourceCheck = await timedCheck('source_health', async () => {
      const cpOk = await fetchHealth(sourceTier.cpPort);
      const workerOk = await fetchHealth(sourceTier.workerPort);
      const webOk = await tcpCheck(sourceTier.webPort);

      const failures: string[] = [];
      if (!cpOk) failures.push('cp');
      if (!workerOk) failures.push('worker');
      if (!webOk) failures.push('web');

      if (failures.length > 0) {
        return { status: 'fail' as const, message: `Unhealthy: ${failures.join(', ')}` };
      }
      return { status: 'pass' as const, message: 'All source services healthy' };
    });
    checks.push(sourceCheck);

    // 2. Target (beta) health
    const targetCheck = await timedCheck('target_health', async () => {
      if (!betaTier) {
        return { status: 'fail' as const, message: 'Beta tier not found in config' };
      }
      const cpOk = await fetchHealth(betaTier.cpPort);
      const workerOk = await fetchHealth(betaTier.workerPort);
      const webOk = await tcpCheck(betaTier.webPort);

      const failures: string[] = [];
      if (!cpOk) failures.push('cp');
      if (!workerOk) failures.push('worker');
      if (!webOk) failures.push('web');

      if (failures.length > 0) {
        return { status: 'fail' as const, message: `Unhealthy: ${failures.join(', ')}` };
      }
      return { status: 'pass' as const, message: 'All target services healthy' };
    });
    checks.push(targetCheck);

    // 3. Migration parity
    const migrationCheck = await timedCheck('migration_parity', async () => {
      const sqlCount = countMigrationFiles(this.repoRoot);
      const journalCount = readJournalEntryCount(this.repoRoot);

      if (sqlCount === 0) {
        return { status: 'fail' as const, message: 'No migration SQL files found' };
      }

      // Compare SQL file count with journal entry count as a parity signal
      if (sqlCount !== journalCount) {
        return {
          status: 'fail' as const,
          message: `Migration parity mismatch: ${sqlCount} SQL files vs ${journalCount} journal entries`,
        };
      }

      return {
        status: 'pass' as const,
        message: `${sqlCount} migrations in sync`,
      };
    });
    checks.push(migrationCheck);

    // 4. Build — skip full rebuild if a recent .next/BUILD_ID exists (within 30 min)
    const BUILD_FRESHNESS_MS = 30 * 60 * 1000;
    const buildCheck = await timedCheck('build', async () => {
      const buildIdPath = join(this.repoRoot, 'packages', 'web', '.next', 'BUILD_ID');
      if (existsSync(buildIdPath)) {
        const mtime = statSync(buildIdPath).mtimeMs;
        if (Date.now() - mtime < BUILD_FRESHNESS_MS) {
          return {
            status: 'pass' as const,
            message: `Build fresh (${Math.round((Date.now() - mtime) / 60000)}m ago)`,
          };
        }
      }
      // Build only shared + CP + worker + web (skip mobile which needs Expo)
      const buildCmd = [
        'pnpm',
        '--filter',
        '@agentctl/shared',
        '--filter',
        '@agentctl/control-plane',
        '--filter',
        '@agentctl/agent-worker',
        '--filter',
        '@agentctl/web',
        'build',
      ];
      const result = await spawnProcess(
        buildCmd[0],
        buildCmd.slice(1),
        this.repoRoot,
        BUILD_TIMEOUT_MS,
      );
      if (!result.ok) {
        const tail = result.output.length > 500 ? result.output.slice(-500) : result.output;
        return { status: 'fail' as const, message: `Build failed: ${tail}` };
      }
      return { status: 'pass' as const, message: 'Build succeeded' };
    });
    checks.push(buildCheck);

    const passed = checks.every((c) => c.status === 'pass');
    return { passed, checks };
  }

  // ── Promote ──────────────────────────────────────────────────

  async promote(
    source: string,
    tierConfigs: readonly TierConfig[],
    mutex: PromotionMutex,
  ): Promise<PromotionHandle> {
    const events = new EventEmitter();
    const startedAt = new Date();

    // Insert promotion record
    const [row] = await this.db
      .insert(promotionHistory)
      .values({
        sourceTier: source,
        targetTier: 'beta',
        status: 'pending',
        triggeredBy: 'web',
      })
      .returning({ id: promotionHistory.id });

    const id = row.id;

    // Capture git sha
    let gitSha: string | undefined;
    try {
      gitSha = execSync('git rev-parse HEAD', { cwd: this.repoRoot }).toString().trim();
    } catch {
      this.logger.warn({ promotionId: id }, 'Could not capture git SHA');
    }

    if (gitSha) {
      await this.db.update(promotionHistory).set({ gitSha }).where(eq(promotionHistory.id, id));
    }

    // Run promotion pipeline asynchronously
    this.runPipeline(id, source, tierConfigs, mutex, events, startedAt).catch((err) => {
      this.logger.error(
        { promotionId: id, error: err instanceof Error ? err.message : String(err) },
        'Promotion pipeline crashed unexpectedly',
      );
    });

    return { id, events };
  }

  // ── Pipeline (internal) ──────────────────────────────────────

  private async runPipeline(
    id: string,
    source: string,
    tierConfigs: readonly TierConfig[],
    mutex: PromotionMutex,
    events: EventEmitter,
    startedAt: Date,
  ): Promise<void> {
    let release: (() => void) | null = null;

    try {
      // Update status to running
      await this.db
        .update(promotionHistory)
        .set({ status: 'running' })
        .where(eq(promotionHistory.id, id));

      // Acquire mutex
      events.emit('event', {
        type: 'step',
        step: 'mutex',
        message: 'Waiting for promotion lock...',
      });
      release = await mutex.acquire();
      events.emit('event', { type: 'step', step: 'mutex', message: 'Lock acquired' });

      // Run preflight checks, emitting events
      events.emit('event', {
        type: 'step',
        step: 'preflight',
        message: 'Running preflight checks...',
      });
      const preflight = await this.runPreflight(source, tierConfigs);

      for (const check of preflight.checks) {
        events.emit('event', {
          type: 'check',
          name: check.name,
          status: check.status,
          message: check.message,
        });
      }

      if (!preflight.passed) {
        const failedNames = preflight.checks
          .filter((c) => c.status === 'fail')
          .map((c) => c.name)
          .join(', ');
        const errorMsg = `Preflight failed: ${failedNames}`;
        await this.finalize(id, 'failed', startedAt, errorMsg, preflight.checks);
        events.emit('event', {
          type: 'complete',
          status: 'failed',
          durationMs: Date.now() - startedAt.getTime(),
          error: errorMsg,
          failedStep: 'preflight',
        });
        return;
      }

      // Build — skip if a recent .next/BUILD_ID exists
      const promBuildIdPath = join(this.repoRoot, 'packages', 'web', '.next', 'BUILD_ID');
      const buildFresh =
        existsSync(promBuildIdPath) &&
        Date.now() - statSync(promBuildIdPath).mtimeMs < 30 * 60 * 1000;

      if (buildFresh) {
        events.emit('event', {
          type: 'step',
          step: 'build',
          message: 'Build fresh — skipping rebuild',
        });
      } else {
        events.emit('event', { type: 'step', step: 'build', message: 'Running pnpm build...' });
      }
      const buildResult = buildFresh
        ? { ok: true, output: 'Skipped — recent build exists' }
        : await this.spawnWithLogs(
            'pnpm',
            [
              '--filter',
              '@agentctl/shared',
              '--filter',
              '@agentctl/control-plane',
              '--filter',
              '@agentctl/agent-worker',
              '--filter',
              '@agentctl/web',
              'build',
            ],
            events,
            BUILD_TIMEOUT_MS,
          );
      if (!buildResult.ok) {
        const errorMsg = 'Build step failed';
        await this.finalize(id, 'failed', startedAt, errorMsg, preflight.checks);
        events.emit('event', {
          type: 'complete',
          status: 'failed',
          durationMs: Date.now() - startedAt.getTime(),
          error: errorMsg,
          failedStep: 'build',
        });
        return;
      }

      // Drizzle migrate against beta
      events.emit('event', {
        type: 'step',
        step: 'migrate',
        message: 'Running drizzle migrate on beta...',
      });
      const betaTier = tierConfigs.find((c) => c.name === 'beta');
      if (betaTier) {
        const betaDbUrl =
          process.env.DATABASE_URL ??
          `postgresql://hahaschool@localhost:5433/${betaTier.database ?? 'agentctl'}`;
        const migrateResult = await this.spawnWithLogs(
          'pnpm',
          ['--filter', '@agentctl/control-plane', 'db:migrate'],
          events,
          60_000,
          { DATABASE_URL: betaDbUrl },
        );
        if (!migrateResult.ok) {
          const errorMsg = 'Migration step failed';
          await this.finalize(id, 'failed', startedAt, errorMsg, preflight.checks);
          events.emit('event', {
            type: 'complete',
            status: 'failed',
            durationMs: Date.now() - startedAt.getTime(),
            error: errorMsg,
            failedStep: 'migrate',
          });
          return;
        }
      }

      // Restart PM2 beta services
      events.emit('event', {
        type: 'step',
        step: 'restart',
        message: 'Restarting beta services via PM2...',
      });
      await pm2Restart('agentctl-beta-cp', this.logger);
      await pm2Restart('agentctl-beta-worker', this.logger);
      await pm2Restart('agentctl-beta-web', this.logger);
      events.emit('event', { type: 'log', line: 'PM2 restart commands sent' });

      // Poll beta health
      events.emit('event', {
        type: 'step',
        step: 'health-poll',
        message: 'Polling beta health...',
      });
      const healthy = betaTier ? await this.pollHealth(betaTier, events) : false;

      if (!healthy) {
        const errorMsg = 'Beta health check timed out after restart';
        await this.finalize(id, 'failed', startedAt, errorMsg, preflight.checks);
        events.emit('event', {
          type: 'complete',
          status: 'failed',
          durationMs: Date.now() - startedAt.getTime(),
          error: errorMsg,
          failedStep: 'health-poll',
        });
        return;
      }

      // Success
      await this.finalize(id, 'success', startedAt, undefined, preflight.checks);
      events.emit('event', {
        type: 'complete',
        status: 'success',
        durationMs: Date.now() - startedAt.getTime(),
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error({ promotionId: id, error: errorMsg }, 'Promotion pipeline error');

      try {
        await this.finalize(id, 'failed', startedAt, errorMsg, []);
      } catch {
        // Best effort DB update
      }

      events.emit('event', {
        type: 'complete',
        status: 'failed',
        durationMs: Date.now() - startedAt.getTime(),
        error: errorMsg,
      });
    } finally {
      release?.();
    }
  }

  // ── Internal helpers ─────────────────────────────────────────

  private async finalize(
    id: string,
    status: 'success' | 'failed',
    startedAt: Date,
    error: string | undefined,
    checks: readonly PreflightCheckResult[],
  ): Promise<void> {
    const now = new Date();
    await this.db
      .update(promotionHistory)
      .set({
        status,
        completedAt: now,
        durationMs: now.getTime() - startedAt.getTime(),
        error: error ?? null,
        checks: checks as PreflightCheckResult[],
      })
      .where(eq(promotionHistory.id, id));
  }

  private spawnWithLogs(
    command: string,
    args: readonly string[],
    events: EventEmitter,
    timeoutMs: number,
    envOverrides?: Record<string, string>,
  ): Promise<{ ok: boolean }> {
    return new Promise((resolve) => {
      const child = spawn(command, args as string[], {
        cwd: this.repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
        env: envOverrides ? { ...process.env, ...envOverrides } : undefined,
      });

      child.stdout?.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          events.emit('event', { type: 'log', line });
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          events.emit('event', { type: 'log', line });
        }
      });

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        events.emit('event', { type: 'log', line: `Process timed out after ${timeoutMs}ms` });
        resolve({ ok: false });
      }, timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ ok: code === 0 });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        events.emit('event', { type: 'log', line: `Spawn error: ${err.message}` });
        resolve({ ok: false });
      });
    });
  }

  private async pollHealth(tier: TierConfig, events: EventEmitter): Promise<boolean> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const cpOk = await fetchHealth(tier.cpPort);
      const workerOk = await fetchHealth(tier.workerPort);
      const webOk = await tcpCheck(tier.webPort);

      events.emit('event', {
        type: 'log',
        line: `Health poll: cp=${cpOk}, worker=${workerOk}, web=${webOk}`,
      });

      if (cpOk && workerOk && webOk) {
        return true;
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    return false;
  }
}
