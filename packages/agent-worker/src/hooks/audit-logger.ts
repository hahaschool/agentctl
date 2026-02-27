import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Logger } from 'pino';

import { WorkerError } from '@agentctl/shared';

/**
 * Discriminated union of audit log entry types.
 * Each variant carries the fields relevant to that hook phase.
 */
export type AuditEntryPreTool = {
  kind: 'pre_tool_use';
  timestamp: string;
  sessionId: string;
  agentId: string;
  tool: string;
  inputHash: string;
  decision: 'allow' | 'deny';
  denyReason?: string;
};

export type AuditEntryPostTool = {
  kind: 'post_tool_use';
  timestamp: string;
  sessionId: string;
  agentId: string;
  tool: string;
  inputHash: string;
  outputHash: string;
  durationMs: number;
};

export type AuditEntrySessionEnd = {
  kind: 'session_end';
  timestamp: string;
  sessionId: string;
  agentId: string;
  reason: string;
  totalCostUsd: number;
  totalTurns: number;
};

export type AuditEntry =
  | AuditEntryPreTool
  | AuditEntryPostTool
  | AuditEntrySessionEnd;

/**
 * Compute a SHA-256 hex digest for an arbitrary value by
 * JSON-stringifying it first.
 */
export function sha256(value: unknown): string {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  return createHash('sha256').update(serialized).digest('hex');
}

/**
 * Return today's date as YYYY-MM-DD for daily log rotation.
 */
function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export type AuditLoggerOptions = {
  logDir?: string;
  logger: Logger;
};

/**
 * Append-only NDJSON audit log writer for agent action trails.
 *
 * Each line written is a self-contained JSON object. Files are rotated
 * daily using the naming pattern `audit-{YYYY-MM-DD}.ndjson`.
 */
export class AuditLogger {
  private readonly logDir: string;
  private readonly log: Logger;
  private currentDate: string;
  private currentPath: string;

  constructor(options: AuditLoggerOptions) {
    this.logDir = options.logDir ?? process.env.AUDIT_LOG_DIR ?? './logs';
    this.log = options.logger.child({ component: 'audit-logger' });
    this.currentDate = todayDateString();
    this.currentPath = this.buildPath(this.currentDate);

    this.ensureDirectory();
  }

  /**
   * Write an audit entry as a single NDJSON line. The method handles
   * daily file rotation transparently.
   */
  async write(entry: AuditEntry): Promise<void> {
    this.rotateIfNeeded();

    const line = JSON.stringify(entry) + '\n';

    try {
      await appendFile(this.currentPath, line, 'utf-8');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error({ err, path: this.currentPath }, 'Failed to write audit entry');
      throw new WorkerError('AUDIT_WRITE_FAILED', `Audit log write failed: ${message}`, {
        path: this.currentPath,
      });
    }
  }

  /**
   * Return the current log file path (useful for testing / diagnostics).
   */
  getLogFilePath(): string {
    return this.currentPath;
  }

  // ── Private helpers ──────────────────────────────────────────────

  private buildPath(dateString: string): string {
    return join(this.logDir, `audit-${dateString}.ndjson`);
  }

  private rotateIfNeeded(): void {
    const today = todayDateString();
    if (today !== this.currentDate) {
      this.log.info({ previousDate: this.currentDate, newDate: today }, 'Rotating audit log file');
      this.currentDate = today;
      this.currentPath = this.buildPath(today);
    }
  }

  private ensureDirectory(): void {
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
      this.log.info({ logDir: this.logDir }, 'Created audit log directory');
    }
  }
}
