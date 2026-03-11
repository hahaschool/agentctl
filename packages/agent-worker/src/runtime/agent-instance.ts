import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import type {
  AgentConfig,
  AgentEvent,
  AgentStatus,
  ExecutionSummary,
  ExecutionSummaryFileChange,
  SafetyDecision,
} from '@agentctl/shared';
import { AgentError, VALID_TRANSITIONS } from '@agentctl/shared';
import type { Logger } from 'pino';

import type { AuditEntry } from '../hooks/audit-logger.js';
import { AuditLogger } from '../hooks/audit-logger.js';
import { AuditReporter } from '../hooks/audit-reporter.js';
import { createPostToolUseHook } from '../hooks/post-tool-use.js';
import { createPreToolUseHook } from '../hooks/pre-tool-use.js';
import { createStopHook } from '../hooks/stop-hook.js';
import { EventedAgentOutputStream } from './agent-output-stream.js';
import { OutputBuffer } from './output-buffer.js';
import { runWithSdk, type SdkRunnerHooks } from './sdk-runner.js';
import {
  checkWorkdirSafety,
  createSandbox,
  type SafetyCheckResult,
  type SandboxSetup,
} from './workdir-safety.js';

const DEFAULT_AUDIT_LOG_DIR = '.agentctl/audit';

/** Default max execution time: 30 minutes */
const DEFAULT_MAX_EXECUTION_MS = 30 * 60 * 1_000;

export type AgentInstanceOptions = {
  agentId: string;
  machineId: string;
  config: AgentConfig;
  projectPath: string;
  logger: Logger;
  auditLogDir?: string;
  /** Maximum execution time in milliseconds before the agent is forcefully timed out. */
  maxExecutionMs?: number;
  /** Run ID assigned by the control plane. Used to correlate audit events with their run record. */
  runId?: string;
  /** URL of the control plane. When set, the agent will POST a completion callback when the run finishes. */
  controlPlaneUrl?: string;
  /** Session ID to resume a previous agent session instead of starting fresh. */
  resumeSession?: string;
  /** Current number of active tasks sharing this worker. */
  getActiveTaskCount?: () => number;
};

type AgentInstanceState = {
  status: AgentStatus;
  sessionId: string | null;
  startedAt: Date | null;
  stoppedAt: Date | null;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  prompt: string | null;
  resultText: string | null;
  /** Whether this run is a resumed session (vs. a fresh start). */
  isResumed: boolean;
};

const STUB_RUN_DURATION_MS = 5_000;
const STUB_TURNS = 4;
const STUB_TURN_INTERVAL_MS = 1_000;
const STUB_COST_PER_TURN = 0.003;

type PendingSafetyDecision = {
  prompt: string;
  resumeSessionId: string | undefined;
  check: SafetyCheckResult;
};

type ParsedToolUse = {
  toolName: string;
  fileChanges: ExecutionSummaryFileChange[];
};

function truncateSummaryText(value: string, maxLength: number = 240): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function extractLatestTextOutput(events: AgentEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.event !== 'output' || event.data.type !== 'text') {
      continue;
    }

    const content = event.data.content.trim();
    if (content.length > 0) {
      return truncateSummaryText(content);
    }
  }

  return null;
}

function parseToolUse(content: string): ParsedToolUse | null {
  try {
    const parsed = JSON.parse(content) as {
      tool?: string;
      input?: Record<string, unknown>;
    };
    const toolName = typeof parsed.tool === 'string' ? parsed.tool : null;
    if (!toolName) {
      return null;
    }

    const input = parsed.input ?? {};
    const candidatePath =
      typeof input.file_path === 'string'
        ? input.file_path
        : typeof input.filePath === 'string'
          ? input.filePath
          : typeof input.path === 'string'
            ? input.path
            : null;

    const fileChanges: ExecutionSummaryFileChange[] =
      candidatePath === null
        ? []
        : [
            {
              path: candidatePath,
              action: toolName === 'Write' ? 'created' : 'modified',
            },
          ];

    return { toolName, fileChanges };
  } catch {
    return null;
  }
}

