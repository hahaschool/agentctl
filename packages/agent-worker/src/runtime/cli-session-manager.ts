// ---------------------------------------------------------------------------
// CliSessionManager — manages Claude Code sessions via the CLI `-p` flag.
//
// This is the primary session control mechanism for Team plan machines.
// Unlike the Remote Control feature (which requires Max plan), the CLI
// `-p` mode uses whatever auth is configured on the local machine.
//
// Architecture:
//   - `claude -p "prompt" --output-format stream-json` → starts a new session
//   - `claude -p "prompt" --resume <id> --output-format stream-json` → resumes
//   - Output is streamed as newline-delimited JSON to stdout
//   - Each JSON message is mapped to an AgentEvent for the control plane
// ---------------------------------------------------------------------------

import { type ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { normalize, join as pathJoin, resolve as resolvePath } from 'node:path';
import type { AgentConfig, AgentEvent } from '@agentctl/shared';
import { AgentError } from '@agentctl/shared';
import {
  DEFAULT_DENIED_PATH_SEGMENTS,
  findDeniedPathSegment,
  safeWriteFileSync,
  sanitizePath,
} from '../utils/path-security.js';

import {
  type DiscoveredSession,
  discoverLocalSessions as discoverLocalSessionsImpl,
} from './session-discovery.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CliSessionStatus = 'starting' | 'running' | 'paused' | 'ended' | 'error';

export type CliSession = {
  /** Internal ID assigned by the manager. */
  id: string;
  /** Claude Code session ID (captured from CLI output). */
  claudeSessionId: string | null;
  /** Machine-level agent ID owning this session. */
  agentId: string;
  /** Project path the session is running in. */
  projectPath: string;
  /** Current status. */
  status: CliSessionStatus;
  /** Model used for this session. */
  model: string;
  /** PID of the spawned CLI process. */
  pid: number | null;
  /** Accumulated cost in USD. */
  costUsd: number;
  /** Number of messages sent to this session. */
  messageCount: number;
  /** When the session was first started. */
  startedAt: Date;
  /** Last activity timestamp. */
  lastActivity: Date;
  /** Whether this session was resumed from a previous one. */
  isResumed: boolean;
  /** Last stderr output captured from the CLI process (truncated). */
  lastError: string | null;
};

export type { DiscoveredSession } from './session-discovery.js';

export type StartCliSessionOptions = {
  /** Agent ID owning this session. */
  agentId: string;
  /** Project directory for the session. */
  projectPath: string;
  /** Initial prompt (required for `-p` mode). */
  prompt: string;
  /** Model to use (default: 'sonnet'). */
  model?: string;
  /** Agent config for tools and permissions. */
  config?: AgentConfig;
  /** Resume a previous session instead of starting fresh. */
  resumeSessionId?: string;
  /** Extra CLI arguments. */
  extraArgs?: string[];
  /** Path to the Claude CLI binary (default: 'claude'). */
  claudePath?: string;
  /** Decrypted credential for the resolved account. */
  accountCredential?: string | null;
  /** Provider type for credential injection (e.g. 'anthropic_api', 'claude_max'). */
  accountProvider?: string | null;
};

export type CliSessionManagerOptions = {
  /** Path to the Claude CLI binary (default: 'claude'). */
  claudePath?: string;
  /** Maximum number of concurrent sessions (default: 10). */
  maxConcurrentSessions?: number;
  /** Optional logger for diagnostics (e.g. pino instance). */
  logger?: {
    debug: (obj: Record<string, unknown>, msg: string) => void;
    warn: (obj: Record<string, unknown>, msg: string) => void;
  };
};

export type CliSessionEvent =
  | { type: 'session_started'; sessionId: string; claudeSessionId: string | null }
  | { type: 'session_output'; sessionId: string; event: AgentEvent }
  | { type: 'session_ended'; sessionId: string; exitCode: number | null }
  | { type: 'session_error'; sessionId: string; error: string };

// ---------------------------------------------------------------------------
// Streaming JSON message types from `claude -p --output-format stream-json`
// ---------------------------------------------------------------------------

/**
 * Typed shape for streaming JSON messages from `claude -p --output-format stream-json`.
 *
 * All known properties are declared as optional so we can access them without
 * `as` type assertions. The `type` field is the discriminant used in the
 * `handleStreamMessage` switch statement.
 */
type CliStreamMessage = {
  type: string;
  session_id?: string;
  content?: unknown;
  name?: string;
  input?: unknown;
  result?: string;
  total_cost_usd?: number;
  cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
  tool?: string;
  timeout_seconds?: number;
};

/** Type guard: check if a parsed JSON value is a valid CliStreamMessage. */
function isCliStreamMessage(value: unknown): value is CliStreamMessage {
  return isNonNullObject(value) && typeof value.type === 'string';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CLAUDE_PATH = process.env.CLAUDE_BIN_PATH ?? 'claude';
const DEFAULT_MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_SESSIONS) || 10;
const DEFAULT_MODEL = 'sonnet';
const STALE_SESSION_THRESHOLD_MS = Number(process.env.STALE_SESSION_THRESHOLD_MS) || 5 * 60 * 1000; // 5 minutes
const CLEANUP_INTERVAL_MS = 60_000; // 60 seconds
const GRACEFUL_KILL_TIMEOUT_MS = 5_000; // Wait 5s after SIGTERM before SIGKILL
const STARTUP_WATCHDOG_MS = Number(process.env.STARTUP_WATCHDOG_MS) || 30_000; // Warn if no output within 30s of start
const MAX_STDOUT_LINE_BUFFER_CHARS = 64 * 1024;

// ---------------------------------------------------------------------------
// CliSessionManager
// ---------------------------------------------------------------------------

export class CliSessionManager extends EventEmitter {
  private readonly claudePath: string;
  private readonly maxConcurrentSessions: number;
  private readonly sessions: Map<string, CliSession> = new Map();
  private readonly processes: Map<string, ChildProcess> = new Map();
  private readonly lineBuffers: Map<string, string> = new Map();
  private readonly logger?: {
    debug: (obj: Record<string, unknown>, msg: string) => void;
    warn: (obj: Record<string, unknown>, msg: string) => void;
  };
  private sessionCounter = 0;
  private readonly cleanupTimer: ReturnType<typeof setInterval>;

  constructor(options?: CliSessionManagerOptions) {
    super();
    this.claudePath = options?.claudePath ?? DEFAULT_CLAUDE_PATH;
    this.maxConcurrentSessions = options?.maxConcurrentSessions ?? DEFAULT_MAX_CONCURRENT;
    this.logger = options?.logger;

    // Periodically clean up stale sessions to prevent memory leaks
    this.cleanupTimer = setInterval(() => {
      this.cleanupStaleSessions();
    }, CLEANUP_INTERVAL_MS);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Start a new CLI session or resume an existing one.
   *
   * Spawns `claude -p "prompt" --output-format stream-json` as a subprocess.
   * When `resumeSessionId` is provided, adds `--resume <id>` to continue
   * a previous conversation.
   */
  startSession(options: StartCliSessionOptions): CliSession {
    // Only count actively running sessions toward the concurrent limit —
    // errored/completed sessions should not block new ones.
    const activeSessions = [...this.sessions.values()].filter(
      (s) => s.status === 'running' || s.status === 'starting',
    ).length;

    if (activeSessions >= this.maxConcurrentSessions) {
      throw new AgentError(
        'MAX_SESSIONS_EXCEEDED',
        `Maximum concurrent sessions (${this.maxConcurrentSessions}) exceeded`,
        { current: activeSessions, max: this.maxConcurrentSessions },
      );
    }

    // Clean up old finished sessions to prevent memory leaks
    this.cleanupStaleSessions();

    const sanitizedCwd = resolvePath(normalize(options.projectPath));
    // Security: ensure the resolved path is absolute and doesn't contain
    // traversal components after normalization (js/path-injection).
    if (!sanitizedCwd.startsWith('/')) {
      throw new AgentError('INVALID_PATH', 'Project path must resolve to an absolute path', {
        projectPath: sanitizedCwd,
      });
    }
    const deniedSegment = findDeniedPathSegment(sanitizedCwd, DEFAULT_DENIED_PATH_SEGMENTS);
    if (deniedSegment) {
      throw new AgentError(
        'INVALID_PATH',
        `Project path contains denied segment "${deniedSegment}"`,
        {
          projectPath: sanitizedCwd,
        },
      );
    }

    this.sessionCounter++;
    const id = `cli-${Date.now()}-${this.sessionCounter}`;
    const model = options.model ?? DEFAULT_MODEL;
    const isResumed = !!options.resumeSessionId;

    const session: CliSession = {
      id,
      claudeSessionId: options.resumeSessionId ?? null,
      agentId: options.agentId,
      projectPath: sanitizedCwd,
      status: 'starting',
      model,
      pid: null,
      costUsd: 0,
      messageCount: 0,
      startedAt: new Date(),
      lastActivity: new Date(),
      isResumed,
      lastError: null,
    };

    this.sessions.set(id, session);

    // Build CLI arguments
    const args = this.buildCliArgs(options, model, sanitizedCwd);

    // Build child environment with credential injection
    const childEnv = buildChildEnv(options.accountProvider, options.accountCredential);

    // Write .mcp.json before spawning if MCP servers are configured via AgentCTL.
    // Claude Code reads this file at startup to discover available MCP servers.
    const mcpConfigPath = pathJoin(sanitizedCwd, '.mcp.json');
    if (options.config?.mcpServers && Object.keys(options.config.mcpServers).length > 0) {
      const safeMcpPath = sanitizePath(mcpConfigPath, sanitizedCwd);
      const mcpPayload = { mcpServers: options.config.mcpServers };
      safeWriteFileSync(safeMcpPath, sanitizedCwd, JSON.stringify(mcpPayload, null, 2));
      this.logger?.debug(
        {
          sessionId: id,
          mcpConfigPath: safeMcpPath,
          serverCount: Object.keys(options.config.mcpServers).length,
        },
        'Wrote .mcp.json for session',
      );
    }

    // Explicitly pass --mcp-config if .mcp.json exists in project dir.
    // Claude CLI in -p mode may not auto-discover project .mcp.json;
    // passing it explicitly ensures MCP servers are loaded.
    if (existsSync(mcpConfigPath)) {
      args.push('--mcp-config', mcpConfigPath);
      this.logger?.debug(
        { sessionId: id, mcpConfigPath },
        'Passing --mcp-config to CLI for project MCP servers',
      );
    }

    // Spawn the CLI process.
    // stdin is set to 'ignore' — the CLI in `-p` mode doesn't read from stdin,
    // and keeping stdin open can cause the process to hang waiting for EOF.
    const child = spawn(options.claudePath ?? this.claudePath, args, {
      cwd: sanitizedCwd,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    session.pid = child.pid ?? null;
    session.status = 'running';

    this.processes.set(id, child);
    this.lineBuffers.set(id, '');

    // Wire up stdout for stream-json parsing
    child.stdout?.on('data', (chunk: Buffer) => {
      this.handleStdoutData(id, chunk);
    });

    // Wire up stderr for error tracking — also store on session for diagnostics
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      const s = this.sessions.get(id);
      if (s) {
        // Keep last 2KB of stderr for error reporting
        s.lastError = ((s.lastError ?? '') + text).slice(-2048);
      }
      if (text.includes('Error') || text.includes('error')) {
        this.emitSessionEvent({
          type: 'session_error',
          sessionId: id,
          error: text.trim(),
        });
      }
    });

    // Handle process exit
    child.on('close', (code) => {
      this.handleProcessExit(id, code);
    });

    child.on('error', (err) => {
      const s = this.sessions.get(id);
      if (s) {
        s.status = 'error';
        s.lastActivity = new Date();
      }

      this.emitSessionEvent({
        type: 'session_error',
        sessionId: id,
        error: err.message,
      });
    });

    this.emitSessionEvent({
      type: 'session_started',
      sessionId: id,
      claudeSessionId: session.claudeSessionId,
    });

    // Emit the user's prompt as an SSE event so it appears immediately in the
    // UI, before Claude Code writes it to the JSONL file on disk.
    // Increment messageCount to track each user message sent to the session.
    session.messageCount++;
    this.emitSessionEvent({
      type: 'session_output',
      sessionId: id,
      event: {
        event: 'user_message',
        data: { text: options.prompt },
      },
    });

    // Startup watchdog — warn if the CLI process produces no output within STARTUP_WATCHDOG_MS.
    // This catches cases like missing credentials, rate limits, or auth prompts that cause
    // the CLI to hang silently.
    const watchdogTimer = setTimeout(() => {
      const s = this.sessions.get(id);
      if (s && s.status === 'running' && s.messageCount === 0) {
        const hint = s.lastError
          ? `CLI stderr: ${s.lastError.slice(0, 200)}`
          : 'No stderr output captured — possible auth issue or rate limit';
        this.logger?.warn(
          { sessionId: id, pid: s.pid, lastError: s.lastError },
          `Startup watchdog: session produced no output after ${STARTUP_WATCHDOG_MS / 1000}s — ${hint}`,
        );
      }
    }, STARTUP_WATCHDOG_MS);

    // Clear watchdog when process exits or produces first output
    const clearWatchdog = (): void => {
      clearTimeout(watchdogTimer);
    };
    child.on('close', clearWatchdog);
    // Also clear on first stdout data (session is working)
    child.stdout?.once('data', clearWatchdog);

    return session;
  }

  /**
   * Send a follow-up message to a paused/ended session by spawning a new
   * `claude -p` process with `--resume <sessionId>`.
   *
   * This effectively creates a new CLI process that continues the conversation.
   * Returns a new CliSession representing the continued interaction.
   */
  resumeSession(
    claudeSessionId: string,
    options: Omit<StartCliSessionOptions, 'resumeSessionId'>,
  ): CliSession {
    return this.startSession({
      ...options,
      resumeSessionId: claudeSessionId,
    });
  }

  /**
   * Stop a running session by killing its CLI process.
   *
   * Cleanup is deferred to the 'close' event handler (handleProcessExit) to ensure
   * all stream handlers have a chance to complete. However, if the process doesn't
   * exit within the timeout, we force cleanup here.
   */
  async stopSession(sessionId: string, graceful = true): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new AgentError('SESSION_NOT_FOUND', `Session ${sessionId} not found`, { sessionId });
    }

    const child = this.processes.get(sessionId);
    if (!child) {
      session.status = 'ended';
      return;
    }

    if (graceful) {
      // Send SIGTERM first, then SIGKILL after timeout
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (child.exitCode === null) {
            child.kill('SIGKILL');
          }
          // Force cleanup after timeout to prevent zombie processes
          this.processes.delete(sessionId);
          this.lineBuffers.delete(sessionId);
          resolve();
        }, GRACEFUL_KILL_TIMEOUT_MS);

        child.on('close', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    } else {
      child.kill('SIGKILL');
      // Force cleanup immediately for non-graceful kills
      this.processes.delete(sessionId);
      this.lineBuffers.delete(sessionId);
    }
  }

  /**
   * Get a session by its manager-assigned ID.
   */
  getSession(sessionId: string): CliSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  /**
   * Find a session by its Claude Code session ID.
   */
  getSessionByClaudeId(claudeSessionId: string): CliSession | null {
    for (const session of this.sessions.values()) {
      if (session.claudeSessionId === claudeSessionId) {
        return session;
      }
    }
    return null;
  }

  /**
   * List all managed sessions.
   */
  listSessions(): CliSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Return the count of currently active (running or starting) sessions.
   */
  getActiveSessionCount(): number {
    return [...this.sessions.values()].filter(
      (s) => s.status === 'running' || s.status === 'starting',
    ).length;
  }

  /**
   * Return the configured maximum number of concurrent sessions.
   */
  getMaxConcurrentSessions(): number {
    return this.maxConcurrentSessions;
  }

  /**
   * List sessions filtered by status.
   */
  listSessionsByStatus(status: CliSessionStatus): CliSession[] {
    return Array.from(this.sessions.values()).filter((s) => s.status === status);
  }

  /**
   * Stop all running sessions.
   */
  async stopAll(): Promise<void> {
    const runningSessions = this.listSessionsByStatus('running');
    await Promise.all(runningSessions.map((s) => this.stopSession(s.id, false)));
  }

  /**
   * Remove stale sessions from the in-memory map.
   *
   * - Sessions in `'error'` or `'ended'` status are removed immediately.
   * - Sessions in `'paused'` status are removed if their last activity was
   *   more than 5 minutes ago (they can still be resumed via Claude session
   *   ID even after eviction from this map).
   *
   * @returns The number of sessions that were cleaned up.
   */
  cleanupStaleSessions(): number {
    let cleaned = 0;
    const now = Date.now();
    for (const [sid, s] of this.sessions) {
      if (s.status === 'error' || s.status === 'ended') {
        this.sessions.delete(sid);
        cleaned++;
      } else if (
        s.status === 'paused' &&
        now - s.lastActivity.getTime() > STALE_SESSION_THRESHOLD_MS
      ) {
        this.sessions.delete(sid);
        cleaned++;
      }
    }
    return cleaned;
  }

  /**
   * Tear down the manager — clears the periodic cleanup timer.
   * Call this on process shutdown to avoid leaked intervals.
   */
  destroy(): void {
    clearInterval(this.cleanupTimer);
  }

  /**
   * Discover existing Claude Code sessions from the local filesystem.
   * Delegates to the session-discovery module.
   */
  discoverLocalSessions(projectPathFilter?: string): DiscoveredSession[] {
    return discoverLocalSessionsImpl(projectPathFilter, this.logger);
  }

  // -----------------------------------------------------------------------
  // Private methods
  // -----------------------------------------------------------------------

  private buildCliArgs(
    options: StartCliSessionOptions,
    model: string,
    sanitizedProjectPath: string,
  ): string[] {
    const args: string[] = [
      '-p',
      options.prompt,
      '--output-format',
      'stream-json',
      '--model',
      model,
      '--verbose',
      // Explicitly pass --cwd so the CLI discovers CLAUDE.md and
      // .claude/ project instructions from the correct project root,
      // even when the process-level cwd alone is insufficient.
      '--cwd',
      sanitizedProjectPath,
    ];

    // Resume previous session
    if (options.resumeSessionId) {
      args.push('--resume', options.resumeSessionId);
    }

    // Permission / tool controls from config
    if (options.config?.permissionMode) {
      const permMap: Record<string, string> = {
        default: 'default',
        acceptEdits: 'acceptEdits',
        plan: 'plan',
        bypassPermissions: 'bypassPermissions',
      };
      const mapped = permMap[options.config.permissionMode];
      if (mapped) {
        args.push('--permission-mode', mapped);
      }
    } else {
      // No explicit permissionMode configured: bypass permissions so the CLI
      // does not hang waiting for interactive confirmation when stdio is piped
      // (no TTY) in a managed worker process.
      args.push('--dangerously-skip-permissions');
    }

    if (options.config?.allowedTools && options.config.allowedTools.length > 0) {
      args.push('--allowedTools', options.config.allowedTools.join(','));
    }

    if (options.config?.disallowedTools && options.config.disallowedTools.length > 0) {
      args.push('--disallowedTools', options.config.disallowedTools.join(','));
    }

    if (options.config?.systemPrompt) {
      args.push('--append-system-prompt', options.config.systemPrompt);
    }

    if (options.config?.maxTurns) {
      args.push('--max-turns', String(options.config.maxTurns));
    }

    // Extra args
    if (options.extraArgs) {
      args.push(...options.extraArgs);
    }

    return args;
  }

  /**
   * Handle raw stdout data from a CLI process.
   * The stream-json format outputs one JSON object per line.
   */
  private handleStdoutData(sessionId: string, chunk: Buffer): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    // Emit raw output for terminal view consumers
    const rawText = chunk.toString();
    this.emitSessionEvent({
      type: 'session_output',
      sessionId,
      event: { event: 'raw_output', data: { text: rawText } },
    });

    const existing = this.lineBuffers.get(sessionId) ?? '';

    if (!rawText.includes('\n')) {
      const bounded = appendBoundedLineBuffer(existing, rawText, MAX_STDOUT_LINE_BUFFER_CHARS);
      this.lineBuffers.set(sessionId, bounded.buffer);
      if (bounded.truncated) {
        this.emitSessionEvent({
          type: 'session_error',
          sessionId,
          error: `CLI stdout buffer exceeded ${MAX_STDOUT_LINE_BUFFER_CHARS} chars; truncated incomplete line`,
        });
      }
      return;
    }

    const combined = existing + rawText;
    const lines = combined.split('\n');

    // Keep the last incomplete line in the buffer
    const incompleteLine = lines.pop() ?? '';
    const boundedIncompleteLine = incompleteLine.slice(-MAX_STDOUT_LINE_BUFFER_CHARS);
    this.lineBuffers.set(sessionId, boundedIncompleteLine);
    if (boundedIncompleteLine.length !== incompleteLine.length) {
      this.emitSessionEvent({
        type: 'session_error',
        sessionId,
        error: `CLI stdout buffer exceeded ${MAX_STDOUT_LINE_BUFFER_CHARS} chars; truncated incomplete line`,
      });
    }

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (!isCliStreamMessage(parsed)) {
          // Valid JSON but not a recognized stream message — emit as raw text
          const textEvent: AgentEvent = {
            event: 'output',
            data: { type: 'text', content: trimmed },
          };
          this.emitSessionEvent({ type: 'session_output', sessionId, event: textEvent });
          continue;
        }
        this.handleStreamMessage(sessionId, session, parsed);
      } catch {
        // Non-JSON output line — emit as raw text
        const textEvent: AgentEvent = {
          event: 'output',
          data: { type: 'text', content: trimmed },
        };
        this.emitSessionEvent({
          type: 'session_output',
          sessionId,
          event: textEvent,
        });
      }
    }
  }

  /**
   * Map a stream-json message from the Claude CLI to AgentEvent types.
   *
   * The stream-json format includes messages like:
   *   { "type": "init", "session_id": "...", ... }
   *   { "type": "assistant", "content": [...], ... }
   *   { "type": "tool_use", "name": "...", "input": {...}, ... }
   *   { "type": "tool_result", "content": "...", ... }
   *   { "type": "result", "result": "...", "session_id": "...", "total_cost_usd": ... }
   *   { "type": "cost", "usage": { "input_tokens": ..., "output_tokens": ... }, ... }
   */
  private handleStreamMessage(
    sessionId: string,
    session: CliSession,
    message: CliStreamMessage,
  ): void {
    session.lastActivity = new Date();

    switch (message.type) {
      case 'init':
      case 'system': {
        // Capture Claude session ID from init message
        if (message.session_id) {
          session.claudeSessionId = message.session_id;
        }
        break;
      }

      case 'assistant': {
        // Assistant text response
        const content = extractContentText(message.content);
        if (content) {
          const event: AgentEvent = {
            event: 'output',
            data: { type: 'text', content },
          };
          this.emitSessionEvent({ type: 'session_output', sessionId, event });
          session.messageCount++;
        }
        break;
      }

      case 'tool_use': {
        const toolName = message.name ?? 'unknown';
        const toolInput = message.input ?? {};
        const event: AgentEvent = {
          event: 'output',
          data: {
            type: 'tool_use',
            content: JSON.stringify({ tool: toolName, input: toolInput }),
          },
        };
        this.emitSessionEvent({ type: 'session_output', sessionId, event });
        break;
      }

      case 'tool_result': {
        const resultContent = extractContentText(message.content) ?? '';
        const event: AgentEvent = {
          event: 'output',
          data: { type: 'tool_result', content: resultContent },
        };
        this.emitSessionEvent({ type: 'session_output', sessionId, event });
        break;
      }

      case 'result': {
        // Final result message — session completed
        const resultText = message.result ?? '';
        const totalCost = message.total_cost_usd ?? 0;

        if (message.session_id) {
          session.claudeSessionId = message.session_id;
        }
        session.costUsd = totalCost;

        // Emit the result as a text output
        if (resultText) {
          const outputEvent: AgentEvent = {
            event: 'output',
            data: { type: 'text', content: resultText },
          };
          this.emitSessionEvent({ type: 'session_output', sessionId, event: outputEvent });
        }

        // Emit cost event
        const costEvent: AgentEvent = {
          event: 'cost',
          data: { turnCost: totalCost, totalCost },
        };
        this.emitSessionEvent({ type: 'session_output', sessionId, event: costEvent });
        break;
      }

      case 'cost': {
        const turnCost = message.cost_usd ?? 0;
        const totalCost = message.total_cost_usd ?? session.costUsd + turnCost;

        session.costUsd = totalCost;

        const event: AgentEvent = {
          event: 'cost',
          data: { turnCost, totalCost },
        };
        this.emitSessionEvent({ type: 'session_output', sessionId, event });
        break;
      }

      case 'permission_request':
      case 'approval_needed': {
        const tool = message.tool ?? message.name ?? 'unknown';
        const input = message.input ?? {};
        const timeout = message.timeout_seconds ?? 30;

        const event: AgentEvent = {
          event: 'approval_needed',
          data: { tool, input, timeoutSeconds: timeout },
        };
        this.emitSessionEvent({ type: 'session_output', sessionId, event });
        break;
      }

      default: {
        // Unknown message type — emit as raw JSON output
        const event: AgentEvent = {
          event: 'output',
          data: { type: 'text', content: JSON.stringify(message) },
        };
        this.emitSessionEvent({ type: 'session_output', sessionId, event });
        break;
      }
    }
  }

  private handleProcessExit(sessionId: string, exitCode: number | null): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      // A CLI `-p` process naturally exits when the prompt is fully answered.
      // This is normal — the session moves to 'paused' (can be resumed later).
      session.status = exitCode === 0 ? 'paused' : 'error';
      session.lastActivity = new Date();
      session.pid = null;
    }

    this.processes.delete(sessionId);
    this.lineBuffers.delete(sessionId);

    this.emitSessionEvent({
      type: 'session_ended',
      sessionId,
      exitCode,
    });
  }

  private emitSessionEvent(event: CliSessionEvent): void {
    this.emit('session-event', event);
    this.emit(event.type, event);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

/** Check that a value is a non-null object (useful after JSON.parse). */
function isNonNullObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Build a child process environment with provider-specific credential injection.
 *
 * - `anthropic_api` → `ANTHROPIC_API_KEY`
 * - `claude_max` / `claude_team` → `CLAUDE_CODE_OAUTH_TOKEN`
 * - `bedrock` → `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`
 * - `vertex` → `GOOGLE_APPLICATION_CREDENTIALS_JSON`
 */
function buildChildEnv(
  provider: string | null | undefined,
  credential: string | null | undefined,
): NodeJS.ProcessEnv {
  const env = { ...process.env };

  // Clean all Claude Code session env vars that leak from a parent session.
  // If the worker is running inside a Claude Code session (e.g. during development),
  // these vars can cause the spawned CLI to hang or misbehave.
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_SSE_PORT;
  delete env.CLAUDE_CODE_ENTRYPOINT;

  if (!provider || !credential) {
    return env;
  }

  switch (provider) {
    case 'anthropic_api':
      env.ANTHROPIC_API_KEY = credential;
      break;
    case 'claude_max':
    case 'claude_team':
      env.CLAUDE_CODE_OAUTH_TOKEN = credential;
      break;
    case 'bedrock': {
      const parts = credential.split(':');
      if (parts.length >= 3) {
        env.AWS_ACCESS_KEY_ID = parts[0];
        env.AWS_SECRET_ACCESS_KEY = parts[1];
        env.AWS_REGION = parts[2];
      }
      break;
    }
    case 'vertex':
      env.GOOGLE_APPLICATION_CREDENTIALS_JSON = credential;
      break;
  }

  return env;
}

/**
 * Extract text content from a Claude API content block.
 *
 * Content can be a string or an array of content blocks:
 * `[{ type: "text", text: "..." }, ...]`
 */
function extractContentText(content: unknown): string | null {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const block of content) {
      if (typeof block === 'string') {
        texts.push(block);
      } else if (isNonNullObject(block) && 'text' in block) {
        texts.push(String(block.text));
      }
    }
    return texts.length > 0 ? texts.join('\n') : null;
  }

  return null;
}

function appendBoundedLineBuffer(
  existing: string,
  chunk: string,
  maxChars: number,
): { buffer: string; truncated: boolean } {
  if (chunk.length >= maxChars) {
    return {
      buffer: chunk.slice(-maxChars),
      truncated: true,
    };
  }

  const remainingExistingChars = Math.max(0, maxChars - chunk.length);
  const boundedExisting = existing.slice(-remainingExistingChars);

  return {
    buffer: boundedExisting + chunk,
    truncated: boundedExisting.length !== existing.length,
  };
}
