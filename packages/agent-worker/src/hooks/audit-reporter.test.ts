import type { FileHandle } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../test-helpers.js';
import type { AuditEntry } from './audit-logger.js';
import { AuditReporter } from './audit-reporter.js';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('node:fs/promises', () => ({
  lstat: vi.fn(),
  open: vi.fn(),
}));

// Re-import the mocked functions so we can control them per test.
import { lstat, open } from 'node:fs/promises';

const mockLstat = vi.mocked(lstat);
const mockOpen = vi.mocked(open);

const mockLogger = createMockLogger();

// ── Global fetch mock ──────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── Helpers ────────────────────────────────────────────────────────────

type ReporterOverrides = {
  controlPlaneUrl?: string;
  runId?: string;
  auditFilePath?: string;
  flushIntervalMs?: number;
};

function makeReporter(overrides?: ReporterOverrides): AuditReporter {
  return new AuditReporter({
    controlPlaneUrl: overrides?.controlPlaneUrl ?? 'http://localhost:4000',
    runId: overrides?.runId ?? 'run-123',
    auditFilePath: overrides?.auditFilePath ?? '/tmp/audit.ndjson',
    logger: mockLogger,
    flushIntervalMs: overrides?.flushIntervalMs ?? 1_000,
  });
}

function makePreToolEntry(overrides?: Partial<AuditEntry>): AuditEntry {
  return {
    kind: 'pre_tool_use',
    timestamp: '2026-03-02T00:00:00.000Z',
    sessionId: 'session-1',
    agentId: 'agent-1',
    tool: 'Bash',
    inputHash: 'abc123',
    decision: 'allow',
    ...overrides,
  } as AuditEntry;
}

function makePostToolEntry(overrides?: Partial<AuditEntry>): AuditEntry {
  return {
    kind: 'post_tool_use',
    timestamp: '2026-03-02T00:00:01.000Z',
    sessionId: 'session-1',
    agentId: 'agent-1',
    tool: 'Bash',
    inputHash: 'abc123',
    outputHash: 'def456',
    durationMs: 42,
    ...overrides,
  } as AuditEntry;
}

function makeSessionEndEntry(): AuditEntry {
  return {
    kind: 'session_end',
    timestamp: '2026-03-02T00:01:00.000Z',
    sessionId: 'session-1',
    agentId: 'agent-1',
    reason: 'completed',
    totalCostUsd: 0.05,
    totalTurns: 3,
  };
}

/**
 * Build a Buffer from NDJSON lines and set up the mock lstat and
 * open to return it from the given byte offset.
 */
