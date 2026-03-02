import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WorkerError } from '@agentctl/shared';
import type { Logger } from 'pino';

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

export type AuditEntry = AuditEntryPreTool | AuditEntryPostTool | AuditEntrySessionEnd;

/**
 * An audit entry as written to disk, including hash chain fields.
 */
export type HashedAuditEntry = AuditEntry & {
  previousHash: string;
  hash: string;
};

/** Sentinel value used as the previousHash for the first entry in a chain. */
export const GENESIS_HASH = 'genesis';

/**
 * Compute a SHA-256 hex digest for an arbitrary value by
 * JSON-stringifying it first.
 */
export function sha256(value: unknown): string {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  return createHash('sha256').update(serialized).digest('hex');
}

/**
 * Compute the hash chain value for an audit entry.
 * The hash is SHA-256(JSON.stringify(entry) + previousHash).
 */
export function computeEntryHash(entry: AuditEntry, previousHash: string): string {
  return sha256(JSON.stringify(entry) + previousHash);
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
 * Result of an integrity verification check.
 */
export type IntegrityResult = {
  valid: boolean;
  entriesChecked: number;
  error?: string;
  /** Zero-based line index where the chain broke, if applicable. */
  brokenAtLine?: number;
};

/**
 * Append-only NDJSON audit log writer for agent action trails.
 *
 * Each line written is a self-contained JSON object with SHA-256 hash
 * chain integrity. Files are rotated daily using the naming pattern
 * `audit-{YYYY-MM-DD}.ndjson`.
 *
 * Hash chain: each entry includes a `previousHash` field and a `hash`
 * field. The hash is `SHA-256(JSON.stringify(entry) + previousHash)`.
 * The first entry in a file uses `"genesis"` as the previous hash.
 */
export class AuditLogger {
  private readonly logDir: string;
  private readonly log: Logger;
  private currentDate: string;
  private currentPath: string;
  private previousHash: string;

  constructor(options: AuditLoggerOptions) {
    this.logDir = options.logDir ?? process.env.AUDIT_LOG_DIR ?? './logs';
    this.log = options.logger.child({ component: 'audit-logger' });
    this.currentDate = todayDateString();
    this.currentPath = this.buildPath(this.currentDate);
    this.previousHash = GENESIS_HASH;

    this.ensureDirectory();
  }

  /**
   * Write an audit entry as a single NDJSON line with hash chain.
   * The method handles daily file rotation transparently.
   */
  async write(entry: AuditEntry): Promise<void> {
    this.rotateIfNeeded();

    const hash = computeEntryHash(entry, this.previousHash);
    const hashedEntry: HashedAuditEntry = {
      ...entry,
      previousHash: this.previousHash,
      hash,
    };

    const line = `${JSON.stringify(hashedEntry)}\n`;

    try {
      await appendFile(this.currentPath, line, 'utf-8');
      this.previousHash = hash;
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

  /**
   * Verify the hash chain integrity of an NDJSON audit file.
   *
   * Reads every line, recomputes each hash from the entry content and
   * the previous hash, and checks that it matches the stored hash.
   *
   * @returns An IntegrityResult indicating whether the chain is valid.
   */
  static async verifyIntegrity(filePath: string): Promise<IntegrityResult> {
    let content: string;

    try {
      content = await readFile(filePath, 'utf-8');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { valid: false, entriesChecked: 0, error: `Failed to read file: ${message}` };
    }

    const lines = content.split('\n').filter((line) => line.trim().length > 0);

    if (lines.length === 0) {
      return { valid: true, entriesChecked: 0 };
    }

    let expectedPreviousHash = GENESIS_HASH;

    for (let i = 0; i < lines.length; i++) {
      let parsed: HashedAuditEntry;

      try {
        parsed = JSON.parse(lines[i]) as HashedAuditEntry;
      } catch {
        return {
          valid: false,
          entriesChecked: i,
          error: `Malformed JSON at line ${i}`,
          brokenAtLine: i,
        };
      }

      // Check that previousHash matches what we expect
      if (parsed.previousHash !== expectedPreviousHash) {
        return {
          valid: false,
          entriesChecked: i,
          error: `Previous hash mismatch at line ${i}: expected "${expectedPreviousHash}", got "${parsed.previousHash}"`,
          brokenAtLine: i,
        };
      }

      // Recompute the hash from the entry content (without hash/previousHash)
      const { hash: storedHash, previousHash: _prevHash, ...entryContent } = parsed;
      const recomputedHash = computeEntryHash(entryContent as AuditEntry, expectedPreviousHash);

      if (recomputedHash !== storedHash) {
        return {
          valid: false,
          entriesChecked: i,
          error: `Hash mismatch at line ${i}: expected "${recomputedHash}", got "${storedHash}"`,
          brokenAtLine: i,
        };
      }

      expectedPreviousHash = storedHash;
    }

    return { valid: true, entriesChecked: lines.length };
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
      // Reset hash chain for new file
      this.previousHash = GENESIS_HASH;
    }
  }

  private ensureDirectory(): void {
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
      this.log.info({ logDir: this.logDir }, 'Created audit log directory');
    }
  }
}
