// ---------------------------------------------------------------------------
// Terminal PTY management — spawns and manages pseudo-terminal processes for
// remote shell access. Each terminal is identified by a unique string ID and
// exposes a subscription-based event model for output/exit/error events.
//
// Uses node-pty for cross-platform PTY support. The dynamic import allows
// graceful handling when the native module is unavailable.
// ---------------------------------------------------------------------------

import { WorkerError } from '@agentctl/shared';
import type { Logger } from 'pino';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Metadata describing an active terminal session. */
export type TerminalInfo = {
  id: string;
  pid: number;
  command: string;
  cols: number;
  rows: number;
  createdAt: string;
};

/** Events emitted by a terminal session. */
export type TerminalEvent =
  | { type: 'output'; data: string }
  | { type: 'exit'; code: number }
  | { type: 'error'; message: string };

/** Internal record for a managed terminal. */
type TerminalEntry = {
  pty: {
    write: (data: string) => void;
    resize: (cols: number, rows: number) => void;
    kill: () => void;
    pid: number;
  };
  info: TerminalInfo;
  listeners: Set<(event: TerminalEvent) => void>;
};

// ---------------------------------------------------------------------------
// TerminalManager
// ---------------------------------------------------------------------------

export class TerminalManager {
  private terminals = new Map<string, TerminalEntry>();
  private logger: Logger;
  private maxTerminals: number;

  constructor(opts: { logger: Logger; maxTerminals?: number }) {
    this.logger = opts.logger;
    this.maxTerminals = opts.maxTerminals ?? 5;
  }

  /**
   * Spawn a new PTY terminal process.
   *
   * @throws WorkerError TERMINAL_LIMIT_REACHED when max terminals exceeded
   * @throws WorkerError TERMINAL_ALREADY_EXISTS when id is already in use
   * @throws WorkerError TERMINAL_SPAWN_FAILED when node-pty fails
   */
  async spawn(opts: {
    id: string;
    command?: string;
    args?: string[];
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: Record<string, string>;
  }): Promise<TerminalInfo> {
    if (this.terminals.size >= this.maxTerminals) {
      throw new WorkerError(
        'TERMINAL_LIMIT_REACHED',
        `Maximum terminal limit (${this.maxTerminals}) reached`,
        { maxTerminals: this.maxTerminals, current: this.terminals.size },
      );
    }

    if (this.terminals.has(opts.id)) {
      throw new WorkerError('TERMINAL_ALREADY_EXISTS', `Terminal ${opts.id} already exists`, {
        terminalId: opts.id,
      });
    }

    // Dynamic import to handle cases where node-pty isn't available
    let nodePty: typeof import('node-pty');
    try {
      nodePty = await import('node-pty');
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error({ error: detail }, 'node-pty import failed');
      throw new WorkerError(
        'TERMINAL_SPAWN_FAILED',
        `node-pty is not available on this machine: ${detail}`,
        { error: detail },
      );
    }

    const command = opts.command ?? process.env.SHELL ?? '/bin/zsh';
    const args = opts.args ?? [];
    const cols = opts.cols ?? 120;
    const rows = opts.rows ?? 30;

    // Build a clean environment for the PTY shell. Remove Claude Code's
    // nesting-detection variable so the user can launch `claude` from the terminal.
    const { CLAUDECODE: _, ...cleanEnv } = process.env;

    let pty: import('node-pty').IPty;
    try {
      pty = nodePty.spawn(command, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: opts.cwd ?? process.env.HOME ?? '/',
        env: { ...cleanEnv, ...opts.env, TERM: 'xterm-256color' } as Record<string, string>,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error({ command, error: detail }, 'Failed to spawn PTY process');
      throw new WorkerError('TERMINAL_SPAWN_FAILED', `Failed to spawn PTY process: ${detail}`, {
        command,
        error: detail,
      });
    }

    const info: TerminalInfo = {
      id: opts.id,
      pid: pty.pid,
      command,
      cols,
      rows,
      createdAt: new Date().toISOString(),
    };

    const listeners = new Set<(event: TerminalEvent) => void>();

    pty.onData((data) => {
      for (const listener of listeners) {
        listener({ type: 'output', data });
      }
    });

    pty.onExit(({ exitCode }) => {
      for (const listener of listeners) {
        listener({ type: 'exit', code: exitCode });
      }
      this.terminals.delete(opts.id);
      this.logger.info({ terminalId: opts.id, exitCode }, 'Terminal exited');
    });

    this.terminals.set(opts.id, { pty, info, listeners });
    this.logger.info({ terminalId: opts.id, command, pid: pty.pid }, 'Terminal spawned');

    return info;
  }

  /**
   * Write data (e.g. keystrokes) to a terminal's stdin.
   *
   * @throws WorkerError TERMINAL_NOT_FOUND when terminal does not exist
   */
  write(id: string, data: string): void {
    const terminal = this.terminals.get(id);
    if (!terminal) {
      throw new WorkerError('TERMINAL_NOT_FOUND', `Terminal ${id} not found`, { terminalId: id });
    }
    terminal.pty.write(data);
  }

  /**
   * Resize a terminal's dimensions.
   *
   * @throws WorkerError TERMINAL_NOT_FOUND when terminal does not exist
   */
  resize(id: string, cols: number, rows: number): void {
    const terminal = this.terminals.get(id);
    if (!terminal) {
      throw new WorkerError('TERMINAL_NOT_FOUND', `Terminal ${id} not found`, { terminalId: id });
    }
    terminal.pty.resize(cols, rows);
    terminal.info.cols = cols;
    terminal.info.rows = rows;
  }

  /**
   * Kill a terminal process and remove it from the manager.
   *
   * @throws WorkerError TERMINAL_NOT_FOUND when terminal does not exist
   */
  kill(id: string): void {
    const terminal = this.terminals.get(id);
    if (!terminal) {
      throw new WorkerError('TERMINAL_NOT_FOUND', `Terminal ${id} not found`, { terminalId: id });
    }
    terminal.pty.kill();
    this.terminals.delete(id);
    this.logger.info({ terminalId: id }, 'Terminal killed');
  }

  /**
   * Subscribe to events from a terminal. Returns an unsubscribe function.
   *
   * @throws WorkerError TERMINAL_NOT_FOUND when terminal does not exist
   */
  subscribe(id: string, listener: (event: TerminalEvent) => void): () => void {
    const terminal = this.terminals.get(id);
    if (!terminal) {
      throw new WorkerError('TERMINAL_NOT_FOUND', `Terminal ${id} not found`, { terminalId: id });
    }
    terminal.listeners.add(listener);
    return () => {
      terminal.listeners.delete(listener);
    };
  }

  /** List all active terminals. */
  list(): TerminalInfo[] {
    return Array.from(this.terminals.values()).map((t) => t.info);
  }

  /** Get info for a specific terminal. Returns undefined if not found. */
  get(id: string): TerminalInfo | undefined {
    return this.terminals.get(id)?.info;
  }

  /** Kill all active terminals. Used during graceful shutdown. */
  killAll(): void {
    for (const [id] of this.terminals) {
      try {
        this.kill(id);
      } catch {
        // Ignore errors during bulk cleanup
      }
    }
  }
}
