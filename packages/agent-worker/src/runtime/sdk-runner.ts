import { randomUUID } from 'node:crypto';

import type { AgentConfig } from '@agentctl/shared';
import { AgentError } from '@agentctl/shared';
import type { Logger } from 'pino';

import type { PostToolUseInput } from '../hooks/post-tool-use.js';
import type { PreToolUseInput, PreToolUseResult } from '../hooks/pre-tool-use.js';
import type { StopInput } from '../hooks/stop-hook.js';
import type { AgentOutputStream } from './agent-output-stream.js';

export type SdkRunnerHooks = {
  preToolUse?: (input: PreToolUseInput) => Promise<PreToolUseResult>;
  postToolUse?: (input: PostToolUseInput) => Promise<void>;
  stop?: (input: StopInput) => Promise<void>;
};

export type SdkRunnerOptions = {
  prompt: string;
  agentId: string;
  machineId: string;
  sessionId: string;
  controlPlaneUrl?: string;
  config: AgentConfig;
  projectPath: string;
  logger: Logger;
  outputStream: AgentOutputStream;
  abortSignal?: AbortSignal;
  hooks?: SdkRunnerHooks;
  /** When set, instructs the SDK to resume a previous session instead of starting a fresh one. */
  resumeSessionId?: string;
  /** Called as soon as the real Claude session ID is known (from init/result message). */
  onSessionIdResolved?: (claudeSessionId: string) => void;
};

export type SdkRunResult = {
  sessionId: string;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  result: string;
};

/**
 * Local fallback types for Task 1 parallelization.
 * Replace with `@agentctl/shared` imports once shared exports land.
 */
export type PermissionRequest = {
  id: string;
  agentId: string;
  sessionId: string;
  machineId: string;
  requestId: string;
  toolName: string;
  toolInput?: Record<string, unknown>;
  description?: string;
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'cancelled';
  requestedAt: string;
  timeoutAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  decision?: 'approved' | 'denied';
};

export type PermissionDecision = {
  requestId: string;
  decision: 'approved' | 'denied';
};

type SdkCanUseToolResult = {
  allowed: boolean;
};

type SdkCanUseToolContext = {
  signal?: AbortSignal;
};

type SdkCanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  context: SdkCanUseToolContext,
) => Promise<SdkCanUseToolResult>;

type PendingPermissionDecision = {
  agentId: string;
  resolve: (decision: PermissionDecision['decision']) => void;
};

const pendingPermissionDecisions = new Map<string, PendingPermissionDecision>();

const DEFAULT_PERMISSION_TIMEOUT_SECONDS = 300;
const PERMISSION_REQUEST_POST_TIMEOUT_MS = 10_000;
const REDACTED_INPUT_VALUE = '[REDACTED]';
const SECRET_INPUT_MARKERS = ['key', 'secret', 'token', 'password'];

/**
 * Minimal type describing the subset of the Claude Agent SDK we consume.
 * We define this locally instead of importing the SDK module type so that
 * the project compiles even when `@anthropic-ai/claude-agent-sdk` is not
 * installed.
 */
type ClaudeAgentSdk = {
  query: (args: { prompt: string; options: Record<string, unknown> }) => AsyncIterable<SdkMessage>;
};

/**
 * Shape of a streaming message emitted by the Claude Agent SDK.
 *
 * The SDK is dynamically imported so we cannot rely on its published types.
 * Using an explicit type instead of `Record<string, unknown>` lets us avoid
 * `as` casts when reading well-known properties.
 */
type SdkMessage = {
  type?: string;
  content?: unknown;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  result?: string;
  session_id?: string;
  turn_cost_usd?: number;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
};

// ---------------------------------------------------------------------------
// Type-safe property helpers — replace scattered `as` casts
// ---------------------------------------------------------------------------

/** Safely extract a string property from an unknown value, returning a fallback. */
function getString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/** Safely extract a number property from an unknown value, returning a fallback. */
function getNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSensitiveInputKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SECRET_INPUT_MARKERS.some((marker) => lower.includes(marker));
}

function sanitizeValue(value: unknown, parentKey?: string): unknown {
  if (parentKey && isSensitiveInputKey(parentKey)) {
    return REDACTED_INPUT_VALUE;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry));
  }

  if (isRecord(value)) {
    const sanitized: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      sanitized[key] = sanitizeValue(nested, key);
    }
    return sanitized;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'function') {
    return '[omitted]';
  }

  if (typeof value === 'symbol') {
    return value.toString();
  }

  return value;
}