function summarizeToolUsage(events: AgentEvent[]): {
  commandsRun: number;
  toolUsageBreakdown: Record<string, number>;
  filesChanged: ExecutionSummaryFileChange[];
} {
  const toolUsageBreakdown: Record<string, number> = {};
  const filesByKey = new Map<string, ExecutionSummaryFileChange>();
  let commandsRun = 0;

  for (const event of events) {
    if (event.event !== 'output' || event.data.type !== 'tool_use') {
      continue;
    }

    const parsed = parseToolUse(event.data.content);
    if (!parsed) {
      continue;
    }

    commandsRun += 1;
    toolUsageBreakdown[parsed.toolName] = (toolUsageBreakdown[parsed.toolName] ?? 0) + 1;

    for (const change of parsed.fileChanges) {
      filesByKey.set(`${change.action}:${change.path}`, change);
    }
  }

  return {
    commandsRun,
    toolUsageBreakdown,
    filesChanged: [...filesByKey.values()],
  };
}

export class AgentInstance extends EventEmitter {
  readonly agentId: string;
  readonly machineId: string;
  readonly config: AgentConfig;
  readonly projectPath: string;
  readonly outputBuffer: OutputBuffer;
  /** Run ID from the control plane. Populated when the agent is dispatched via the task worker. */
  readonly runId: string | null;
  /** Control plane URL for posting completion callbacks. */
  private readonly controlPlaneUrl: string | null;
  /** Session ID to resume instead of starting a fresh session. */
  private readonly resumeSession: string | null;

  private readonly log: Logger;
  private readonly auditLogger: AuditLogger;
  private readonly hooks: SdkRunnerHooks;
  private readonly maxExecutionMs: number;
  private readonly getActiveTaskCount: () => number;
  private state: AgentInstanceState;
  private auditReporter: AuditReporter | null = null;
  private simulationTimer: ReturnType<typeof setTimeout> | null = null;
  private turnTimer: ReturnType<typeof setInterval> | null = null;
  private executionTimer: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController | null = null;
  private pendingSafetyDecision: PendingSafetyDecision | null = null;
  private sandboxSetup: SandboxSetup | null = null;
  private executionProjectPath: string;

  constructor(options: AgentInstanceOptions) {
    super();

    this.agentId = options.agentId;
    this.machineId = options.machineId;
    this.config = options.config;
    this.projectPath = options.projectPath;
    this.runId = options.runId ?? null;
    this.controlPlaneUrl = options.controlPlaneUrl ?? null;
    this.resumeSession = options.resumeSession ?? null;
    this.getActiveTaskCount = options.getActiveTaskCount ?? (() => 1);
    this.log = options.logger.child({ agentId: this.agentId, machineId: this.machineId });
    this.outputBuffer = new OutputBuffer();
    this.executionProjectPath = this.projectPath;

    // Initialize audit logger and hook functions
    this.auditLogger = new AuditLogger({
      logDir: options.auditLogDir ?? DEFAULT_AUDIT_LOG_DIR,
      logger: this.log,
    });

    this.maxExecutionMs = options.maxExecutionMs ?? DEFAULT_MAX_EXECUTION_MS;

    this.hooks = {
      preToolUse: createPreToolUseHook({
        auditLogger: this.auditLogger,
        logger: this.log,
      }),
      postToolUse: createPostToolUseHook({
        auditLogger: this.auditLogger,
        logger: this.log,
      }),
      stop: createStopHook({
        auditLogger: this.auditLogger,
        logger: this.log,
      }),
    };

    this.state = {
      status: 'registered',
      sessionId: null,
      startedAt: null,
      stoppedAt: null,
      costUsd: 0,
      tokensIn: 0,
      tokensOut: 0,
      prompt: null,
      resultText: null,
      isResumed: false,
    };
  }

  async start(prompt: string): Promise<void> {
    // Reset mutable state before transitioning so old events/timers
    // from a previous run don't leak into the new one.
    this.outputBuffer.clear();
    this.clearTimers();

    this.transitionTo('starting');
    this.log.info({ prompt: prompt.slice(0, 100) }, 'Agent starting');

    const resumeSessionId = this.resumeSession ?? undefined;

    this.state.sessionId = randomUUID();
    this.state.startedAt = null;
    this.state.stoppedAt = null;
    this.state.costUsd = 0;
    this.state.tokensIn = 0;
    this.state.tokensOut = 0;
    this.state.prompt = prompt;
    this.state.resultText = null;
    this.state.isResumed = false;
    this.pendingSafetyDecision = null;
    this.executionProjectPath = this.projectPath;
    this.abortController = new AbortController();

    if (resumeSessionId) {
      this.log.info({ resumeSessionId }, 'Will attempt to resume previous session');
    }

    try {
      const safetyCheck = await checkWorkdirSafety(this.projectPath, this.getActiveTaskCount());
      const awaitingDecision = this.applySafetyCheck(safetyCheck, prompt, resumeSessionId);
      if (awaitingDecision) {
        return;
      }

      await this.beginExecution(prompt, resumeSessionId);
    } catch (err) {
      if (err instanceof AgentError && err.code === 'SAFETY_BLOCKED') {
        throw err;
      }
      this.handleError(err);
    }
  }