function setupAuditFile(entries: AuditEntry[], startOffset = 0): Buffer {
  const ndjson = `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`;
  const buf = Buffer.from(ndjson, 'utf-8');

  mockLstat.mockResolvedValue({
    size: startOffset + buf.byteLength,
    isSymbolicLink: () => false,
  } as ReturnType<typeof lstat> extends Promise<infer T> ? T : never);

  const mockHandle = {
    read: vi.fn().mockImplementation((target: Buffer, _tOffset: number, length: number) => {
      buf.copy(target, 0, 0, length);
      return Promise.resolve({ bytesRead: length, buffer: target });
    }),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as FileHandle;

  mockOpen.mockResolvedValue(mockHandle);

  return buf;
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('AuditReporter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true } as Response);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Constructor ────────────────────────────────────────────────────

  describe('constructor', () => {
    it('accepts options and initializes state', () => {
      const reporter = makeReporter({
        controlPlaneUrl: 'http://cp:4000',
        runId: 'run-abc',
        auditFilePath: '/var/log/audit.ndjson',
        flushIntervalMs: 2_000,
      });

      expect(reporter).toBeInstanceOf(AuditReporter);
    });

    it('uses default flush interval when not specified', () => {
      const reporter = new AuditReporter({
        controlPlaneUrl: 'http://localhost:4000',
        runId: 'run-1',
        auditFilePath: '/tmp/audit.ndjson',
        logger: mockLogger,
      });

      expect(reporter).toBeInstanceOf(AuditReporter);
    });
  });

  // ── start() ────────────────────────────────────────────────────────

  describe('start()', () => {
    it('begins periodic flush on the configured interval', async () => {
      const reporter = makeReporter({ flushIntervalMs: 1_000 });
      mockLstat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      reporter.start();

      await vi.advanceTimersByTimeAsync(1_000);

      expect(mockLstat).toHaveBeenCalledTimes(1);
    });

    it('is idempotent when called multiple times', async () => {
      const reporter = makeReporter({ flushIntervalMs: 1_000 });
      mockLstat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      reporter.start();
      reporter.start();

      await vi.advanceTimersByTimeAsync(1_000);

      expect(mockLstat).toHaveBeenCalledTimes(1);
    });

    it('logs a start message', () => {
      const reporter = makeReporter();
      reporter.start();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ flushIntervalMs: 1_000, auditFilePath: '/tmp/audit.ndjson' }),
        'Audit reporter started',
      );
    });
  });

  // ── stop() ─────────────────────────────────────────────────────────

  describe('stop()', () => {
    it('performs a final flush and clears the interval', async () => {
      const entry = makePreToolEntry();
      setupAuditFile([entry]);

      const reporter = makeReporter();
      reporter.start();

      await reporter.stop();

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('logs a stop message', async () => {
      mockLstat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      const reporter = makeReporter();
      reporter.start();
      await reporter.stop();

      expect(mockLogger.info).toHaveBeenCalledWith('Audit reporter stopped');
    });

    it('does not crash if the final flush fails', async () => {
      mockLstat.mockRejectedValue(new Error('disk failure'));

      const reporter = makeReporter();
      reporter.start();

      await expect(reporter.stop()).resolves.toBeUndefined();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining('Final audit flush during shutdown failed'),
      );
    });

    it('no longer flushes after stop is called', async () => {
      mockLstat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      const reporter = makeReporter({ flushIntervalMs: 500 });
      reporter.start();
      await reporter.stop();

      vi.clearAllMocks();

      await vi.advanceTimersByTimeAsync(2_000);

      expect(mockLstat).not.toHaveBeenCalled();
    });
  });

  // ── Flush logic ────────────────────────────────────────────────────

  describe('flush logic', () => {
    it('reads NDJSON file from last offset and POSTs batch to control plane', async () => {
      const entries = [makePreToolEntry(), makePostToolEntry()];
      setupAuditFile(entries);

      const reporter = makeReporter();
      reporter.start();

      await vi.advanceTimersByTimeAsync(1_000);

      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, fetchOptions] = mockFetch.mock.calls[0];

      expect(url).toBe('http://localhost:4000/api/audit/actions');
      expect(fetchOptions.method).toBe('POST');
      expect(fetchOptions.headers).toEqual({ 'Content-Type': 'application/json' });

      const body = JSON.parse(fetchOptions.body);

      expect(body.runId).toBe('run-123');
      expect(body.actions).toHaveLength(2);
      expect(body.actions[0]).toEqual({
        actionType: 'pre_tool_use',
        toolName: 'Bash',
        approvedBy: 'auto',
      });
      expect(body.actions[1]).toEqual({
        actionType: 'post_tool_use',
        toolName: 'Bash',
        toolOutputHash: 'def456',
        durationMs: 42,
      });
    });

    it('maps session_end entries correctly', async () => {
      const entries = [makeSessionEndEntry()];
      setupAuditFile(entries);

      const reporter = makeReporter();
      reporter.start();

      await vi.advanceTimersByTimeAsync(1_000);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);

      expect(body.actions).toHaveLength(1);
      expect(body.actions[0]).toEqual({ actionType: 'session_end' });
    });

    it('maps denied pre_tool_use with approvedBy null', async () => {
      const entries = [
        makePreToolEntry({
          decision: 'deny',
          denyReason: 'blocked',
        } as unknown as Partial<AuditEntry>),
      ];
      setupAuditFile(entries);

      const reporter = makeReporter();
      reporter.start();

      await vi.advanceTimersByTimeAsync(1_000);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);

      expect(body.actions[0].approvedBy).toBeNull();
    });

    it('skips malformed JSON lines without crashing', async () => {
      const goodEntry = makePreToolEntry();
      const ndjson = `${JSON.stringify(goodEntry)}\nnot-valid-json\n`;
      const buf = Buffer.from(ndjson, 'utf-8');

      mockLstat.mockResolvedValue({
        size: buf.byteLength,
        isSymbolicLink: () => false,
      } as ReturnType<typeof lstat> extends Promise<infer T> ? T : never);

      const mockHandle = {
        read: vi.fn().mockImplementation((target: Buffer) => {
          buf.copy(target, 0, 0, buf.byteLength);
          return Promise.resolve({ bytesRead: buf.byteLength, buffer: target });
        }),
        close: vi.fn().mockResolvedValue(undefined),
      } as unknown as FileHandle;

      mockOpen.mockResolvedValue(mockHandle);

      const reporter = makeReporter();
      reporter.start();

      await vi.advanceTimersByTimeAsync(1_000);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.actions).toHaveLength(1);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ lineSnippet: 'not-valid-json' }),
        'Skipping malformed audit line',
      );
    });
  });

  // ── Offset tracking ────────────────────────────────────────────────

  describe('offset tracking', () => {
    it('remembers file position between flushes', async () => {
      const entry1 = makePreToolEntry();
      const line1 = `${JSON.stringify(entry1)}\n`;
      const firstChunkSize = Buffer.byteLength(line1, 'utf-8');

      const entry2 = makePostToolEntry();
      const line2 = `${JSON.stringify(entry2)}\n`;
      const secondChunkSize = Buffer.byteLength(line2, 'utf-8');

      const buf1 = Buffer.from(line1, 'utf-8');
      mockLstat.mockResolvedValueOnce({
        size: firstChunkSize,
        isSymbolicLink: () => false,
      } as ReturnType<typeof lstat> extends Promise<infer T> ? T : never);

      const mockHandle1 = {
        read: vi.fn().mockImplementation((target: Buffer) => {
          buf1.copy(target, 0, 0, buf1.byteLength);
          return Promise.resolve({ bytesRead: buf1.byteLength, buffer: target });
        }),
        close: vi.fn().mockResolvedValue(undefined),
      } as unknown as FileHandle;
      mockOpen.mockResolvedValueOnce(mockHandle1);

      const reporter = makeReporter();
      reporter.start();

      await vi.advanceTimersByTimeAsync(1_000);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body1 = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body1.actions).toHaveLength(1);
      expect(body1.actions[0].actionType).toBe('pre_tool_use');

      const buf2 = Buffer.from(line2, 'utf-8');
      mockLstat.mockResolvedValueOnce({
        size: firstChunkSize + secondChunkSize,
        isSymbolicLink: () => false,
      } as ReturnType<typeof lstat> extends Promise<infer T> ? T : never);

      const mockHandle2 = {
        read: vi.fn().mockImplementation((target: Buffer, _tOffset: number, length: number) => {
          buf2.copy(target, 0, 0, length);
          return Promise.resolve({ bytesRead: length, buffer: target });
        }),
        close: vi.fn().mockResolvedValue(undefined),
      } as unknown as FileHandle;
      mockOpen.mockResolvedValueOnce(mockHandle2);

      await vi.advanceTimersByTimeAsync(1_000);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const body2 = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(body2.actions).toHaveLength(1);
      expect(body2.actions[0].actionType).toBe('post_tool_use');
    });

    it('does not re-send entries on subsequent flushes', async () => {
      const entries = [makePreToolEntry()];
      const buf = setupAuditFile(entries);
      const fileSize = buf.byteLength;

      const reporter = makeReporter();
      reporter.start();

      await vi.advanceTimersByTimeAsync(1_000);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      mockLstat.mockResolvedValueOnce({
        size: fileSize,
        isSymbolicLink: () => false,
      } as ReturnType<typeof lstat> extends Promise<infer T> ? T : never);

      await vi.advanceTimersByTimeAsync(1_000);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  // ── Batch size ─────────────────────────────────────────────────────

  describe('batch size', () => {
    it('respects max batch size of 100 and splits into multiple requests', async () => {
      const entries: AuditEntry[] = [];
      for (let i = 0; i < 150; i++) {
        entries.push(makePreToolEntry());
      }
      setupAuditFile(entries);

      const reporter = makeReporter();
      reporter.start();

      await vi.advanceTimersByTimeAsync(1_000);

      expect(mockFetch).toHaveBeenCalledTimes(2);

      const body1 = JSON.parse(mockFetch.mock.calls[0][1].body);
      const body2 = JSON.parse(mockFetch.mock.calls[1][1].body);

      expect(body1.actions).toHaveLength(100);
      expect(body2.actions).toHaveLength(50);
    });

    it('sends exactly one batch when entries equal max batch size', async () => {
      const entries: AuditEntry[] = [];
      for (let i = 0; i < 100; i++) {
        entries.push(makePreToolEntry());
      }
      setupAuditFile(entries);

      const reporter = makeReporter();
      reporter.start();

      await vi.advanceTimersByTimeAsync(1_000);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.actions).toHaveLength(100);
    });
  });

  // ── HTTP errors ────────────────────────────────────────────────────

  describe('HTTP errors', () => {
    it('logs a warning on POST failure and does not crash', async () => {
      const entries = [makePreToolEntry()];
      setupAuditFile(entries);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: () => Promise.resolve('Service Unavailable'),
      } as unknown as Response);

      const reporter = makeReporter();
      reporter.start();

      await vi.advanceTimersByTimeAsync(1_000);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Audit flush failed',
      );
    });

    it('handles unreadable response body gracefully', async () => {
      const entries = [makePreToolEntry()];
      setupAuditFile(entries);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.reject(new Error('stream error')),
      } as unknown as Response);

      const reporter = makeReporter();
      reporter.start();

      await vi.advanceTimersByTimeAsync(1_000);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Audit flush failed',
      );
    });

    it('continues flushing on subsequent intervals after an HTTP error', async () => {
      const entry1 = makePreToolEntry();
      const line1 = `${JSON.stringify(entry1)}\n`;
      const chunk1Size = Buffer.byteLength(line1, 'utf-8');
      const buf1 = Buffer.from(line1, 'utf-8');

      mockLstat.mockResolvedValueOnce({
        size: chunk1Size,
        isSymbolicLink: () => false,
      } as ReturnType<typeof lstat> extends Promise<infer T> ? T : never);

      const mockHandle1 = {
        read: vi.fn().mockImplementation((target: Buffer) => {
          buf1.copy(target, 0, 0, buf1.byteLength);
          return Promise.resolve({ bytesRead: buf1.byteLength, buffer: target });
        }),
        close: vi.fn().mockResolvedValue(undefined),
      } as unknown as FileHandle;
      mockOpen.mockResolvedValueOnce(mockHandle1);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 502,
        text: () => Promise.resolve('Bad Gateway'),
      } as unknown as Response);

      const reporter = makeReporter();
      reporter.start();

      await vi.advanceTimersByTimeAsync(1_000);

      expect(mockLogger.warn).toHaveBeenCalled();

      mockLstat.mockResolvedValueOnce({
        size: chunk1Size,
        isSymbolicLink: () => false,
      } as ReturnType<typeof lstat> extends Promise<infer T> ? T : never);
      mockOpen.mockResolvedValueOnce(mockHandle1);
      mockFetch.mockResolvedValueOnce({ ok: true } as Response);

      await vi.advanceTimersByTimeAsync(1_000);

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  // ── Empty file ─────────────────────────────────────────────────────

  describe('empty file', () => {
    it('no-ops when file size equals current offset (no new entries)', async () => {
      mockLstat.mockResolvedValue({
        size: 0,
        isSymbolicLink: () => false,
      } as ReturnType<typeof lstat> extends Promise<infer T> ? T : never);

      const reporter = makeReporter();
      reporter.start();

      await vi.advanceTimersByTimeAsync(1_000);

      expect(mockOpen).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('no-ops when file contains only whitespace after offset', async () => {
      const ndjson = '\n\n  \n';
      const buf = Buffer.from(ndjson, 'utf-8');

      mockLstat.mockResolvedValue({
        size: buf.byteLength,
        isSymbolicLink: () => false,
      } as ReturnType<typeof lstat> extends Promise<infer T> ? T : never);

      const mockHandle = {
        read: vi.fn().mockImplementation((target: Buffer) => {
          buf.copy(target, 0, 0, buf.byteLength);
          return Promise.resolve({ bytesRead: buf.byteLength, buffer: target });
        }),
        close: vi.fn().mockResolvedValue(undefined),
      } as unknown as FileHandle;
      mockOpen.mockResolvedValue(mockHandle);

      const reporter = makeReporter();
      reporter.start();

      await vi.advanceTimersByTimeAsync(1_000);

      expect(mockOpen).toHaveBeenCalledTimes(1);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ── File not found ─────────────────────────────────────────────────

  describe('file not found', () => {
    it('handles gracefully when audit file does not exist yet', async () => {
      mockLstat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      const reporter = makeReporter();
      reporter.start();

      await vi.advanceTimersByTimeAsync(1_000);

      expect(mockOpen).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('does not log a warning for ENOENT (file not yet created)', async () => {
      mockLstat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      const reporter = makeReporter();
      reporter.start();

      await vi.advanceTimersByTimeAsync(1_000);

      expect(mockLogger.warn).not.toHaveBeenCalledWith(expect.anything(), 'Audit flush failed');
    });

    it('propagates non-ENOENT stat errors as flush failures', async () => {
      mockLstat.mockRejectedValue(Object.assign(new Error('EACCES'), { code: 'EACCES' }));

      const reporter = makeReporter();
      reporter.start();

      await vi.advanceTimersByTimeAsync(1_000);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Audit flush failed',
      );
    });
  });

  // ── Symlink rejection ──────────────────────────────────────────────

  describe('symlink rejection', () => {
    it('rejects audit file path that is a symbolic link', async () => {
      mockLstat.mockResolvedValue({
        size: 100,
        isSymbolicLink: () => true,
      } as ReturnType<typeof lstat> extends Promise<infer T> ? T : never);

      const reporter = makeReporter();
      reporter.start();

      await vi.advanceTimersByTimeAsync(1_000);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Audit flush failed',
      );

      expect(mockOpen).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ── Concurrency guard ──────────────────────────────────────────────

  describe('concurrency guard', () => {
    it('does not run overlapping flushes', async () => {
      let resolveLstatPromise:
        | ((value: { size: number; isSymbolicLink: () => boolean }) => void)
        | undefined;
      const slowLstatPromise = new Promise<{ size: number; isSymbolicLink: () => boolean }>(
        (resolve) => {
          resolveLstatPromise = resolve;
        },
      );

      mockLstat.mockReturnValueOnce(slowLstatPromise as ReturnType<typeof lstat>);

      const reporter = makeReporter({ flushIntervalMs: 100 });
      reporter.start();

      await vi.advanceTimersByTimeAsync(100);

      mockLstat.mockResolvedValueOnce({
        size: 0,
        isSymbolicLink: () => false,
      } as ReturnType<typeof lstat> extends Promise<infer T> ? T : never);

      await vi.advanceTimersByTimeAsync(100);

      expect(mockLstat).toHaveBeenCalledTimes(1);

      resolveLstatPromise?.({ size: 0, isSymbolicLink: () => false });
      await vi.advanceTimersByTimeAsync(0);

      await vi.advanceTimersByTimeAsync(100);
      expect(mockLstat).toHaveBeenCalledTimes(2);
    });
  });
});
