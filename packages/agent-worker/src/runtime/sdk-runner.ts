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
  sessionId: string;
  config: AgentConfig;
  projectPath: string;
  logger: Logger;
  outputStream: AgentOutputStream;
  abortSignal?: AbortSignal;
  hooks?: SdkRunnerHooks;
  /** When set, instructs the SDK to resume a previous session instead of starting a fresh one. */
  resumeSessionId?: string;
};

export type SdkRunResult = {
  sessionId: string;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  result: string;
};

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
): Record<string, unknown> {
  return {
    model: config.model ?? 'sonnet',
    maxTurns: config.maxTurns ?? 50,
    permissionMode: config.permissionMode ?? 'acceptEdits',
    ...(config.allowedTools ? { allowedTools: config.allowedTools } : {}),
    ...(config.disallowedTools ? { disallowedTools: config.disallowedTools } : {}),
    ...(config.systemPrompt ? { systemPrompt: config.systemPrompt } : {}),
    ...(resumeSessionId ? { resume: resumeSessionId } : {}),
    cwd: projectPath,
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

  // Emit cost updates whenever usage information is present
  const usage = message.usage;
  if (usage) {
    const turnCost = getNumber(message.turn_cost_usd, 0);
    const totalCost = getNumber(message.total_cost_usd, accumulator.totalCost);

    accumulator.totalCost = totalCost;
    accumulator.tokensIn = usage.input_tokens ?? accumulator.tokensIn;
    accumulator.tokensOut = usage.output_tokens ?? accumulator.tokensOut;

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
    sessionId,
    config,
    projectPath,
    logger,
    outputStream,
    abortSignal,
    hooks,
    resumeSessionId,
  } = options;

  const sdkOptions = buildSdkOptions(config, projectPath, resumeSessionId);

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

      // Handle the final result message
      if (messageType === 'result') {
        accumulator.totalCost = getNumber(message.total_cost_usd, accumulator.totalCost);
        resultText = message.result ?? '';
        finalSessionId = message.session_id ?? finalSessionId;

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
