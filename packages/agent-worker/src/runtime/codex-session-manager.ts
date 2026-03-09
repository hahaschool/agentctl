import { type ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

export type CodexSessionStatus = 'starting' | 'running' | 'paused' | 'ended' | 'error';

export type CodexSession = {
  runtime: 'codex';
  id: string;
  nativeSessionId: string | null;
  agentId: string;
  projectPath: string;
  status: CodexSessionStatus;
  model: string;
  pid: number | null;
  startedAt: Date;
  lastActivity: Date;
  isResumed: boolean;
  lastError: string | null;
};

export type StartCodexSessionOptions = {
  agentId: string;
  projectPath: string;
  prompt: string;
  model?: string | null;
};

export type ResumeCodexSessionOptions = StartCodexSessionOptions & {
  nativeSessionId: string;
};

export type ForkCodexSessionOptions = {
  agentId: string;
  projectPath: string;
  nativeSessionId: string;
  prompt?: string | null;
  model?: string | null;
};

export type CodexSessionManagerOptions = {
  codexPath?: string;
  startupTimeoutMs?: number;
};

type ManagedCodexSession = CodexSession & {
  process: ChildProcess;
  lineBuffer: string;
  startupResolve: (() => void) | null;
  startupReject: ((error: Error) => void) | null;
  startupTimer: ReturnType<typeof setTimeout> | null;
};

const DEFAULT_CODEX_PATH = process.env.CODEX_BIN_PATH ?? 'codex';
const DEFAULT_MODEL = 'gpt-5-codex';
const DEFAULT_STARTUP_TIMEOUT_MS = 250;

export class CodexSessionManager extends EventEmitter {
  private readonly codexPath: string;
  private readonly startupTimeoutMs: number;
  private readonly sessions = new Map<string, ManagedCodexSession>();
  private sessionCounter = 0;

  constructor(options: CodexSessionManagerOptions = {}) {
    super();
    this.codexPath = options.codexPath ?? DEFAULT_CODEX_PATH;
    this.startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  }

  async startSession(options: StartCodexSessionOptions): Promise<CodexSession> {
    return this.spawnSession(
      {
        agentId: options.agentId,
        projectPath: options.projectPath,
        model: options.model ?? DEFAULT_MODEL,
        isResumed: false,
      },
      ['exec', '--json', ...(options.model ? ['-m', options.model] : []), options.prompt],
    );
  }

  async resumeSession(options: ResumeCodexSessionOptions): Promise<CodexSession> {
    return this.spawnSession(
      {
        agentId: options.agentId,
        projectPath: options.projectPath,
        model: options.model ?? DEFAULT_MODEL,
        isResumed: true,
        nativeSessionId: options.nativeSessionId,
      },
      [
        'exec',
        'resume',
        options.nativeSessionId,
        options.prompt,
        '--json',
        ...(options.model ? ['-m', options.model] : []),
      ],
    );
  }

  async forkSession(options: ForkCodexSessionOptions): Promise<CodexSession> {
    return this.spawnSession(
      {
        agentId: options.agentId,
        projectPath: options.projectPath,
        model: options.model ?? DEFAULT_MODEL,
        isResumed: false,
      },
      [
        'fork',
        options.nativeSessionId,
        ...(options.prompt ? [options.prompt] : []),
        ...(options.model ? ['-m', options.model] : []),
        '--no-alt-screen',
      ],
    );
  }

  listSessions(): CodexSession[] {
    return [...this.sessions.values()].map(toSession);
  }

  getSession(sessionId: string): CodexSession | null {
    const session = this.sessions.get(sessionId);
    return session ? toSession(session) : null;
  }

  async stopAll(): Promise<void> {
    for (const session of this.sessions.values()) {
      session.process.kill('SIGTERM');
    }
    this.sessions.clear();
  }

  private async spawnSession(
    meta: {
      agentId: string;
      projectPath: string;
      model: string;
      isResumed: boolean;
      nativeSessionId?: string;
    },
    args: string[],
  ): Promise<CodexSession> {
    this.sessionCounter += 1;
    const id = `codex-${Date.now()}-${this.sessionCounter}`;
    const child = spawn(this.codexPath, args, {
      cwd: meta.projectPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    const managed: ManagedCodexSession = {
      runtime: 'codex',
      id,
      nativeSessionId: meta.nativeSessionId ?? null,
      agentId: meta.agentId,
      projectPath: meta.projectPath,
      status: 'running',
      model: meta.model,
      pid: child.pid ?? null,
      startedAt: new Date(),
      lastActivity: new Date(),
      isResumed: meta.isResumed,
      lastError: null,
      process: child,
      lineBuffer: '',
      startupResolve: null,
      startupReject: null,
      startupTimer: null,
    };

    this.sessions.set(id, managed);
    this.attachProcessHandlers(managed);

    await new Promise<void>((resolve, reject) => {
      managed.startupResolve = resolve;
      managed.startupReject = reject;
      managed.startupTimer = setTimeout(() => {
        managed.startupResolve = null;
        managed.startupReject = null;
        resolve();
      }, this.startupTimeoutMs);
    });

    return toSession(managed);
  }

  private attachProcessHandlers(session: ManagedCodexSession): void {
    session.process.stdout?.on('data', (chunk: Buffer) => {
      session.lineBuffer += chunk.toString();
      session.lastActivity = new Date();
      const lines = session.lineBuffer.split('\n');
      session.lineBuffer = lines.pop() ?? '';

      for (const raw of lines) {
        this.handleStdoutLine(session, raw);
      }
    });

    session.process.stderr?.on('data', (chunk: Buffer) => {
      session.lastError = `${session.lastError ?? ''}${chunk.toString()}`.slice(-2048);
      session.lastActivity = new Date();
    });

    session.process.on('close', (code) => {
      if (session.startupTimer) {
        clearTimeout(session.startupTimer);
        session.startupTimer = null;
      }
      if (code && code !== 0) {
        session.status = 'error';
        session.startupReject?.(
          new Error(session.lastError ?? `Codex exited before startup completed (code ${String(code)})`),
        );
      } else {
        session.status = 'ended';
        session.startupResolve?.();
      }
      session.startupResolve = null;
      session.startupReject = null;
    });
  }

  private handleStdoutLine(session: ManagedCodexSession, raw: string): void {
    const line = raw.trim();
    if (!line) {
      return;
    }

    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const sessionId =
        pickString(parsed.session_id) ??
        pickString(parsed.sessionId) ??
        pickString(parsed.conversation_id) ??
        pickString(parsed.id);

      if (sessionId && !session.nativeSessionId) {
        session.nativeSessionId = sessionId;
        if (session.startupTimer) {
          clearTimeout(session.startupTimer);
          session.startupTimer = null;
        }
        session.startupResolve?.();
        session.startupResolve = null;
        session.startupReject = null;
      }
    } catch {
      // Ignore non-JSON lines; Codex may print inline progress.
    }
  }
}

function pickString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function toSession(session: ManagedCodexSession): CodexSession {
  return {
    runtime: session.runtime,
    id: session.id,
    nativeSessionId: session.nativeSessionId,
    agentId: session.agentId,
    projectPath: session.projectPath,
    status: session.status,
    model: session.model,
    pid: session.pid,
    startedAt: session.startedAt,
    lastActivity: session.lastActivity,
    isResumed: session.isResumed,
    lastError: session.lastError,
  };
}
