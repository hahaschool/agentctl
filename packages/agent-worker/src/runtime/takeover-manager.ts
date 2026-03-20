// ---------------------------------------------------------------------------
// TakeoverManager — manages terminal takeover sessions for interactive resume
// handoff. When a user wants to "take over" a managed CLI session, this service
// stops the managed process and spawns an interactive PTY via TerminalManager.
//
// Key features:
//   - Per-session mutex prevents concurrent takeover/release operations
//   - Random terminal IDs + takeover tokens for security
//   - Auto-cleanup on PTY exit
//   - Best-effort status reporting to control plane
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';

import { WorkerError } from '@agentctl/shared';
import type { Logger } from 'pino';

import type { TerminalManager } from './terminal-manager.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TakeoverState = {
  readonly sessionId: string;
  readonly claudeSessionId: string;
  readonly terminalId: string;
  readonly takeoverToken: string;
  readonly projectPath: string;
  readonly startedAt: Date;
};

export type TakeoverResult = {
  readonly terminalId: string;
  readonly takeoverToken: string;
};

export type InitiateTakeoverOptions = {
  readonly sessionId: string;
  readonly claudeSessionId: string;
  readonly projectPath: string;
  readonly controlPlaneUrl?: string;
};

export type TakeoverManagerOptions = {
  readonly logger: Logger;
  readonly terminalManager: TerminalManager;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Timeout for reporting takeover status to the control plane. */
const CP_REPORT_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// TakeoverManager
// ---------------------------------------------------------------------------

export class TakeoverManager {
  private readonly logger: Logger;
  private readonly terminalManager: TerminalManager;

  /** Active takeover states keyed by session ID. */
  private readonly takeovers = new Map<string, TakeoverState>();

  /**
   * Per-session mutex implemented as a promise chain. Each session's
   * operations are serialised by chaining onto the previous promise.
   */
  private readonly sessionMutex = new Map<string, Promise<void>>();

  constructor(opts: TakeoverManagerOptions) {
    this.logger = opts.logger;
    this.terminalManager = opts.terminalManager;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Initiate a terminal takeover for a session.
   *
   * NOTE: The caller (route handler) is responsible for stopping the managed
   * CLI process BEFORE calling this method. This method only spawns the
   * interactive PTY.
   *
   * @throws WorkerError TAKEOVER_ALREADY_ACTIVE if session is already under takeover
   * @throws WorkerError TAKEOVER_SPAWN_FAILED if PTY spawn fails
   */
  async initiateTakeover(opts: InitiateTakeoverOptions): Promise<TakeoverResult> {
    return this.withMutex(opts.sessionId, async () => {
      const { sessionId, claudeSessionId, projectPath, controlPlaneUrl } = opts;

      // Validate not already under takeover
      if (this.takeovers.has(sessionId)) {
        throw new WorkerError(
          'TAKEOVER_ALREADY_ACTIVE',
          `Session '${sessionId}' is already under takeover`,
          { sessionId },
        );
      }

      // Generate random identifiers
      const terminalId = randomUUID();
      const takeoverToken = randomUUID();

      // Spawn interactive PTY: `claude --resume <claudeSessionId>`
      try {
        await this.terminalManager.spawn({
          id: terminalId,
          command: 'claude',
          args: ['--resume', claudeSessionId],
          cwd: projectPath,
        });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        this.logger.error(
          { sessionId, claudeSessionId, terminalId, error: detail },
          'Failed to spawn takeover PTY',
        );
        throw new WorkerError(
          'TAKEOVER_SPAWN_FAILED',
          `Failed to spawn takeover terminal: ${detail}`,
          { sessionId, claudeSessionId, error: detail },
        );
      }

      // Store takeover state (immutable object)
      const state: TakeoverState = {
        sessionId,
        claudeSessionId,
        terminalId,
        takeoverToken,
        projectPath,
        startedAt: new Date(),
      };
      this.takeovers.set(sessionId, state);

      // Subscribe to PTY exit for auto-cleanup
      try {
        this.terminalManager.subscribe(terminalId, (event) => {
          if (event.type === 'exit') {
            this.logger.info(
              { sessionId, terminalId, exitCode: event.code },
              'Takeover PTY exited — cleaning up',
            );
            this.takeovers.delete(sessionId);
            this.reportTakeoverStatusToCP(sessionId, false, controlPlaneUrl);
          }
        });
      } catch {
        // Terminal may have already exited between spawn and subscribe — clean up
        this.takeovers.delete(sessionId);
        throw new WorkerError(
          'TAKEOVER_SPAWN_FAILED',
          'Takeover terminal exited immediately after spawn',
          { sessionId, terminalId },
        );
      }

      // Report to control plane (best-effort)
      this.reportTakeoverStatusToCP(sessionId, true, controlPlaneUrl);

      this.logger.info({ sessionId, claudeSessionId, terminalId }, 'Terminal takeover initiated');

      return { terminalId, takeoverToken };
    });
  }

  /**
   * Release a terminal takeover, killing the PTY process.
   *
   * @throws WorkerError TAKEOVER_NOT_FOUND if session is not under takeover
   */
  async release(
    sessionId: string,
    opts?: { resume?: boolean; controlPlaneUrl?: string },
  ): Promise<void> {
    return this.withMutex(sessionId, async () => {
      const state = this.takeovers.get(sessionId);
      if (!state) {
        throw new WorkerError(
          'TAKEOVER_NOT_FOUND',
          `Session '${sessionId}' is not under takeover`,
          { sessionId },
        );
      }

      // Kill the PTY process
      try {
        this.terminalManager.kill(state.terminalId);
      } catch (err) {
        // Terminal may have already exited — log and continue cleanup
        this.logger.warn(
          {
            sessionId,
            terminalId: state.terminalId,
            error: err instanceof Error ? err.message : String(err),
          },
          'Terminal already exited during takeover release',
        );
      }

      // Remove state
      this.takeovers.delete(sessionId);

      // Report to control plane (best-effort)
      this.reportTakeoverStatusToCP(sessionId, false, opts?.controlPlaneUrl);

      this.logger.info(
        { sessionId, terminalId: state.terminalId, resume: opts?.resume ?? false },
        'Terminal takeover released',
      );
    });
  }

  /**
   * Get the current takeover state for a session, or null if not under takeover.
   */
  getTakeoverState(sessionId: string): TakeoverState | null {
    return this.takeovers.get(sessionId) ?? null;
  }

  /**
   * Check if a session is currently under terminal takeover.
   */
  isUnderTakeover(sessionId: string): boolean {
    return this.takeovers.has(sessionId);
  }

  /**
   * Release all active takeovers. Used during graceful shutdown.
   */
  async releaseAll(): Promise<void> {
    const sessionIds = [...this.takeovers.keys()];
    for (const sessionId of sessionIds) {
      try {
        await this.release(sessionId);
      } catch {
        // Ignore errors during bulk cleanup
      }
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Execute an operation under a per-session mutex. Operations on the same
   * session are serialised; operations on different sessions run concurrently.
   */
  private async withMutex<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    // Chain onto the existing promise for this session (or resolve immediately)
    const prev = this.sessionMutex.get(sessionId) ?? Promise.resolve();

    // Use a deferred pattern that avoids non-null assertions
    let resolveMutex: () => void = () => {};
    const next = new Promise<void>((r) => {
      resolveMutex = r;
    });
    this.sessionMutex.set(sessionId, next);

    try {
      await prev;
      return await fn();
    } finally {
      // Clean up mutex entry if this was the last operation
      if (this.sessionMutex.get(sessionId) === next) {
        this.sessionMutex.delete(sessionId);
      }
      resolveMutex();
    }
  }

  /**
   * Report takeover status to the control plane. Best-effort — failures are
   * logged but do not affect local operation.
   */
  private reportTakeoverStatusToCP(
    sessionId: string,
    active: boolean,
    controlPlaneUrl?: string,
  ): void {
    if (!controlPlaneUrl) {
      return;
    }

    const url = `${controlPlaneUrl}/api/sessions/${encodeURIComponent(sessionId)}/status`;
    const body = JSON.stringify({
      metadata: {
        takeoverStatus: active
          ? { active: true, startedAt: new Date().toISOString() }
          : { active: false },
      },
    });

    fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(CP_REPORT_TIMEOUT_MS),
    }).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        { sessionId, active, error: message },
        'Failed to report takeover status to control plane',
      );
    });
  }
}
