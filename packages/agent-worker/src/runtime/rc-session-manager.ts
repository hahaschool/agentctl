import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import type { ManualTakeoverPermissionMode } from '@agentctl/shared';
import { WorkerError } from '@agentctl/shared';
import type { Logger } from 'pino';

// ── Constants ────────────────────────────────────────────────────────

/** Regex to extract the session URL from `claude remote-control` stdout. */
const SESSION_URL_PATTERN = /https:\/\/claude\.ai\/code\/[^\s]+/;

/** How long to wait for the session URL to appear in stdout. */
const SESSION_URL_TIMEOUT_MS = 30_000;

/** Interval for health check heartbeats. */
const HEALTH_CHECK_INTERVAL_MS = 15_000;

// ── Types ────────────────────────────────────────────────────────────

export type RcSessionStatus = 'starting' | 'online' | 'reconnecting' | 'stopped' | 'error';

export type RcSession = {
  id: string;
  agentId: string;
  pid: number | null;
  sessionUrl: string | null;
  nativeSessionId: string | null;
  status: RcSessionStatus;
  permissionMode: ManualTakeoverPermissionMode;
  projectPath: string;
  startedAt: Date;
  lastHeartbeat: Date | null;
  error: string | null;
};

export type RcSessionManagerOptions = {
  logger: Logger;
  machineId: string;
  /** Path to the `claude` CLI binary. Defaults to 'claude' (found via PATH). */
  claudeBinary?: string;
};

export type StartSessionOptions = {
  agentId: string;
  projectPath: string;
  /** Resume an existing Claude Code session by ID. */
  resumeSessionId?: string;
  permissionMode?: ManualTakeoverPermissionMode;
  /** Additional CLI flags to pass to `claude remote-control`. */
  extraArgs?: string[];
};

export type RcSessionEvent = {
  type: 'session_online' | 'session_stopped' | 'session_error' | 'output';
  sessionId: string;
  data: Record<string, unknown>;
};

// ── RcSessionManager ─────────────────────────────────────────────────

/**
 * Manages Claude Code Remote Control sessions on a single machine.
 *
 * Instead of spawning Claude Code as an SDK subprocess, this manager starts
 * `claude remote-control` processes that register with the Anthropic relay.
 * The iOS app (or any browser) can then connect to these sessions via the
 * session URL.
 *
 * Responsibilities:
 *  - Start/stop RC sessions
 *  - Parse session URLs from CLI output
 *  - Monitor process health
 *  - Emit events for session lifecycle changes
 */
export class RcSessionManager extends EventEmitter {
  private readonly logger: Logger;
  private readonly machineId: string;
  private readonly claudeBinary: string;
  private readonly sessions = new Map<string, ManagedSession>();

  constructor(options: RcSessionManagerOptions) {
    super();
    this.logger = options.logger;
    this.machineId = options.machineId;
    this.claudeBinary = options.claudeBinary ?? 'claude';
  }

