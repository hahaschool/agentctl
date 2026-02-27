import type { AgentConfig, AgentEvent } from '@agentctl/shared';
import { AgentError } from '@agentctl/shared';
import type { Logger } from 'pino';

import type { PostToolUseInput } from '../hooks/post-tool-use.js';
import type { PreToolUseInput, PreToolUseResult } from '../hooks/pre-tool-use.js';
import type { StopInput } from '../hooks/stop-hook.js';

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
  onEvent: (event: AgentEvent) => void;
  abortSignal?: AbortSignal;
  hooks?: SdkRunnerHooks;
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
  query: (args: {
    prompt: string;
    options: Record<string, unknown>;
  }) => AsyncIterable<Record<string, unknown>>;
};

/**
 * Attempt to dynamically import the Claude Agent SDK.
 * Returns null if the SDK is not installed, allowing the caller
 * to fall back to alternative behavior (e.g., stub simulation).
 */
async function loadSdk(): Promise<ClaudeAgentSdk | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = await (import('@anthropic-ai/claude-agent-sdk' as string) as Promise<
      Record<string, unknown>
    >);
    const queryFn =
      mod['query'] ?? (mod['default'] as Record<string, unknown> | undefined)?.['query'];
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
 */
function buildSdkOptions(config: AgentConfig, projectPath: string): Record<string, unknown> {
  return {
    model: config.model ?? 'sonnet',
    maxTurns: config.maxTurns ?? 50,
    permissionMode: config.permissionMode ?? 'acceptEdits',
    ...(config.allowedTools ? { allowedTools: config.allowedTools } : {}),
    ...(config.disallowedTools ? { disallowedTools: config.disallowedTools } : {}),
    ...(config.systemPrompt ? { systemPrompt: config.systemPrompt } : {}),
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
  message: Record<string, unknown>,
  onEvent: (event: AgentEvent) => void,
  accumulator: { totalCost: number; tokensIn: number; tokensOut: number },
): void {
  const messageType = message['type'] as string | undefined;

  if (messageType === 'assistant') {
    const content = (message['content'] as string) ?? '';
    const outputEvent: AgentEvent = {
      event: 'output',
      data: { type: 'text', content },
    };
    onEvent(outputEvent);
  } else if (messageType === 'tool_use') {
    const toolName = (message['tool_name'] as string) ?? 'unknown';
    const toolInput = message['tool_input'] ?? {};
    const outputEvent: AgentEvent = {
      event: 'output',
      data: {
        type: 'tool_use',
        content: JSON.stringify({ tool: toolName, input: toolInput }),
      },
    };
    onEvent(outputEvent);
  } else if (messageType === 'tool_result') {
    const content = (message['content'] as string) ?? '';
    const outputEvent: AgentEvent = {
      event: 'output',
      data: { type: 'tool_result', content },
    };
    onEvent(outputEvent);
  }

  // Emit cost updates whenever usage information is present
  const usage = message['usage'] as Record<string, number> | undefined;
  if (usage) {
    const turnCost = (message['turn_cost_usd'] as number) ?? 0;
    const totalCost = (message['total_cost_usd'] as number) ?? accumulator.totalCost;

    accumulator.totalCost = totalCost;
    accumulator.tokensIn = usage['input_tokens'] ?? accumulator.tokensIn;
    accumulator.tokensOut = usage['output_tokens'] ?? accumulator.tokensOut;

    const costEvent: AgentEvent = {
      event: 'cost',
      data: { turnCost, totalCost },
    };
    onEvent(costEvent);
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

  const { prompt, agentId, sessionId, config, projectPath, logger, onEvent, abortSignal, hooks } =
    options;

  const sdkOptions = buildSdkOptions(config, projectPath);

  logger.info(
    { agentId, model: sdkOptions['model'], maxTurns: sdkOptions['maxTurns'] },
    'Starting Claude Agent SDK run',
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

      const messageType = message['type'] as string | undefined;

      // ── PreToolUse hook: inspect and optionally block tool invocations ──
      if (messageType === 'tool_use' && hooks?.preToolUse) {
        const toolName = (message['tool_name'] as string) ?? 'unknown';
        const toolInput = (message['tool_input'] as Record<string, unknown>) ?? {};

        const decision = await hooks.preToolUse({
          sessionId: finalSessionId,
          agentId,
          toolName,
          toolInput,
        });

        if (decision === 'deny') {
          // Emit a blocked event so consumers know the tool was denied
          const blockedEvent: AgentEvent = {
            event: 'output',
            data: {
              type: 'tool_blocked',
              content: `Tool '${toolName}' was blocked by PreToolUse hook`,
            },
          };
          onEvent(blockedEvent);
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
        const toolOutput = (message['content'] as string) ?? '';
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
        accumulator.totalCost = (message['total_cost_usd'] as number) ?? accumulator.totalCost;
        resultText = (message['result'] as string) ?? '';
        finalSessionId = (message['session_id'] as string) ?? finalSessionId;

        const usage = message['usage'] as Record<string, number> | undefined;
        if (usage) {
          accumulator.tokensIn = usage['input_tokens'] ?? accumulator.tokensIn;
          accumulator.tokensOut = usage['output_tokens'] ?? accumulator.tokensOut;
        }
      }

      // Map and emit the message as AgentEvent(s)
      handleSdkMessage(message, onEvent, accumulator);
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