  async applySafetyDecision(decision: SafetyDecision): Promise<void> {
    const pending = this.pendingSafetyDecision;

    if (!pending) {
      throw new AgentError(
        'SAFETY_DECISION_NOT_PENDING',
        'No pending safety decision for this agent',
        { agentId: this.agentId, decision },
      );
    }

    this.pendingSafetyDecision = null;

    if (decision === 'reject') {
      const message = 'Agent start rejected by workdir safety decision.';
      this.emitEvent({
        event: 'safety_blocked',
        data: {
          tier: pending.check.tier,
          blockReason: message,
          parallelTaskCount: pending.check.parallelTaskCount,
        },
      });
      this.stopWithReason('safety_rejected', 'failure', message);
      return;
    }

    try {
      if (decision === 'sandbox') {
        this.sandboxSetup = await createSandbox(this.projectPath, this.runId ?? this.agentId);
        this.executionProjectPath = this.sandboxSetup.sandboxPath;
      } else {
        this.executionProjectPath = this.projectPath;
      }

      await this.beginExecution(pending.prompt, pending.resumeSessionId);
    } catch (err) {
      this.handleError(err);
      throw err;
    }
  }

  /**
   * Attempt a single SDK run, optionally resuming a previous session.
   *
   * Returns:
   *  - `true` if the SDK ran successfully (the instance is already transitioned to stopped)
   *  - `null` if the SDK is not installed (caller should fall back to stub)
   *  - `'resume_failed'` if a resume was attempted but failed (caller should retry without resume)
   *
   * Throws for non-resume SDK errors so they bubble up to {@link handleError}.
   */
  private async attemptSdkRun(
    prompt: string,
    resumeSessionId: string | undefined,
  ): Promise<true | null | 'resume_failed'> {
    try {
      const outputStream = new EventedAgentOutputStream((event) => this.emitEvent(event));
      const result = await runWithSdk({
        prompt,
        agentId: this.agentId,
        sessionId: this.state.sessionId ?? '',
        config: this.config,
        projectPath: this.executionProjectPath,
        logger: this.log,
        outputStream,
        abortSignal: this.abortController?.signal,
        hooks: this.hooks,
        resumeSessionId,
      });

      if (result) {
        // SDK run completed successfully
        this.state.costUsd = result.costUsd;
        this.state.tokensIn = result.tokensIn;
        this.state.tokensOut = result.tokensOut;
        this.state.sessionId = result.sessionId;
        this.state.resultText = result.result;
        if (resumeSessionId) {
          this.state.isResumed = true;
        }
        this.log.info(
          {
            sessionId: result.sessionId,
            costUsd: result.costUsd,
            tokensIn: result.tokensIn,
            tokensOut: result.tokensOut,
            isResumed: this.state.isResumed,
          },
          'SDK run completed',
        );
        this.finishStop('completed');
        return true;
      }

      // SDK not installed
      return null;
    } catch (err) {
      // If we were trying to resume and the error looks session-related, signal
      // the caller to retry without resume. Otherwise, re-throw.
      if (resumeSessionId && err instanceof AgentError) {
        return 'resume_failed';
      }
      throw err;
    }
  }

  async stop(graceful: boolean): Promise<void> {
    if (this.state.status === 'stopped' || this.state.status === 'stopping') {
      this.log.warn('Agent already stopped or stopping');
      return;
    }

    this.log.info({ graceful }, 'Stopping agent');

    // Signal the SDK runner (if active) to stop iteration.
    // The SDK runner will fire its own stop hook when it detects the abort.
    const wasAborted = this.abortController !== null;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    this.clearTimers();

    if (this.state.status === 'starting') {
      this.finishStop('user');
    } else if (graceful) {
      this.transitionTo('stopping');
      this.finishStop('user');
    } else {
      // Force stop — kill immediately
      this.finishStop('user');
    }

    // If the abort controller was not set (stub simulation), fire stop hook
    // here. For SDK runs, the runner handles it via the abort signal.
    if (!wasAborted) {
      await this.fireStopHook('user', 0);
    }
  }

