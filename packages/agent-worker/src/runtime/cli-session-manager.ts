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
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { AgentConfig, AgentEvent } from '@agentctl/shared';
import { AgentError } from '@agentctl/shared';

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

export type DiscoveredSession = {
  /** Session ID from Claude Code's sessions-index.json. */
  sessionId: string;
  /** Project path this session was used in. */
  projectPath: string;
  /** Summary/title of the session (if available). */
  summary: string;
  /** Number of messages. */
  messageCount: number;
  /** Last activity timestamp. */
  lastActivity: string;
  /** Git branch (if available). */
  branch: string | null;
};

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
  logger?: { debug: (obj: Record<string, unknown>, msg: string) => void; warn: (obj: Record<string, unknown>, msg: string) => void };
};

export type CliSessionEvent =
  | { type: 'session_started'; sessionId: string; claudeSessionId: string | null }
  | { type: 'session_output'; sessionId: string; event: AgentEvent }
  | { type: 'session_ended'; sessionId: string; exitCode: number | null }
  | { type: 'session_error'; sessionId: string; error: string };

// ---------------------------------------------------------------------------
// Streaming JSON message types from `claude -p --output-format stream-json`
// ---------------------------------------------------------------------------

type CliStreamMessage = {
  type: string;
  [key: string]: unknown;
};

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

// ---------------------------------------------------------------------------
// CliSessionManager
// ---------------------------------------------------------------------------

export class CliSessionManager extends EventEmitter {
  private readonly claudePath: string;
  private readonly maxConcurrentSessions: number;
  private readonly sessions: Map<string, CliSession> = new Map();
  private readonly processes: Map<string, ChildProcess> = new Map();
  private readonly lineBuffers: Map<string, string> = new Map();
  private readonly logger?: { debug: (obj: Record<string, unknown>, msg: string) => void; warn: (obj: Record<string, unknown>, msg: string) => void };
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
    const now = Date.now();
    for (const [sid, s] of this.sessions) {
      if (s.status === 'error' || s.status === 'ended') {
        this.sessions.delete(sid);
      } else if (
        s.status === 'paused' &&
        now - s.lastActivity.getTime() > STALE_SESSION_THRESHOLD_MS
      ) {
        this.sessions.delete(sid);
      }
    }

    this.sessionCounter++;
    const id = `cli-${Date.now()}-${this.sessionCounter}`;
    const model = options.model ?? DEFAULT_MODEL;
    const isResumed = !!options.resumeSessionId;

