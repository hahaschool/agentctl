import { type MemoryOpsAuditAction, redactSensitiveKeys } from '@agentctl/shared';
import type { Pool } from 'pg';

export type MemoryOpsAuditEntry = {
  actor: string;
  action: MemoryOpsAuditAction;
  target: string;
  context: Record<string, unknown>;
};

export class MemoryOpsAuditLogger {
  constructor(private readonly pool: Pool) {}

  async write(entry: MemoryOpsAuditEntry): Promise<void> {
    const redactedContext = redactSensitiveKeys(entry.context);
    await this.pool.query(
      `INSERT INTO memory_ops_audit (actor, action, target, context)
       VALUES ($1, $2, $3, $4)`,
      [entry.actor, entry.action, entry.target, JSON.stringify(redactedContext)],
    );
  }
}
