import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

import { WorkerError } from '@agentctl/shared';
import type { Logger } from 'pino';

import type { AuditEntry } from './audit-logger.js';

const DEFAULT_FLUSH_INTERVAL_MS = 5_000;
const MAX_BATCH_SIZE = 100;
const MAX_AUDIT_BYTES_PER_FLUSH = 1024 * 1024;
const INSECURE_AUDIT_PERMISSION_MASK = 0o022;

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
      const handle = await this.openAuditFileSecurely();
      if (!handle) {
        return;
      }

      try {
        const info = await handle.stat();
        this.assertSecureAuditFile(info);

        if (info.size <= this.byteOffset) {
          return;
        }

        const unreadBytes = info.size - this.byteOffset;
        const bytesToRead = Math.min(unreadBytes, MAX_AUDIT_BYTES_PER_FLUSH);
        const buffer = Buffer.alloc(bytesToRead);
        const { bytesRead } = await handle.read(buffer, 0, bytesToRead, this.byteOffset);

        if (bytesRead === 0) {
          return;
        }

        const chunk = buffer.subarray(0, bytesRead).toString('utf-8');
        const lastNewlineIndex = chunk.lastIndexOf('\n');

        if (lastNewlineIndex === -1) {
          if (unreadBytes > MAX_AUDIT_BYTES_PER_FLUSH) {
            this.byteOffset += bytesRead;
            this.log.warn(
              { bytesSkipped: bytesRead, byteOffset: this.byteOffset },
              'Skipping oversized audit segment without newline',
            );
          }
          return;
        }

        const completeChunk = chunk.slice(0, lastNewlineIndex + 1);
        const lines = completeChunk.split('\n').filter((line) => line.trim().length > 0);

        if (lines.length === 0) {
          this.byteOffset += Buffer.byteLength(completeChunk, 'utf-8');
          return;
        }

        const actions: AuditActionPayload[] = [];

        for (const line of lines) {
          try {
            const entry = JSON.parse(line) as AuditEntry;
            actions.push(toActionPayload(entry));
          } catch {
            this.log.warn({ lineSnippet: line.slice(0, 80) }, 'Skipping malformed audit line');
          }
        }

        // Send in batches respecting MAX_BATCH_SIZE
        for (let i = 0; i < actions.length; i += MAX_BATCH_SIZE) {
          const batch = actions.slice(i, i + MAX_BATCH_SIZE);
          await this.sendBatch(batch);
        }

        this.byteOffset += Buffer.byteLength(completeChunk, 'utf-8');

        this.log.debug(
          { actionsSent: actions.length, byteOffset: this.byteOffset },
          'Audit entries flushed',
        );
      } finally {
        await handle.close();
      }
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
   * Open the audit file using O_NOFOLLOW so the final path component cannot
   * be a symlink. Returns null when the file is not created yet.
   *
   * Security: this open + fstat flow avoids TOCTOU races between a path
   * check and read (js/file-system-race) and rejects symlink targets on
   * predictable temporary paths (js/insecure-temporary-file).
   */
  private async openAuditFileSecurely(): Promise<Awaited<ReturnType<typeof open>> | null> {
    try {
      return await open(this.auditFilePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === 'ENOENT') {
        return null;
      }
      if (nodeErr.code === 'ELOOP') {
        throw new WorkerError(
          'AUDIT_SYMLINK_REJECTED',
          'Audit file path is a symbolic link — refusing to read for security',
          { path: this.auditFilePath },
        );
      }
      throw new WorkerError('AUDIT_OPEN_FAILED', `Failed to open audit file: ${nodeErr.message}`, {
        path: this.auditFilePath,
      });
    }
  }

  private assertSecureAuditFile(info: { mode: number; isFile: () => boolean }): void {
    if (!info.isFile()) {
      throw new WorkerError(
        'AUDIT_INVALID_FILE_TYPE',
        'Audit file path must resolve to a regular file',
        { path: this.auditFilePath },
      );
    }

    if ((info.mode & INSECURE_AUDIT_PERMISSION_MASK) !== 0) {
      throw new WorkerError(
        'AUDIT_INSECURE_PERMISSIONS',
        'Audit file permissions allow group or other writes',
        { path: this.auditFilePath, mode: info.mode },
      );
    }
  }
}