  getStatus(): AgentStatus {
    return this.state.status;
  }

  getSessionId(): string | null {
    return this.state.sessionId;
  }

  getStartedAt(): Date | null {
    return this.state.startedAt;
  }

  getStoppedAt(): Date | null {
    return this.state.stoppedAt;
  }

  getCostUsd(): number {
    return this.state.costUsd;
  }

  /**
   * Register a callback for agent events. This is a convenience wrapper
   * around the underlying EventEmitter so callers don't need to know
   * the event name.
   */
  onEvent(callback: (event: AgentEvent) => void): void {
    this.on('agent-event', callback);
  }

  /**
   * Remove a previously registered event callback.
   */
  offEvent(callback: (event: AgentEvent) => void): void {
    this.off('agent-event', callback);
  }

  /**
   * Write an audit entry to the local NDJSON log. When an AuditReporter is
   * active for this run, the entry will automatically be picked up from the
   * file and forwarded to the control plane on the next flush cycle.
   *
   * This is the public API for future SDK event hooking — callers construct
   * an {@link AuditEntry} and hand it off here.
   */
  async reportAction(entry: AuditEntry): Promise<void> {
    await this.auditLogger.write(entry);
  }

  toJSON(): Record<string, unknown> {
    return {
      agentId: this.agentId,
      machineId: this.machineId,
      status: this.state.status,
      sessionId: this.state.sessionId,
      runId: this.runId,
      startedAt: this.state.startedAt?.toISOString() ?? null,
      stoppedAt: this.state.stoppedAt?.toISOString() ?? null,
      costUsd: this.state.costUsd,
      tokensIn: this.state.tokensIn,
      tokensOut: this.state.tokensOut,
      projectPath: this.executionProjectPath,
      isResumed: this.state.isResumed,
    };
  }

  // ── Private helpers ──────────────────────────────────────────────

  private transitionTo(next: AgentStatus): void {
    const current = this.state.status;
    const allowed = VALID_TRANSITIONS[current];

    if (!allowed.includes(next)) {
      throw new AgentError(
        'INVALID_TRANSITION',
        `Cannot transition from '${current}' to '${next}'`,
        { agentId: this.agentId, from: current, to: next },
      );
    }

    this.state.status = next;

    const statusEvent: AgentEvent = {
      event: 'status',
      data: { status: next },
    };

    this.emitEvent(statusEvent);
  }

  private emitEvent(event: AgentEvent): void {
    if (event.event === 'cost') {
      this.state.costUsd = event.data.totalCost;
    }

    this.outputBuffer.push(event);
    this.emit('agent-event', event);
  }

  private applySafetyCheck(
    check: SafetyCheckResult,
    prompt: string,
    resumeSessionId: string | undefined,
  ): boolean {
    if (check.tier === 'safe') {
      return false;
    }

    if (check.tier === 'guarded') {
      this.emitEvent({
        event: 'safety_warning',
        data: {
          tier: check.tier,
          warning: check.warning ?? 'Working directory changes may be overwritten.',
          parallelTaskCount: check.parallelTaskCount,
        },
      });
      return false;
    }

    if (check.tier === 'risky') {
      this.pendingSafetyDecision = {
        prompt,
        resumeSessionId,
        check,
      };
      this.emitEvent({
        event: 'safety_approval_needed',
        data: {
          tier: check.tier,
          warning: check.warning ?? 'Workdir safety approval is required before execution.',
          parallelTaskCount: check.parallelTaskCount,
          options: [
            { id: 'approve', label: 'Continue in place' },
            { id: 'sandbox', label: 'Run in sandbox' },
            { id: 'reject', label: 'Cancel start' },
          ],
        },
      });
      return true;
    }

    const blockReason =
      check.blockReason ?? 'Workdir safety check blocked execution in this directory.';
    this.emitEvent({
      event: 'safety_blocked',
      data: {
        tier: check.tier,
        blockReason,
        parallelTaskCount: check.parallelTaskCount,
      },
    });
    this.stopWithReason('safety_blocked', 'failure', blockReason);
    throw new AgentError('SAFETY_BLOCKED', blockReason, {
      agentId: this.agentId,
      tier: check.tier,
      parallelTaskCount: check.parallelTaskCount,
    });
  }

