import type { Logger } from 'pino';

import type { AuditLogger } from './audit-logger.js';
import { sha256 } from './audit-logger.js';

export type PostToolUseInput = {
  sessionId: string;
  agentId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolOutput: string;
  durationMs: number;
};

export type PostToolUseHookOptions = {
  auditLogger: AuditLogger;
  logger: Logger;
};

/**
 * Create a PostToolUse hook function.
 *
 * The returned function records the completed tool invocation in the
 * audit log, including a SHA-256 hash of the output and the elapsed
 * duration. No blocking logic is applied -- this hook is purely for
 * observability.
 */
export function createPostToolUseHook(
  options: PostToolUseHookOptions,
): (input: PostToolUseInput) => Promise<void> {
  const { auditLogger, logger: parentLogger } = options;
  const log = parentLogger.child({ hook: 'post-tool-use' });

  return async (input: PostToolUseInput): Promise<void> => {
    const { sessionId, agentId, toolName, toolInput, toolOutput, durationMs } = input;

    const inputHash = sha256(toolInput);
    const outputHash = sha256(toolOutput);

    log.debug(
      { agentId, sessionId, tool: toolName, inputHash, outputHash, durationMs },
      'Tool use completed',
    );

    await auditLogger.write({
      kind: 'post_tool_use',
      timestamp: new Date().toISOString(),
      sessionId,
      agentId,
      tool: toolName,
      inputHash,
      outputHash,
      durationMs,
    });
  };
}
