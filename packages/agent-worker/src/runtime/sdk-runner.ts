import type { AgentConfig, AgentEvent } from '@agentctl/shared';
import { AgentError } from '@agentctl/shared';
import type { Logger } from 'pino';

export type SdkRunnerOptions = {
  prompt: string;
  agentId: string;
  sessionId: string;
  config: AgentConfig;
  projectPath: string;
  logger: Logger;
  onEvent: (event: AgentEvent) => void;
  abortSignal?: AbortSignal;
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

  const { prompt, agentId, sessionId, config, projectPath, logger, onEvent, abortSignal } = options;

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

  try {
    for await (const message of sdk.query({ prompt, options: sdkOptions })) {
      // Check for abort between messages
      if (abortSignal?.aborted) {
        logger.info({ agentId }, 'Agent run aborted by signal');
        break;
      }

      const messageType = message['type'] as string | undefined;

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
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ agentId, err }, 'Claude Agent SDK run failed');

    throw new AgentError('SDK_RUN_FAILED', `Agent SDK run failed: ${message}`, {
      agentId,
      sessionId: finalSessionId,
    });
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