  private async beginExecution(prompt: string, resumeSessionId: string | undefined): Promise<void> {
    // Stamp startedAt here (after safety approval resolves) so that run
    // duration metrics exclude the time the agent spent waiting for approval.
    this.state.startedAt = new Date();
    this.transitionTo('running');
    this.log.info(
      { sessionId: this.state.sessionId, projectPath: this.executionProjectPath },
      'Agent running',
    );

    // Start per-instance audit reporter if this run is tied to a control plane run.
    // The reporter tails the same NDJSON file the AuditLogger writes to and
    // periodically POSTs new entries to the control plane.
    if (this.controlPlaneUrl && this.runId) {
      this.auditReporter = new AuditReporter({
        controlPlaneUrl: this.controlPlaneUrl,
        runId: this.runId,
        auditFilePath: this.auditLogger.getLogFilePath(),
        logger: this.log,
      });
      this.auditReporter.start();
    }

    // Start execution timeout timer
    this.executionTimer = setTimeout(() => {
      if (this.state.status === 'running') {
        this.log.warn(
          { agentId: this.agentId, maxExecutionMs: this.maxExecutionMs },
          'Agent execution timed out',
        );
        if (this.abortController) {
          this.abortController.abort();
          this.abortController = null;
        }
        this.clearTimers();
        this.state.status = 'timeout';
        this.state.stoppedAt = new Date();
        const timeoutEvent: AgentEvent = {
          event: 'status',
          data: { status: 'timeout', reason: 'execution_timeout' },
        };
        this.emitEvent(timeoutEvent);

        void this.finalizeSandbox(false);

        // Flush remaining audit events before notifying the control plane.
        this.stopAuditReporter().catch((err) => {
          this.log.warn({ err }, 'Failed to stop audit reporter on timeout');
        });

        // Fire-and-forget: notify the control plane that this run timed out.
        this.notifyRunCompletion('failure', 'Agent execution timed out').catch((err) => {
          this.log.error({ err }, 'Failed to notify control plane of timeout');
        });
      }
    }, this.maxExecutionMs);

    // Try the real Claude Agent SDK first — with optional session resume
    let result = await this.attemptSdkRun(prompt, resumeSessionId);

    // If resume was requested but the SDK run failed, fall back to a fresh session.
    // This handles cases where the session no longer exists or is corrupted.
    if (result === 'resume_failed') {
      this.log.warn({ resumeSessionId }, 'Session resume failed, falling back to fresh session');
      this.state.isResumed = false;
      result = await this.attemptSdkRun(prompt, undefined);
    }

    if (result === true) {
      // SDK run completed (handled inside attemptSdkRun)
      return;
    }

    // SDK not available — fall back to stub simulation
    if (resumeSessionId) {
      this.log.info('Session resume is not supported in stub simulation mode');
    }
    this.log.info('SDK not available, falling back to stub simulation');
    this.simulateRun();
  }

  private handleError(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);

    this.log.error({ err }, 'Agent encountered an error');
    this.clearTimers();
    this.abortController = null;

