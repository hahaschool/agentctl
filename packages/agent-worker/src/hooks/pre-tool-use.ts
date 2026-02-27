import type { Logger } from 'pino';

import type { AuditLogger } from './audit-logger.js';
import { sha256 } from './audit-logger.js';

export type PreToolUseInput = {
  sessionId: string;
  agentId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
};

export type PreToolUseResult = 'allow' | 'deny';

/**
 * Shell patterns that represent destructive or dangerous commands.
 * Matching is case-insensitive and uses `String.includes` against the
 * normalised (lowercased, whitespace-collapsed) command string.
 */
const BLOCKED_PATTERNS: readonly string[] = [
  'rm -rf /',
  'rm -rf /*',
  'curl | sh',
  'curl | bash',
  'wget -o- | bash',
  'wget -o- | sh',
  '> /etc/',
  'mkfs.',
  'dd if=',
  ':(){:|:&};:',
];

/**
 * Patterns that attempt to read secret / credential files.
 */
const SECRET_PATTERNS: readonly string[] = [
  'cat ~/.ssh',
  'cat ~/.aws',
  'cat ~/.gnupg',
  'cat /etc/shadow',
  'cat /etc/passwd',
];

const ALL_BLOCKED = [...BLOCKED_PATTERNS, ...SECRET_PATTERNS];

/**
 * Normalise a command string for pattern matching: lowercase and
 * collapse consecutive whitespace to a single space.
 */
function normalise(command: string): string {
  return command.toLowerCase().replace(/\s+/g, ' ');
}

export type PreToolUseHookOptions = {
  auditLogger: AuditLogger;
  logger: Logger;
};

/**
 * Create a PreToolUse hook function.
 *
 * The returned function inspects Bash tool invocations for dangerous
 * patterns and writes the allow / deny decision to the audit log.
 */
export function createPreToolUseHook(
  options: PreToolUseHookOptions,
): (input: PreToolUseInput) => Promise<PreToolUseResult> {
  const { auditLogger, logger: parentLogger } = options;
  const log = parentLogger.child({ hook: 'pre-tool-use' });

  return async (input: PreToolUseInput): Promise<PreToolUseResult> => {
    const { sessionId, agentId, toolName, toolInput } = input;
    const inputHash = sha256(toolInput);
    let decision: PreToolUseResult = 'allow';
    let denyReason: string | undefined;

    // Only inspect Bash commands for dangerous patterns
    if (toolName === 'Bash') {
      const command = typeof toolInput.command === 'string' ? toolInput.command : '';
      const normalised = normalise(command);

      for (const pattern of ALL_BLOCKED) {
        if (normalised.includes(pattern)) {
          decision = 'deny';
          denyReason = `Blocked pattern detected: "${pattern}"`;
          log.warn(
            { agentId, sessionId, tool: toolName, inputHash, pattern },
            'Dangerous command blocked',
          );
          break;
        }
      }
    }

    if (decision === 'allow') {
      log.debug({ agentId, sessionId, tool: toolName, inputHash }, 'Tool use allowed');
    }

    await auditLogger.write({
      kind: 'pre_tool_use',
      timestamp: new Date().toISOString(),
      sessionId,
      agentId,
      tool: toolName,
      inputHash,
      decision,
      ...(denyReason !== undefined ? { denyReason } : {}),
    });

    return decision;
  };
}