  /**
   * Start a new Remote Control session.
   *
   * Spawns `claude remote-control` (or `claude --resume <id>` with /rc)
   * and waits for the session URL to appear in stdout.
   */
  async startSession(options: StartSessionOptions): Promise<RcSession> {
    const sessionId = randomUUID();
    const { agentId, projectPath } = options;

    this.logger.info(
      { sessionId, agentId, projectPath, resumeSessionId: options.resumeSessionId },
      'Starting Remote Control session',
    );

    const args = this.buildCliArgs(options);

    const child = spawn(this.claudeBinary, args, {
      cwd: projectPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    const managed: ManagedSession = {
      id: sessionId,
      agentId,
      process: child,
      sessionUrl: null,
      nativeSessionId: options.resumeSessionId ?? null,
      status: 'starting',
      permissionMode: options.permissionMode ?? 'default',
      projectPath,
      startedAt: new Date(),
      lastHeartbeat: null,
      error: null,
      healthTimer: null,
      stdoutBuffer: '',
    };

    this.sessions.set(sessionId, managed);

    // Wire up process event handlers
    this.attachProcessHandlers(managed);

    // Wait for the session URL to appear
    try {
      await this.waitForSessionUrl(managed);
    } catch (err) {
      // Clean up on failure
      managed.status = 'error';
      managed.error = err instanceof Error ? err.message : String(err);
      this.emitSessionEvent(managed, 'session_error', { error: managed.error });
      child.kill('SIGTERM');
      throw err;
    }

    // Start health monitoring
    managed.healthTimer = setInterval(() => {
      this.checkHealth(managed);
    }, HEALTH_CHECK_INTERVAL_MS);

    managed.status = 'online';
    managed.lastHeartbeat = new Date();
    this.emitSessionEvent(managed, 'session_online', {
      hasSessionUrl: managed.sessionUrl !== null,
      nativeSessionId: managed.nativeSessionId,
      permissionMode: managed.permissionMode,
    });

    this.logger.info(
      {
        sessionId,
        agentId,
        nativeSessionId: managed.nativeSessionId,
        permissionMode: managed.permissionMode,
        hasSessionUrl: managed.sessionUrl !== null,
        pid: child.pid,
      },
      'Remote Control session is online',
    );

    return this.toRcSession(managed);
  }

  /**
   * Stop a Remote Control session.
   */
  async stopSession(sessionId: string, graceful = true): Promise<void> {
    const managed = this.sessions.get(sessionId);

    if (!managed) {
      throw new WorkerError('RC_SESSION_NOT_FOUND', `Session '${sessionId}' not found`, {
        sessionId,
      });
    }

    this.logger.info({ sessionId, graceful }, 'Stopping Remote Control session');

    if (managed.healthTimer) {
      clearInterval(managed.healthTimer);
      managed.healthTimer = null;
    }

    if (managed.process && !managed.process.killed) {
      if (graceful) {
        // Send /exit to stdin if the process is still alive
        managed.process.stdin?.write('/exit\n');

        // Give it a few seconds to shut down gracefully
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            if (managed.process && !managed.process.killed) {
              managed.process.kill('SIGTERM');
            }
            resolve();
          }, 5_000);

          managed.process?.on('exit', () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      } else {
        managed.process.kill('SIGKILL');
      }
    }

    managed.status = 'stopped';
    this.emitSessionEvent(managed, 'session_stopped', { reason: 'user' });
    this.sessions.delete(sessionId);
  }

  /**
   * List all active sessions.
   */
  listSessions(): RcSession[] {
    return [...this.sessions.values()].map((m) => this.toRcSession(m));
  }

  /**
   * Get a specific session.
   */
  getSession(sessionId: string): RcSession | null {
    const managed = this.sessions.get(sessionId);
    return managed ? this.toRcSession(managed) : null;
  }

  getSessionByNativeSessionId(nativeSessionId: string): RcSession | null {
    for (const managed of this.sessions.values()) {
      if (managed.nativeSessionId === nativeSessionId) {
        return this.toRcSession(managed);
      }
    }

    return null;
  }

  getSessionByProjectPath(projectPath: string): RcSession | null {
    for (const managed of this.sessions.values()) {
      if (managed.projectPath === projectPath) {
        return this.toRcSession(managed);
      }
    }

    return null;
  }

  /**
   * Stop all sessions (used during worker shutdown).
   */
  async stopAll(): Promise<void> {
    const ids = [...this.sessions.keys()];

    for (const id of ids) {
      try {
        await this.stopSession(id, false);
      } catch (err) {
        this.logger.warn({ sessionId: id, err }, 'Failed to stop session during shutdown');
      }
    }
  }

  // ── Private helpers ────────────────────────────────────────────────

  private buildCliArgs(options: StartSessionOptions): string[] {
    const { resumeSessionId, permissionMode, extraArgs } = options;
    const args = resumeSessionId
      ? ['--resume', resumeSessionId, '--remote-control']
      : ['remote-control'];

    if (permissionMode) {
      args.push('--permission-mode', permissionMode);
    }

    return [...args, ...(extraArgs ?? [])];
  }

  private attachProcessHandlers(managed: ManagedSession): void {
    const { process: child, id: sessionId } = managed;

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      managed.stdoutBuffer += text;

      // Log output at debug level
      for (const line of text.split('\n').filter(Boolean)) {
        this.logger.debug({ sessionId, line }, 'RC stdout');
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      for (const line of text.split('\n').filter(Boolean)) {
        this.logger.warn({ sessionId, line }, 'RC stderr');
      }
    });

    child.on('exit', (code, signal) => {
      this.logger.info({ sessionId, code, signal }, 'RC process exited');

      if (managed.status !== 'stopped') {
        managed.status = 'error';
        managed.error = `Process exited with code ${code ?? 'null'}, signal ${signal ?? 'null'}`;
        this.emitSessionEvent(managed, 'session_error', {
          code,
          signal,
          error: managed.error,
        });
      }

      if (managed.healthTimer) {
        clearInterval(managed.healthTimer);
        managed.healthTimer = null;
      }
    });

    child.on('error', (err: Error) => {
      this.logger.error({ sessionId, err: err.message }, 'RC process error');
      managed.status = 'error';
      managed.error = err.message;
      this.emitSessionEvent(managed, 'session_error', { error: err.message });
    });
  }