    // Only transition to error if we're in a state that allows it
    const allowed = VALID_TRANSITIONS[this.state.status];
    if (allowed.includes('error')) {
      this.state.status = 'error';
      this.state.stoppedAt = new Date();

      const statusEvent: AgentEvent = {
        event: 'status',
        data: { status: 'error', reason: message },
      };

      this.emitEvent(statusEvent);

      void this.finalizeSandbox(false);

      // Flush remaining audit events before notifying the control plane.
      void this.stopAuditReporter();

      // Fire-and-forget: notify the control plane that this run failed.
      void this.notifyRunCompletion('failure', message);
    }
  }

  private finishStop(reason: string): void {
    this.stopWithReason(reason, 'success');
  }

  private stopWithReason(
    reason: string,
    completionStatus: 'success' | 'failure',
    errorMessage?: string,
  ): void {
    this.state.status = 'stopped';
    this.state.stoppedAt = new Date();
    this.abortController = null;
    this.pendingSafetyDecision = null;

    const statusEvent: AgentEvent = {
      event: 'status',
      data: { status: 'stopped', reason },
    };

    this.emitEvent(statusEvent);
    this.log.info(
      { sessionId: this.state.sessionId, costUsd: this.state.costUsd },
      'Agent stopped',
    );

    void this.finalizeSandbox(reason === 'completed');

    // Flush remaining audit events to the control plane before notifying completion.
    void this.stopAuditReporter();

    // Fire-and-forget: notify the control plane that this run completed.
    void this.notifyRunCompletion(completionStatus, errorMessage);
  }

  /**
   * Fire the stop hook to record a session_end audit entry.
   * Called explicitly for stub simulation runs where the SDK runner
   * does not manage the hook lifecycle.
   */
  private async fireStopHook(reason: string, totalTurns: number): Promise<void> {
    if (!this.hooks.stop || !this.state.sessionId) {
      return;
    }

    try {
      await this.hooks.stop({
        sessionId: this.state.sessionId,
        agentId: this.agentId,
        reason,
        totalCostUsd: this.state.costUsd,
        totalTurns,
      });
    } catch (err) {
      this.log.warn({ err }, 'Stop hook failed');
    }
  }

  /**
   * Stop the per-instance audit reporter (if one was created) so that any
   * buffered entries are flushed to the control plane. This is fire-and-forget
   * — a flush failure should not block agent shutdown.
   */
  private async stopAuditReporter(): Promise<void> {
    if (!this.auditReporter) {
      return;
    }

    try {
      await this.auditReporter.stop();
    } catch (err) {
      this.log.warn({ err }, 'Failed to stop per-instance audit reporter');
    } finally {
      this.auditReporter = null;
    }
  }

  private async finalizeSandbox(copyBack: boolean): Promise<void> {
    const sandboxSetup = this.sandboxSetup;

    if (!sandboxSetup) {
      this.executionProjectPath = this.projectPath;
      return;
    }

    this.sandboxSetup = null;

    if (copyBack) {
      try {
        await sandboxSetup.copyBack();
      } catch (err) {
        this.log.warn(
          { err, sandboxPath: sandboxSetup.sandboxPath },
          'Failed to copy sandbox back',
        );
      }
    }

    try {
      await sandboxSetup.cleanup();
    } catch (err) {
      this.log.warn({ err, sandboxPath: sandboxSetup.sandboxPath }, 'Failed to clean up sandbox');
    } finally {
      this.executionProjectPath = this.projectPath;
    }
  }

  /**
   * POST a completion callback to the control plane so it can mark the run as
   * finished. This is fire-and-forget — failure to notify does not block agent
   * cleanup.
   */
  private async notifyRunCompletion(
    status: 'success' | 'failure',
    errorMessage?: string,
  ): Promise<void> {
    if (!this.controlPlaneUrl || !this.runId) {
      return;
    }

    const callbackUrl = `${this.controlPlaneUrl}/api/agents/${encodeURIComponent(this.agentId)}/complete`;
    const durationMs =
      this.state.startedAt && this.state.stoppedAt
        ? this.state.stoppedAt.getTime() - this.state.startedAt.getTime()
        : undefined;

    const body = {
      runId: this.runId,
      status,
      costUsd: this.state.costUsd,
      tokensIn: this.state.tokensIn,
      tokensOut: this.state.tokensOut,
      durationMs,
      sessionId: this.state.sessionId ?? undefined,
      errorMessage,
      resultSummary: this.buildExecutionSummary(status, errorMessage),
    };

    const CALLBACK_TIMEOUT_MS = 10_000;

    try {
      const response = await fetch(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(CALLBACK_TIMEOUT_MS),
      });

      if (response.ok) {
        this.log.info(
          { runId: this.runId, status, callbackUrl },
          'Run completion callback sent to control plane',
        );
      } else {
        this.log.warn(
          { runId: this.runId, callbackUrl, httpStatus: response.status },
          'Control plane returned non-OK response for completion callback',
        );
      }
    } catch (err) {
      this.log.warn(
        { err, runId: this.runId, callbackUrl },
        'Failed to send run completion callback to control plane',
      );
    }
  }

  private clearTimers(): void {
    if (this.simulationTimer) {
      clearTimeout(this.simulationTimer);
      this.simulationTimer = null;
    }
    if (this.turnTimer) {
      clearInterval(this.turnTimer);
      this.turnTimer = null;
    }
    if (this.executionTimer) {
      clearTimeout(this.executionTimer);
      this.executionTimer = null;
    }
  }

  /**
   * Stub: simulate an agent running for a few turns, emitting output
   * and cost events, then completing. This will be replaced with real
   * Claude Agent SDK integration.
   */
  private simulateRun(): void {
    let turn = 0;

    this.turnTimer = setInterval(() => {
      if (this.state.status !== 'running') {
        this.clearTimers();
        return;
      }

      turn++;

      // Emit a simulated output event
      const outputEvent: AgentEvent = {
        event: 'output',
        data: {
          type: 'text',
          content: `[stub] Turn ${turn}/${STUB_TURNS}: processing "${this.state.prompt?.slice(0, 50) ?? ''}"...`,
        },
      };

      this.emitEvent(outputEvent);

      // Emit a simulated cost event
      this.state.costUsd += STUB_COST_PER_TURN;

      const costEvent: AgentEvent = {
        event: 'cost',
        data: {
          turnCost: STUB_COST_PER_TURN,
          totalCost: this.state.costUsd,
        },
      };

      this.emitEvent(costEvent);

      this.log.debug({ turn, costUsd: this.state.costUsd }, 'Agent turn completed');
    }, STUB_TURN_INTERVAL_MS);

    // After the simulated duration, stop the agent
    this.simulationTimer = setTimeout(() => {
      this.clearTimers();

      if (this.state.status === 'running') {
        // Emit a final output summary
        const finalEvent: AgentEvent = {
          event: 'output',
          data: {
            type: 'text',
            content: `[stub] Agent completed after ${STUB_TURNS} turns. Total cost: $${this.state.costUsd.toFixed(4)}`,
          },
        };

        this.state.resultText = finalEvent.data.content;
        this.emitEvent(finalEvent);
        this.finishStop('completed');

        // Fire the stop hook for audit trail consistency in stub mode.
        // In SDK mode the runner handles this directly.
        void this.fireStopHook('completed', STUB_TURNS);
      }
    }, STUB_RUN_DURATION_MS);
  }

  private buildExecutionSummary(
    status: 'success' | 'failure',
    errorMessage?: string,
  ): ExecutionSummary {
    const events = this.outputBuffer.getRecent(this.outputBuffer.size);
    const { commandsRun, toolUsageBreakdown, filesChanged } = summarizeToolUsage(events);
    const latestText =
      this.state.resultText?.trim() ||
      extractLatestTextOutput(events) ||
      this.state.prompt?.trim() ||
      '';
    const executiveSummary =
      status === 'success'
        ? truncateSummaryText(latestText || 'Completed the requested run.')
        : truncateSummaryText(
            errorMessage || latestText || 'Run failed before completing the requested work.',
          );

    const keyFindings: string[] = [];
    if (commandsRun > 0) {
      keyFindings.push(
        `Executed ${commandsRun} tool call${commandsRun === 1 ? '' : 's'} across ${Object.keys(toolUsageBreakdown).length} tool${Object.keys(toolUsageBreakdown).length === 1 ? '' : 's'}.`,
      );
    }
    if (filesChanged.length > 0) {
      keyFindings.push(
        `Touched ${filesChanged.length} file${filesChanged.length === 1 ? '' : 's'} during the run.`,
      );
    }
    if (status === 'failure' && errorMessage) {
      keyFindings.push(`Failure reason: ${truncateSummaryText(errorMessage, 180)}`);
    }

    const followUps =
      status === 'failure' && errorMessage
        ? [`Investigate failure: ${truncateSummaryText(errorMessage, 180)}`]
        : [];

    return {
      status: status === 'success' ? 'success' : 'failure',
      workCompleted: executiveSummary,
      executiveSummary,
      keyFindings,
      filesChanged,
      commandsRun,
      toolUsageBreakdown,
      followUps,
      branchName: null,
      prUrl: null,
      tokensUsed: {
        input: this.state.tokensIn,
        output: this.state.tokensOut,
      },
      costUsd: this.state.costUsd,
      durationMs:
        this.state.startedAt && this.state.stoppedAt
          ? Math.max(0, this.state.stoppedAt.getTime() - this.state.startedAt.getTime())
          : 0,
    };
  }
}
