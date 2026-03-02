import type { Logger } from 'pino';

import type { AnomalyDetector, AnomalyReport } from './anomaly-detector.js';
import type { AuditLogger } from './audit-logger.js';
import { sha256 } from './audit-logger.js';
import type { ToolRateLimiter } from './tool-rate-limiter.js';

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
  /** Optional rate limiter. When provided, calls exceeding the limit are denied. */
  rateLimiter?: ToolRateLimiter;
  /** Optional anomaly detector. When provided, anomalies are logged and high-severity ones cause denials. */
  anomalyDetector?: AnomalyDetector;
};

/**
 * Create a PreToolUse hook function.
 *
 * The returned function inspects tool invocations through three layers:
 * 1. Rate limiting — denies calls that exceed per-agent rate limits
 * 2. Anomaly detection — flags and optionally blocks unusual patterns
 * 3. Pattern matching — blocks dangerous Bash command patterns
 *
 * All decisions are written to the audit log.
 */
export function createPreToolUseHook(
  options: PreToolUseHookOptions,
): (input: PreToolUseInput) => Promise<PreToolUseResult> {
  const { auditLogger, logger: parentLogger, rateLimiter, anomalyDetector } = options;
  const log = parentLogger.child({ hook: 'pre-tool-use' });

  return async (input: PreToolUseInput): Promise<PreToolUseResult> => {
    const { sessionId, agentId, toolName, toolInput } = input;
    const inputHash = sha256(toolInput);
    let decision: PreToolUseResult = 'allow';
    let denyReason: string | undefined;

    // ── Layer 1: Rate limiting ──────────────────────────────────────
    if (rateLimiter) {
      const rateLimitResult = rateLimiter.check(agentId, toolName);

      if (!rateLimitResult.allowed) {
        decision = 'deny';
        denyReason = `Rate limit exceeded (${rateLimitResult.exceededLimit ?? 'unknown'}). Resets at ${rateLimitResult.resetAt.toISOString()}`;
        log.warn(
          {
            agentId,
            sessionId,
            tool: toolName,
            inputHash,
            exceededLimit: rateLimitResult.exceededLimit,
            resetAt: rateLimitResult.resetAt.toISOString(),
          },
          'Tool call rate-limited',
        );
      }
    }

    // ── Layer 2: Anomaly detection ──────────────────────────────────
    if (anomalyDetector && decision === 'allow') {
      const anomalies: AnomalyReport[] = anomalyDetector.recordCall(agentId, toolName);

      for (const anomaly of anomalies) {
        if (anomaly.severity === 'high') {
          decision = 'deny';
          denyReason = `Anomaly detected: ${anomaly.message}`;
          log.warn(
            {
              agentId,
              sessionId,
              tool: toolName,
              inputHash,
              anomalyType: anomaly.type,
              anomalySeverity: anomaly.severity,
            },
            'High-severity anomaly blocked tool call',
          );
        } else if (anomaly.severity === 'medium') {
          log.warn(
            {
              agentId,
              sessionId,
              tool: toolName,
              inputHash,
              anomalyType: anomaly.type,
              anomalySeverity: anomaly.severity,
            },
            `Anomaly detected: ${anomaly.message}`,
          );
        } else {
          log.info(
            {
              agentId,
              sessionId,
              tool: toolName,
              inputHash,
              anomalyType: anomaly.type,
              anomalySeverity: anomaly.severity,
            },
            `Anomaly detected: ${anomaly.message}`,
          );
        }
      }
    }

    // ── Layer 3: Dangerous pattern matching (Bash only) ─────────────
    if (decision === 'allow' && toolName === 'Bash') {
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