  /**
   * Wait for the session URL to appear in the process stdout.
   */
  private waitForSessionUrl(managed: ManagedSession): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const startTime = Date.now();

      const check = (): void => {
        // Look for the session URL in accumulated stdout
        const match = managed.stdoutBuffer.match(SESSION_URL_PATTERN);

        if (match) {
          managed.sessionUrl = match[0];
          resolve();
          return;
        }

        // Check if the process has exited
        if (managed.process.exitCode !== null) {
          reject(
            new WorkerError(
              'RC_PROCESS_EXITED',
              `Remote Control process exited before producing a session URL (exit code ${managed.process.exitCode})`,
              { sessionId: managed.id, exitCode: managed.process.exitCode },
            ),
          );
          return;
        }

        // Check timeout
        if (Date.now() - startTime > SESSION_URL_TIMEOUT_MS) {
          reject(
            new WorkerError(
              'RC_SESSION_URL_TIMEOUT',
              `Timed out waiting for session URL after ${SESSION_URL_TIMEOUT_MS}ms`,
              { sessionId: managed.id },
            ),
          );
          return;
        }

        // Poll again shortly
        setTimeout(check, 500);
      };

      check();
    });
  }

  private checkHealth(managed: ManagedSession): void {
    if (managed.process.killed || managed.process.exitCode !== null) {
      if (managed.status === 'online') {
        managed.status = 'error';
        managed.error = 'Process is no longer running';
        this.emitSessionEvent(managed, 'session_error', { error: managed.error });
        this.logger.warn({ sessionId: managed.id }, 'RC session process died');
      }
      return;
    }

    // Process is still alive — update heartbeat
    managed.lastHeartbeat = new Date();
  }

  private emitSessionEvent(
    managed: ManagedSession,
    type: RcSessionEvent['type'],
    data: Record<string, unknown>,
  ): void {
    const event: RcSessionEvent = {
      type,
      sessionId: managed.id,
      data: {
        ...data,
        agentId: managed.agentId,
        machineId: this.machineId,
      },
    };
    this.emit('session-event', event);
  }

  private toRcSession(managed: ManagedSession): RcSession {
    return {
      id: managed.id,
      agentId: managed.agentId,
      pid: managed.process.pid ?? null,
      sessionUrl: managed.sessionUrl,
      nativeSessionId: managed.nativeSessionId,
      status: managed.status,
      permissionMode: managed.permissionMode,
      projectPath: managed.projectPath,
      startedAt: managed.startedAt,
      lastHeartbeat: managed.lastHeartbeat,
      error: managed.error,
    };
  }
}

// ── Internal state ───────────────────────────────────────────────────

type ManagedSession = {
  id: string;
  agentId: string;
  process: ChildProcess;
  sessionUrl: string | null;
  nativeSessionId: string | null;
  status: RcSessionStatus;
  permissionMode: ManualTakeoverPermissionMode;
  projectPath: string;
  startedAt: Date;
  lastHeartbeat: Date | null;
  error: string | null;
  healthTimer: ReturnType<typeof setInterval> | null;
  stdoutBuffer: string;
};
