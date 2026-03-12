import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';

import { WorkerError } from '@agentctl/shared';
import type { Logger } from 'pino';

import type { AuditEntry } from './audit-logger.js';

const DEFAULT_FLUSH_INTERVAL_MS = 5_000;
const MAX_BATCH_SIZE = 100;

type AuditActionPayload = {
  actionType: string;
  toolName?: string | null;
  toolInput?: Record<string, unknown> | null;
  toolOutputHash?: string | null;
  durationMs?: number | null;
  approvedBy?: string | null;
};

type AuditReporterOptions = {
  controlPlaneUrl: string;
  runId: string;
  auditFilePath: string;
  logger: Logger;
  flushIntervalMs?: number;
};

/**
 * Map a local NDJSON audit entry to the control-plane action payload.
 * Sensitive fields (raw tool input) are omitted — only the hash is sent.
 */
function toActionPayload(entry: AuditEntry): AuditActionPayload {
  switch (entry.kind) {
    case 'pre_tool_use':
      return {
        actionType: 'pre_tool_use',
        toolName: entry.tool,
        approvedBy: entry.decision === 'allow' ? 'auto' : null,
      };

    case 'post_tool_use':
      return {
        actionType: 'post_tool_use',
        toolName: entry.tool,
        toolOutputHash: entry.outputHash,
        durationMs: entry.durationMs,
      };

    case 'session_end':
      return {
        actionType: 'session_end',
      };
  }
}

/**
 * Lightweight forwarder that tails a local NDJSON audit file and
 * periodically POSTs batches to the control plane.
 *
 * It tracks the byte offset of the last successfully sent line so that
 * entries are never duplicated, even across flush cycles.
 */
export class AuditReporter {
  private timer: ReturnType<typeof setInterval> | null = null;
  private byteOffset = 0;
  private isFlushing = false;
  private readonly controlPlaneUrl: string;
  private readonly runId: string;
  private readonly auditFilePath: string;
  private readonly log: Logger;
  private readonly flushIntervalMs: number;

  constructor(options: AuditReporterOptions) {
    this.controlPlaneUrl = options.controlPlaneUrl;
    this.runId = options.runId;
    this.auditFilePath = options.auditFilePath;
    this.log = options.logger.child({ component: 'audit-reporter', runId: options.runId });
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  }

  /**
   * Begin periodically flushing new audit entries to the control plane.
   */
  start(): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      this.flush().catch((err) => {
        this.log.warn({ err }, 'Audit flush failed');
      });
    }, this.flushIntervalMs);

    this.log.info(
      { flushIntervalMs: this.flushIntervalMs, auditFilePath: this.auditFilePath },
      'Audit reporter started',
    );
  }

  /**
   * Stop the periodic flush timer and perform one final flush attempt.
   */
  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    try {
      await this.flush();
    } catch (err) {
      this.log.warn({ err }, 'Final audit flush during shutdown failed');
    }

    this.log.info('Audit reporter stopped');
  }

  // ── Private helpers ────────────────────────────────────────────────

  /**
   * Read new bytes from the audit file, parse complete NDJSON lines,
   * and POST them in batches to the control plane.
   */
  private async flush(): Promise<void> {
    if (this.isFlushing) {
      return;
    }

    this.isFlushing = true;

    try {
      const fileSize = await this.getFileSize();

      if (fileSize === null || fileSize <= this.byteOffset) {
        return;
      }

      const newBytes = fileSize - this.byteOffset;
      const buffer = Buffer.alloc(newBytes);
      // Security: use O_NOFOLLOW to prevent symlink attacks on predictable audit
      // file paths (js/insecure-temporary-file). This ensures we only read the
      // actual audit file and not a symlink planted by an attacker.
      const handle = await open(this.auditFilePath, constants.O_RDONLY | constants.O_NOFOLLOW);

      try {
        await handle.read(buffer, 0, newBytes, this.byteOffset);
      } finally {
        await handle.close();
      }

      const chunk = buffer.toString('utf-8');
      const lines = chunk.split('\n').filter((line) => line.trim().length > 0);

      if (lines.length === 0) {
        this.byteOffset = fileSize;
        return;
      }

      const actions: AuditActionPayload[] = [];
      let parsedBytes = 0;

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as AuditEntry;
          actions.push(toActionPayload(entry));
          // +1 for the newline character
          parsedBytes += Buffer.byteLength(line, 'utf-8') + 1;
        } catch {
          this.log.warn({ lineSnippet: line.slice(0, 80) }, 'Skipping malformed audit line');
          parsedBytes += Buffer.byteLength(line, 'utf-8') + 1;
        }
      }

      // Send in batches respecting MAX_BATCH_SIZE
      for (let i = 0; i < actions.length; i += MAX_BATCH_SIZE) {
        const batch = actions.slice(i, i + MAX_BATCH_SIZE);
        await this.sendBatch(batch);
      }

      this.byteOffset += parsedBytes;

      this.log.debug(
        { actionsSent: actions.length, byteOffset: this.byteOffset },
        'Audit entries flushed',
      );
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * POST a batch of actions to the control plane audit endpoint.
   */
  private async sendBatch(actions: AuditActionPayload[]): Promise<void> {
    const url = `${this.controlPlaneUrl}/api/audit/actions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: this.runId, actions }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '<unreadable>');
      throw new WorkerError(
        'AUDIT_REPORT_FAILED',
        `Control plane returned ${response.status}: ${body}`,
        { runId: this.runId, actionCount: actions.length },
      );
    }
  }

  /**
   * Safely lstat the audit file, returning null if it does not exist yet.
   *
   * Security: uses lstat (not stat) so that symlinks are detected rather
   * than followed. If the path is a symbolic link, the reporter refuses
   * to read it — preventing a local attacker from redirecting audit reads
   * to an arbitrary file (js/insecure-temporary-file).
   */
  private async getFileSize(): Promise<number | null> {
    try {
      const info = await lstat(this.auditFilePath);

      if (info.isSymbolicLink()) {
        throw new WorkerError(
          'AUDIT_SYMLINK_REJECTED',
          'Audit file path is a symbolic link — refusing to read for security',
          { path: this.auditFilePath },
        );
      }

      return info.size;
    } catch (err) {
      if (err instanceof WorkerError) {
        throw err;
      }
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === 'ENOENT') {
        return null;
      }
      throw new WorkerError('AUDIT_STAT_FAILED', `Failed to stat audit file: ${nodeErr.message}`, {
        path: this.auditFilePath,
      });
    }
  }
}