    const session: CliSession = {
      id,
      claudeSessionId: options.resumeSessionId ?? null,
      agentId: options.agentId,
      projectPath: options.projectPath,
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
    const args = this.buildCliArgs(options, model);

    // Build child environment with credential injection
    const childEnv = buildChildEnv(options.accountProvider, options.accountCredential);

    // Spawn the CLI process.
    // stdin is set to 'ignore' — the CLI in `-p` mode doesn't read from stdin,
    // and keeping stdin open can cause the process to hang waiting for EOF.
    const child = spawn(options.claudePath ?? this.claudePath, args, {
      cwd: options.projectPath,
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
   *
   * Claude Code stores sessions under `~/.claude/projects/` in two patterns:
   *
   * 1. **With sessions-index.json** — contains `{ version, entries: [...], originalPath }`
   *    where each entry has sessionId, summary, messageCount, etc.
   *    These may be directly in a project dir or nested one level deeper
   *    (e.g. under a `-` parent directory).
   *
   * 2. **Without sessions-index.json** — only `.jsonl` files exist.
   *    We report these as sessions with minimal metadata.
   */
  discoverLocalSessions(projectPathFilter?: string): DiscoveredSession[] {
    const claudeDir = join(homedir(), '.claude', 'projects');
    if (!existsSync(claudeDir)) {
      return [];
    }

    const discovered: DiscoveredSession[] = [];

    try {
      const topDirs = readdirSync(claudeDir, { withFileTypes: true });

      for (const dir of topDirs) {
        if (!dir.isDirectory()) {
          continue;
        }

        const dirPath = join(claudeDir, dir.name);

        // Try to parse sessions-index.json at this level
        this.parseSessionIndex(dirPath, dir.name, projectPathFilter, discovered);

        // Also recurse one level deeper — Claude Code nests project dirs
        // under a `-` parent directory (which represents `/`)
        try {
          const subDirs = readdirSync(dirPath, { withFileTypes: true });
          for (const sub of subDirs) {
            if (!sub.isDirectory()) {
              continue;
            }
            this.parseSessionIndex(
              join(dirPath, sub.name),
              sub.name,
              projectPathFilter,
              discovered,
            );
          }
        } catch (err) {
          // Intentional: subdirectory may be unreadable due to permissions;
          // skip gracefully so remaining directories are still discovered.
          this.logger?.debug(
            { error: err instanceof Error ? err.message : String(err), path: dirPath },
            'Skipped unreadable subdirectory during session discovery',
          );
        }

        // For dirs without sessions-index.json, discover from JSONL files
        if (!existsSync(join(dirPath, 'sessions-index.json'))) {
          this.discoverFromJsonlFiles(dirPath, dir.name, projectPathFilter, discovered);
        }
      }
    } catch (err) {
      // Intentional: the ~/.claude/projects directory itself may not exist
      // or may be unreadable; return empty results rather than crashing.
      this.logger?.debug(
        { error: err instanceof Error ? err.message : String(err), path: claudeDir },
        'Failed to read Claude projects directory during session discovery',
      );
    }

    // Deduplicate by sessionId (subdirectory nesting may cause duplicates)
    const seen = new Set<string>();
    const deduped = discovered.filter((s) => {
      if (seen.has(s.sessionId)) return false;
      seen.add(s.sessionId);
      return true;
    });

    // Sort by most recent activity
    deduped.sort((a, b) => {
      const dateA = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
      const dateB = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
      return dateB - dateA;
    });

    return deduped;
  }

  /**
   * Parse a sessions-index.json file and add discovered sessions.
   *
   * Handles both:
   *   - v1 format: `{ version: 1, entries: [...], originalPath }`
   *   - Legacy format: `Record<string, SessionIndexEntry>`
   */
  private parseSessionIndex(
    dirPath: string,
    dirName: string,
    projectPathFilter: string | undefined,
    out: DiscoveredSession[],
  ): void {
    const indexPath = join(dirPath, 'sessions-index.json');
    if (!existsSync(indexPath)) {
      return;
    }

    try {
      const raw = readFileSync(indexPath, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;

      if (!parsed || typeof parsed !== 'object') {
        return;
      }

      const obj = parsed as Record<string, unknown>;

      // v1 format: { version, entries: [...], originalPath }
      if (Array.isArray(obj.entries)) {
        const projectPath =
          (typeof obj.originalPath === 'string' ? obj.originalPath : null) ??
          decodeProjectPath(dirName);

        if (projectPathFilter && !projectPath.includes(projectPathFilter)) {
          return;
        }

        for (const entry of obj.entries as SessionIndexEntryV1[]) {
          if (!entry.sessionId || typeof entry.sessionId !== 'string') {
            continue;
          }
          out.push({
            sessionId: entry.sessionId,
            projectPath,
            summary: entry.summary ?? entry.firstPrompt ?? '',
            messageCount: entry.messageCount ?? 0,
            lastActivity: entry.modified ?? entry.created ?? '',
            branch: entry.gitBranch ?? null,
          });
        }
        return;
      }

      // Legacy format: Record<string, SessionIndexEntry>
      const decodedPath = decodeProjectPath(dirName);
      if (projectPathFilter && !decodedPath.includes(projectPathFilter)) {
        return;
      }

      for (const [sessionId, entry] of Object.entries(obj)) {
        if (typeof entry !== 'object' || entry === null) {
          continue;
        }
        const e = entry as SessionIndexEntry;
        out.push({
          sessionId,
          projectPath: decodedPath,
          summary: e.summary ?? e.title ?? '',
          messageCount: e.messageCount ?? 0,
          lastActivity: e.lastActiveAt ?? e.updatedAt ?? '',
          branch: e.gitBranch ?? null,
        });
      }
    } catch (err) {
      // Intentional: corrupted or malformed sessions-index.json should not
      // prevent discovery of other valid session data.
      this.logger?.debug(
        { error: err instanceof Error ? err.message : String(err), path: indexPath },
        'Skipped corrupted session index file',
      );
    }
  }

  /**
   * Discover sessions from raw JSONL files when no sessions-index.json exists.
   * Provides minimal metadata (sessionId, projectPath, lastActivity from file mtime).
   */
  private discoverFromJsonlFiles(
    dirPath: string,
    dirName: string,
    projectPathFilter: string | undefined,
    out: DiscoveredSession[],
  ): void {
    const decodedPath = decodeProjectPath(dirName);
    if (projectPathFilter && !decodedPath.includes(projectPathFilter)) {
      return;
    }

    try {
      const files = readdirSync(dirPath, { withFileTypes: true });
      for (const file of files) {
        if (!file.isFile() || !file.name.endsWith('.jsonl')) {
          continue;
        }
        const sessionId = file.name.replace(/\.jsonl$/, '');
        // Validate it looks like a UUID
        if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(sessionId)) {
          continue;
        }

        const stats = statSync(join(dirPath, file.name));

        out.push({
          sessionId,
          projectPath: decodedPath,
          summary: '',
          messageCount: 0,
          lastActivity: stats.mtime.toISOString(),
          branch: null,
        });
      }
    } catch (err) {
      // Intentional: directory may be unreadable; skip gracefully so
      // other project directories can still be discovered.
      this.logger?.debug(
        { error: err instanceof Error ? err.message : String(err), path: dirPath },
        'Skipped unreadable directory during JSONL session discovery',
      );
    }
  }

  // -----------------------------------------------------------------------
  // Private methods
  // -----------------------------------------------------------------------

  private buildCliArgs(options: StartCliSessionOptions, model: string): string[] {
    const args: string[] = [
      '-p',
      options.prompt,
      '--output-format',
      'stream-json',
      '--model',
      model,
      '--verbose',
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
    const combined = existing + rawText;
    const lines = combined.split('\n');

    // Keep the last incomplete line in the buffer
    this.lineBuffers.set(sessionId, lines.pop() ?? '');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      try {
        const message = JSON.parse(trimmed) as CliStreamMessage;
        this.handleStreamMessage(sessionId, session, message);
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
        const claudeId = message.session_id as string | undefined;
        if (claudeId) {
          session.claudeSessionId = claudeId;
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
        const toolName = (message.name as string) ?? 'unknown';
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
        const resultText = (message.result as string) ?? '';
        const totalCost = (message.total_cost_usd as number) ?? 0;
        const claudeId = message.session_id as string | undefined;

        if (claudeId) {
          session.claudeSessionId = claudeId;
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
        const usage = message.usage as Record<string, number> | undefined;
        const turnCost = (message.cost_usd as number) ?? 0;
        const totalCost = (message.total_cost_usd as number) ?? session.costUsd + turnCost;

        session.costUsd = totalCost;

        const event: AgentEvent = {
          event: 'cost',
          data: { turnCost, totalCost },
        };
        this.emitSessionEvent({ type: 'session_output', sessionId, event });

        if (usage) {
          // Log token usage for tracking
          const tokensIn = usage.input_tokens ?? 0;
          const tokensOut = usage.output_tokens ?? 0;
          void [tokensIn, tokensOut]; // consumed via events
        }
        break;
      }

      case 'permission_request':
      case 'approval_needed': {
        const tool = (message.tool as string) ?? (message.name as string) ?? 'unknown';
        const input = message.input ?? {};
        const timeout = (message.timeout_seconds as number) ?? 30;

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

/**
 * Claude Code's `sessions-index.json` entry shape.
 */
/**
 * Legacy sessions-index.json entry (Record<sessionId, entry> format).
 */
type SessionIndexEntry = {
  summary?: string;
  title?: string;
  messageCount?: number;
  lastActiveAt?: string;
  updatedAt?: string;
  gitBranch?: string;
};

/**
 * v1 sessions-index.json entry (entries array format).
 */
type SessionIndexEntryV1 = {
  sessionId: string;
  fullPath?: string;
  fileMtime?: number;
  firstPrompt?: string;
  summary?: string;
  messageCount?: number;
  created?: string;
  modified?: string;
  gitBranch?: string;
  projectPath?: string;
  isSidechain?: boolean;
};

/**
 * Decode a Claude Code project directory name back to its filesystem path.
 *
 * Claude Code encodes project paths by replacing `/` with `-` and
 * prepending with `-`. E.g., `/Users/foo/project` → `-Users-foo-project`.
 *
 * The naive approach (replace all `-` with `/`) breaks for paths that contain
 * hyphens, e.g. `/Users/foo/my-project` encodes to `-Users-foo-my-project`
 * but naive decode gives `/Users/foo/my/project` (wrong).
 *
 * Instead we walk the encoded segments left-to-right. At each step we try
 * two candidates for the next path component:
 *   1. path + "/" + segment   — treat the `-` as a directory separator
 *   2. path + "-" + segment   — treat the `-` as a literal hyphen (merge)
 *
 * We prefer the slash interpretation unless only the hyphen-merged prefix
 * exists on disk, falling back to the slash interpretation when neither exists.
 */
function decodeProjectPath(encoded: string): string {
  // Normalise: strip the leading '-' that represents the root '/'
  const withoutLeader = encoded.startsWith('-') ? encoded.slice(1) : encoded;
  const segments = withoutLeader.split('-');

  // Start at filesystem root (leading '-' represents '/')
  let path = encoded.startsWith('-') ? '/' : '';

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg === '') {
      // Skip empty segments that arise from the leading '-' strip
      continue;
    }

    if (path === '' || path === '/') {
      // First real segment — only one option: append directly
      path = path === '/' ? `/${seg}` : seg;
    } else {
      // Two candidates: treat the dash as a separator vs. as a literal hyphen
      const slashCandidate = `${path}/${seg}`;
      const hyphenCandidate = `${path}-${seg}`;

      if (existsSync(slashCandidate)) {
        // Slash interpretation is valid on disk — use it
        path = slashCandidate;
      } else if (existsSync(hyphenCandidate)) {
        // Hyphen interpretation matches a real directory — merge
        path = hyphenCandidate;
      } else {
        // Neither exists yet; default to slash (more segments may refine this,
        // and it matches the naive decode behaviour as a best guess)
        path = slashCandidate;
      }
    }
  }

  return path;
}

/**
 * Extract text content from a Claude API content block.
 *
 * Content can be:
 * - A string
 * - An array of content blocks: [{ type: "text", text: "..." }, ...]
 */
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

function extractContentText(content: unknown): string | null {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const block of content) {
      if (typeof block === 'string') {
        texts.push(block);
      } else if (block && typeof block === 'object' && 'text' in block) {
        texts.push(String((block as { text: unknown }).text));
      }
    }
    return texts.length > 0 ? texts.join('\n') : null;
  }

  return null;
}
