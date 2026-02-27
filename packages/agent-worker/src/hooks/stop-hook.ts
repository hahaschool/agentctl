import type { Logger } from 'pino';

import type { AuditLogger } from './audit-logger.js';

export type StopInput = {
  sessionId: string;
  agentId: string;
  reason: string;
  totalCostUsd: number;
  totalTurns: number;
};

export type StopHookOptions = {
  auditLogger: AuditLogger;
  logger: Logger;
};

/**
 * Create a Stop hook function.
 *
 * The returned function writes a final session-end summary line to the
 * audit log containing cost, turn count, and termination reason.
 */
export function createStopHook(options: StopHookOptions): (input: StopInput) => Promise<void> {
  const { auditLogger, logger: parentLogger } = options;
  const log = parentLogger.child({ hook: 'stop' });

  return async (input: StopInput): Promise<void> => {
    const { sessionId, agentId, reason, totalCostUsd, totalTurns } = input;

    log.info({ agentId, sessionId, reason, totalCostUsd, totalTurns }, 'Agent session ended');

    await auditLogger.write({
      kind: 'session_end',
      timestamp: new Date().toISOString(),
      sessionId,
      agentId,
      reason,
      totalCostUsd,
      totalTurns,
    });
  };
}