export function sanitizeToolInput(
  input: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!input) {
    return undefined;
  }

  return sanitizeValue(input) as Record<string, unknown>;
}

function buildPermissionRequestSignal(signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(PERMISSION_REQUEST_POST_TIMEOUT_MS);
  if (!signal) {
    return timeoutSignal;
  }
  return AbortSignal.any([signal, timeoutSignal]);
}

function waitForPermissionDecision(
  requestId: string,
  agentId: string,
  signal?: AbortSignal,
): Promise<PermissionDecision['decision']> {
  if (signal?.aborted) {
    return Promise.resolve('denied');
  }

  return new Promise((resolve) => {
    const cleanup = (): void => {
      pendingPermissionDecisions.delete(requestId);
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    };

    const onAbort = (): void => {
      cleanup();
      resolve('denied');
    };

    pendingPermissionDecisions.set(requestId, {
      agentId,
      resolve: (decision) => {
        cleanup();
        resolve(decision);
      },
    });

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

export function resolvePendingPermissionDecision(
  decision: PermissionDecision,
  expectedAgentId?: string,
): boolean {
  const pending = pendingPermissionDecisions.get(decision.requestId);
  if (!pending) {
    return false;
  }

  if (expectedAgentId && pending.agentId !== expectedAgentId) {
    return false;
  }

  pending.resolve(decision.decision);
  return true;
}

export function __clearPendingPermissionDecisionsForTests(): void {
  pendingPermissionDecisions.clear();
}

/**
 * Attempt to dynamically import the Claude Agent SDK.
 * Returns null if the SDK is not installed, allowing the caller
 * to fall back to alternative behavior (e.g., stub simulation).
 */
async function loadSdk(): Promise<ClaudeAgentSdk | null> {
  try {
    const mod = await (import('@anthropic-ai/claude-agent-sdk' as string) as Promise<
      Record<string, unknown>
    >);
    const queryFn = mod.query ?? (mod.default as Record<string, unknown> | undefined)?.query;
    if (typeof queryFn !== 'function') {
      return null;
    }
    return { query: queryFn as ClaudeAgentSdk['query'] };
  } catch {
    return null;
  }
}

/**
 * Map an AgentConfig to the options shape expected by the Claude Agent SDK
 * `query()` function.
 *
 * When {@link resumeSessionId} is provided the SDK will attempt to continue
 * the identified session rather than starting a new conversation.
 */
function buildSdkOptions(
  config: AgentConfig,
  projectPath: string,
  resumeSessionId?: string,
  canUseTool?: SdkCanUseTool,
): Record<string, unknown> {
  return {
    model: config.model ?? 'sonnet',
    maxTurns: config.maxTurns ?? 50,
    permissionMode: config.permissionMode ?? 'acceptEdits',
    ...(config.allowedTools ? { allowedTools: config.allowedTools } : {}),
    ...(config.disallowedTools ? { disallowedTools: config.disallowedTools } : {}),
    ...(config.systemPrompt ? { systemPrompt: config.systemPrompt } : {}),
    ...(canUseTool ? { canUseTool } : {}),
    ...(resumeSessionId ? { resume: resumeSessionId } : {}),
    cwd: projectPath,
  };
}

function createCanUseToolHandler({
  agentId,
  machineId,
  sessionId,
  permissionMode,
  controlPlaneUrl,
  logger,
}: {
  agentId: string;
  machineId: string;
  sessionId: string;
  permissionMode: AgentConfig['permissionMode'];
  controlPlaneUrl?: string;
  logger: Logger;
}): SdkCanUseTool {
  return async (toolName, input, context) => {
    if (permissionMode === 'bypassPermissions') {
      return { allowed: true };
    }

    if (!controlPlaneUrl) {
      logger.warn(
        { agentId, toolName, permissionMode },
        'Permission request denied because control plane URL is unavailable',
      );
      return { allowed: false };
    }

    const requestId = randomUUID();
    const signal = context?.signal;
    const decisionPromise = waitForPermissionDecision(requestId, agentId, signal);

    const requestBody = {
      agentId,
      sessionId,
      machineId,
      requestId,
      toolName,
      toolInput: sanitizeToolInput(input),
      timeoutSeconds: DEFAULT_PERMISSION_TIMEOUT_SECONDS,
    };

    try {
      const response = await fetch(`${controlPlaneUrl}/api/permission-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: buildPermissionRequestSignal(signal),
      });

      if (!response.ok) {
        logger.warn(
          { agentId, toolName, requestId, status: response.status },
          'Control plane rejected permission request',
        );
        resolvePendingPermissionDecision({ requestId, decision: 'denied' }, agentId);
        return { allowed: false };
      }
    } catch (err) {
      if (!signal?.aborted) {
        logger.warn(
          { err, agentId, toolName, requestId },
          'Failed to create permission request with control plane',
        );
      }
      resolvePendingPermissionDecision({ requestId, decision: 'denied' }, agentId);
      return { allowed: false };
    }

    const decision = await decisionPromise;
    return { allowed: decision === 'approved' };
  };
}

/**
 * Map a raw SDK streaming message to AgentEvent(s) and emit them.
 *
 * The SDK message shape is not fully typed here because we dynamically
 * import the package. We use a loose record type and inspect the `type`
 * discriminant to decide which AgentEvent to produce.
 */
function handleSdkMessage(
  message: SdkMessage,
  outputStream: AgentOutputStream,
  accumulator: { totalCost: number; tokensIn: number; tokensOut: number },
): void {
  const messageType = message.type;

  if (messageType === 'assistant') {
    const content = getString(message.content, '');
    outputStream.text(content);
  } else if (messageType === 'tool_use') {
    const toolName = message.tool_name ?? 'unknown';
    const toolInput = message.tool_input ?? {};
    outputStream.toolUse(toolName, toolInput);
  } else if (messageType === 'tool_result') {
    const content = getString(message.content, '');
    outputStream.toolResult(message.tool_name ?? 'unknown', content);
  }

  // Emit cost updates whenever usage or cost information is present.
  // Some message types (e.g. 'result') carry total_cost_usd without a
  // nested usage object, so we check for cost fields independently.
  const usage = message.usage;
  const hasCostFields =
    typeof message.turn_cost_usd === 'number' || typeof message.total_cost_usd === 'number';

  if (usage || hasCostFields) {
    const turnCost = getNumber(message.turn_cost_usd, 0);
    const totalCost = getNumber(message.total_cost_usd, accumulator.totalCost);

    accumulator.totalCost = totalCost;
    if (usage) {
      accumulator.tokensIn = usage.input_tokens ?? accumulator.tokensIn;
      accumulator.tokensOut = usage.output_tokens ?? accumulator.tokensOut;
    }

    outputStream.costUpdate(turnCost, totalCost);
  }
}

/**
 * Run a prompt using the real Claude Agent SDK.
 *
 * Returns `null` if the SDK is not installed, signaling the caller
 * to use a fallback strategy. Throws an `AgentError` if the SDK is
 * available but the execution fails.
 */
export async function runWithSdk(options: SdkRunnerOptions): Promise<SdkRunResult | null> {
  const sdk = await loadSdk();

  if (!sdk) {
    options.logger.warn('Claude Agent SDK not installed, cannot run real agent');
    return null;
  }

  const {
    prompt,
    agentId,
    machineId,
    sessionId,
    controlPlaneUrl,
    config,
    projectPath,
    logger,
    outputStream,
    abortSignal,
    hooks,
    resumeSessionId,
    onSessionIdResolved,
  } = options;

  const canUseTool = createCanUseToolHandler({
    agentId,
    machineId,
    sessionId,
    permissionMode: config.permissionMode,
    controlPlaneUrl,
    logger,
  });

  const sdkOptions = buildSdkOptions(config, projectPath, resumeSessionId, canUseTool);

  logger.info(
    {
      agentId,
      model: sdkOptions.model,
      maxTurns: sdkOptions.maxTurns,
      ...(resumeSessionId ? { resumeSessionId } : {}),
    },
    resumeSessionId ? 'Resuming Claude Agent SDK session' : 'Starting Claude Agent SDK run',
  );

  const accumulator = {
    totalCost: 0,
    tokensIn: 0,
    tokensOut: 0,
  };
  let resultText = '';
  let finalSessionId = sessionId;

  let totalTurns = 0;
  let stopReason = 'completed';
  // Track per-tool timing for postToolUse durationMs
  let currentToolStart: number | null = null;
  let currentToolName: string | null = null;
  let currentToolInput: Record<string, unknown> | null = null;

  // Strip CLAUDECODE env var so the SDK-spawned Claude Code subprocess
  // doesn't refuse to start with "cannot be launched inside another session".
  const savedClaudeCode = process.env.CLAUDECODE;
  delete process.env.CLAUDECODE;

  try {
    for await (const message of sdk.query({ prompt, options: sdkOptions })) {
      // Check for abort between messages
      if (abortSignal?.aborted) {
        logger.info({ agentId }, 'Agent run aborted by signal');
        stopReason = 'aborted';
        break;
      }

      const messageType = message.type;

      // ── PreToolUse hook: inspect and optionally block tool invocations ──
      if (messageType === 'tool_use' && hooks?.preToolUse) {
        const toolName = message.tool_name ?? 'unknown';
        const toolInput = message.tool_input ?? {};

        const decision = await hooks.preToolUse({
          sessionId: finalSessionId,
          agentId,
          toolName,
          toolInput,
        });

        if (decision === 'deny') {
          // Emit a blocked event so consumers know the tool was denied
          outputStream.toolBlocked(toolName, 'PreToolUse hook');
          // Skip further processing of this tool_use message
          continue;
        }

        // Track tool start for postToolUse duration measurement
        currentToolStart = Date.now();
        currentToolName = toolName;
        currentToolInput = toolInput;
        totalTurns++;
      }

      // ── PostToolUse hook: record completed tool execution ──
      if (messageType === 'tool_result' && hooks?.postToolUse && currentToolName) {
        const toolOutput = getString(message.content, '');
        const durationMs = currentToolStart ? Date.now() - currentToolStart : 0;

        await hooks.postToolUse({
          sessionId: finalSessionId,
          agentId,
          toolName: currentToolName,
          toolInput: currentToolInput ?? {},
          toolOutput,
          durationMs,
        });

        // Reset per-tool tracking
        currentToolStart = null;
        currentToolName = null;
        currentToolInput = null;
      }

      // Capture session ID as early as possible (init, system, or result messages)
      if (message.session_id && message.session_id !== finalSessionId) {
        finalSessionId = message.session_id;
        onSessionIdResolved?.(finalSessionId);
      }

      // Handle the final result message
      if (messageType === 'result') {
        accumulator.totalCost = getNumber(message.total_cost_usd, accumulator.totalCost);
        resultText = message.result ?? '';

        const usage = message.usage;
        if (usage) {
          accumulator.tokensIn = usage.input_tokens ?? accumulator.tokensIn;
          accumulator.tokensOut = usage.output_tokens ?? accumulator.tokensOut;
        }
      }

      // Map and emit the message as AgentEvent(s)
      handleSdkMessage(message, outputStream, accumulator);
    }
  } catch (err) {
    stopReason = 'error';
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ agentId, err }, 'Claude Agent SDK run failed');

    // Fire stop hook even on error so we get a session_end audit entry
    if (hooks?.stop) {
      await hooks
        .stop({
          sessionId: finalSessionId,
          agentId,
          reason: `error: ${message}`,
          totalCostUsd: accumulator.totalCost,
          totalTurns,
        })
        .catch((stopErr: unknown) => {
          logger.warn({ err: stopErr }, 'Stop hook failed after SDK error');
        });
    }

    throw new AgentError('SDK_RUN_FAILED', `Agent SDK run failed: ${message}`, {
      agentId,
      sessionId: finalSessionId,
    });
  } finally {
    // Restore CLAUDECODE env var so it doesn't affect the rest of the process.
    if (savedClaudeCode !== undefined) {
      process.env.CLAUDECODE = savedClaudeCode;
    }
  }

  // ── Stop hook: record session end ──
  if (hooks?.stop) {
    try {
      await hooks.stop({
        sessionId: finalSessionId,
        agentId,
        reason: stopReason,
        totalCostUsd: accumulator.totalCost,
        totalTurns,
      });
    } catch (stopErr) {
      logger.warn({ err: stopErr }, 'Stop hook failed after successful run');
    }
  }

  logger.info(
    {
      agentId,
      sessionId: finalSessionId,
      costUsd: accumulator.totalCost,
      tokensIn: accumulator.tokensIn,
      tokensOut: accumulator.tokensOut,
    },
    'Claude Agent SDK run completed',
  );

  return {
    sessionId: finalSessionId,
    costUsd: accumulator.totalCost,
    tokensIn: accumulator.tokensIn,
    tokensOut: accumulator.tokensOut,
    result: resultText,
  };
}
