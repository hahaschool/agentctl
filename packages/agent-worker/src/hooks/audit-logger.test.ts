import { createHash } from 'node:crypto';

import { WorkerError } from '@agentctl/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../test-helpers.js';
import {
  type AuditEntryPostTool,
  type AuditEntryPreTool,
  type AuditEntrySessionEnd,
  AuditLogger,
  computeEntryHash,
  GENESIS_HASH,
  sha256,
} from './audit-logger.js';

// ── Mock fs ─────────────────────────────────────────────────────────

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  appendFile: vi.fn(),
  readFile: vi.fn(),
}));

import { existsSync, mkdirSync } from 'node:fs';
import { appendFile, readFile } from 'node:fs/promises';

const mockExistsSync = vi.mocked(existsSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockAppendFile = vi.mocked(appendFile);
const mockReadFile = vi.mocked(readFile);

// ── Mock logger ─────────────────────────────────────────────────────

const mockLogger = createMockLogger();

// ── Helpers ─────────────────────────────────────────────────────────

function makePreToolEntry(overrides?: Partial<AuditEntryPreTool>): AuditEntryPreTool {
  return {
    kind: 'pre_tool_use',
    timestamp: '2026-03-02T12:00:00.000Z',
    sessionId: 'session-1',
    agentId: 'agent-1',
    tool: 'Bash',
    inputHash: 'abc123',
    decision: 'allow',
    ...overrides,
  };
}

function makePostToolEntry(overrides?: Partial<AuditEntryPostTool>): AuditEntryPostTool {
  return {
    kind: 'post_tool_use',
    timestamp: '2026-03-02T12:00:01.000Z',
    sessionId: 'session-1',
    agentId: 'agent-1',
    tool: 'Bash',
    inputHash: 'abc123',
    outputHash: 'def456',
    durationMs: 42,
    ...overrides,
  };
}

function makeSessionEndEntry(overrides?: Partial<AuditEntrySessionEnd>): AuditEntrySessionEnd {
  return {
    kind: 'session_end',
    timestamp: '2026-03-02T12:01:00.000Z',
    sessionId: 'session-1',
    agentId: 'agent-1',
    reason: 'completed',
    totalCostUsd: 0.05,
    totalTurns: 3,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('sha256', () => {
  it('returns a hex string for a string input', () => {
    const result = sha256('hello world');

    const expected = createHash('sha256').update('hello world').digest('hex');

    expect(result).toBe(expected);
  });

  it('returns a hex string for an object input by JSON-stringifying', () => {
    const obj = { command: 'echo hello' };
    const result = sha256(obj);

    const expected = createHash('sha256').update(JSON.stringify(obj)).digest('hex');

    expect(result).toBe(expected);
  });

  it('returns consistent hashes for the same input', () => {
    const a = sha256('test');
    const b = sha256('test');

    expect(a).toBe(b);
  });

  it('returns different hashes for different inputs', () => {
    const a = sha256('input-a');
    const b = sha256('input-b');

    expect(a).not.toBe(b);
  });

  it('handles empty string input', () => {
    const result = sha256('');
    const expected = createHash('sha256').update('').digest('hex');

    expect(result).toBe(expected);
    expect(result).toHaveLength(64); // SHA-256 hex is always 64 chars
  });

  it('handles empty object input', () => {
    const result = sha256({});
    const expected = createHash('sha256').update('{}').digest('hex');

    expect(result).toBe(expected);
  });

  it('handles null input (JSON-stringified)', () => {
    const result = sha256(null);
    const expected = createHash('sha256').update('null').digest('hex');

    expect(result).toBe(expected);
  });

  it('handles numeric input (JSON-stringified)', () => {
    const result = sha256(42);
    const expected = createHash('sha256').update('42').digest('hex');

    expect(result).toBe(expected);
  });

  it('handles array input (JSON-stringified)', () => {
    const result = sha256([1, 2, 3]);
    const expected = createHash('sha256').update('[1,2,3]').digest('hex');

    expect(result).toBe(expected);
  });

  it('handles nested objects', () => {
    const nested = { a: { b: { c: 'deep' } } };
    const result = sha256(nested);
    const expected = createHash('sha256').update(JSON.stringify(nested)).digest('hex');

    expect(result).toBe(expected);
  });

  it('produces a 64-character hex string', () => {
    const result = sha256('anything');

    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('AuditLogger', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(true);
    mockAppendFile.mockResolvedValue(undefined);
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ── Constructor ───────────────────────────────────────────────────

  describe('constructor', () => {
    it('uses explicit logDir when provided', () => {
      const logger = new AuditLogger({ logDir: '/custom/logs', logger: mockLogger });

      expect(logger.getLogFilePath()).toContain('/custom/logs/audit-');
    });

    it('falls back to AUDIT_LOG_DIR env var when logDir is not provided', () => {
      process.env.AUDIT_LOG_DIR = '/env/audit-logs';

      const logger = new AuditLogger({ logger: mockLogger });

      expect(logger.getLogFilePath()).toContain('/env/audit-logs/audit-');
    });

    it('defaults to ./logs when neither logDir nor env var is set', () => {
      delete process.env.AUDIT_LOG_DIR;

      const logger = new AuditLogger({ logger: mockLogger });

      expect(logger.getLogFilePath()).toContain('logs/audit-');
    });

    it('creates the log directory if it does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      new AuditLogger({ logDir: '/new/dir', logger: mockLogger });

      expect(mockMkdirSync).toHaveBeenCalledWith('/new/dir', { recursive: true });
    });

    it('does not create the directory if it already exists', () => {
      mockExistsSync.mockReturnValue(true);

      new AuditLogger({ logDir: '/existing/dir', logger: mockLogger });

      expect(mockMkdirSync).not.toHaveBeenCalled();
    });

    it('logs when creating a new directory', () => {
      mockExistsSync.mockReturnValue(false);

      new AuditLogger({ logDir: '/new/dir', logger: mockLogger });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ logDir: '/new/dir' }),
        'Created audit log directory',
      );
    });
  });

  // ── getLogFilePath ────────────────────────────────────────────────

  describe('getLogFilePath', () => {
    it('returns a path with the daily rotation pattern', () => {
      const logger = new AuditLogger({ logDir: '/logs', logger: mockLogger });
      const path = logger.getLogFilePath();

      // Should match /logs/audit-YYYY-MM-DD.ndjson
      expect(path).toMatch(/\/logs\/audit-\d{4}-\d{2}-\d{2}\.ndjson$/);
    });

    it('uses the current date', () => {
      const today = new Date().toISOString().slice(0, 10);

      const logger = new AuditLogger({ logDir: '/logs', logger: mockLogger });

      expect(logger.getLogFilePath()).toBe(`/logs/audit-${today}.ndjson`);
    });

    it('appends the configured secure token to the file name', () => {
      const today = new Date().toISOString().slice(0, 10);

      const logger = new AuditLogger({
        logDir: '/logs',
        logger: mockLogger,
        fileToken: 'secure-token',
      });

      expect(logger.getLogFilePath()).toBe(`/logs/audit-${today}-secure-token.ndjson`);
    });
  });

  // ── write() ───────────────────────────────────────────────────────

  describe('write()', () => {
    it('appends an NDJSON line for a pre_tool_use entry with hash chain fields', async () => {
      const logger = new AuditLogger({ logDir: '/logs', logger: mockLogger });
      const entry = makePreToolEntry();

      await logger.write(entry);

      expect(mockAppendFile).toHaveBeenCalledTimes(1);

      const [path, content, encoding] = mockAppendFile.mock.calls[0];

      expect(path).toMatch(/audit-.*\.ndjson$/);
      expect(encoding).toBe('utf-8');

      // Content should be JSON line ending with \n
      expect(content).toMatch(/\n$/);

      const parsed = JSON.parse((content as string).trim());

      expect(parsed.kind).toBe('pre_tool_use');
      expect(parsed.sessionId).toBe('session-1');
      expect(parsed.agentId).toBe('agent-1');
      expect(parsed.tool).toBe('Bash');
      expect(parsed.decision).toBe('allow');

      // Hash chain fields
      expect(parsed.previousHash).toBe(GENESIS_HASH);
      expect(parsed.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(parsed.hash).toBe(computeEntryHash(entry, GENESIS_HASH));
    });

    it('appends an NDJSON line for a post_tool_use entry', async () => {
      const logger = new AuditLogger({ logDir: '/logs', logger: mockLogger });
      const entry = makePostToolEntry();

      await logger.write(entry);

      const content = mockAppendFile.mock.calls[0][1] as string;
      const parsed = JSON.parse(content.trim());

      expect(parsed.kind).toBe('post_tool_use');
      expect(parsed.outputHash).toBe('def456');
      expect(parsed.durationMs).toBe(42);
    });

    it('appends an NDJSON line for a session_end entry', async () => {
      const logger = new AuditLogger({ logDir: '/logs', logger: mockLogger });
      const entry = makeSessionEndEntry();

      await logger.write(entry);

      const content = mockAppendFile.mock.calls[0][1] as string;
      const parsed = JSON.parse(content.trim());

      expect(parsed.kind).toBe('session_end');
      expect(parsed.reason).toBe('completed');
      expect(parsed.totalCostUsd).toBe(0.05);
      expect(parsed.totalTurns).toBe(3);
    });

    it('includes denyReason in pre_tool_use entry when present', async () => {
      const logger = new AuditLogger({ logDir: '/logs', logger: mockLogger });
      const entry = makePreToolEntry({
        decision: 'deny',
        denyReason: 'Blocked pattern detected: "rm -rf /"',
      });

      await logger.write(entry);

      const content = mockAppendFile.mock.calls[0][1] as string;
      const parsed = JSON.parse(content.trim());

      expect(parsed.decision).toBe('deny');
      expect(parsed.denyReason).toBe('Blocked pattern detected: "rm -rf /"');
    });

    it('writes multiple entries as separate lines', async () => {
      const logger = new AuditLogger({ logDir: '/logs', logger: mockLogger });

      await logger.write(makePreToolEntry());
      await logger.write(makePostToolEntry());
      await logger.write(makeSessionEndEntry());

      expect(mockAppendFile).toHaveBeenCalledTimes(3);

      // Each call should produce a single line ending with \n
      for (const call of mockAppendFile.mock.calls) {
        const content = call[1] as string;
        expect(content.endsWith('\n')).toBe(true);
        // Should not contain multiple newlines (single NDJSON line)
        expect(content.trim().includes('\n')).toBe(false);
      }
    });
  });

  // ── Error handling ────────────────────────────────────────────────

  describe('error handling', () => {
    it('throws WorkerError with AUDIT_WRITE_FAILED code when appendFile fails', async () => {
      mockAppendFile.mockRejectedValue(new Error('ENOSPC: no space left on device'));

      const logger = new AuditLogger({ logDir: '/logs', logger: mockLogger });

      await expect(logger.write(makePreToolEntry())).rejects.toThrow(WorkerError);

      try {
        await logger.write(makePreToolEntry());
      } catch (err) {
        const workerErr = err as WorkerError;
        expect(workerErr.code).toBe('AUDIT_WRITE_FAILED');
        expect(workerErr.message).toContain('ENOSPC');
        expect(workerErr.context).toHaveProperty('path');
      }
    });

    it('logs an error before throwing on write failure', async () => {
      mockAppendFile.mockRejectedValue(new Error('disk error'));

      const logger = new AuditLogger({ logDir: '/logs', logger: mockLogger });

      await expect(logger.write(makePreToolEntry())).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error), path: expect.any(String) }),
        'Failed to write audit entry',
      );
    });

    it('wraps non-Error throwables in the WorkerError message', async () => {
      mockAppendFile.mockRejectedValue('string error');

      const logger = new AuditLogger({ logDir: '/logs', logger: mockLogger });

      await expect(logger.write(makePreToolEntry())).rejects.toThrow(WorkerError);

      try {
        await logger.write(makePreToolEntry());
      } catch (err) {
        const workerErr = err as WorkerError;
        expect(workerErr.message).toContain('string error');
      }
    });
  });

  // ── Daily rotation ────────────────────────────────────────────────

  describe('daily rotation', () => {
    it('rotates to a new file when the date changes', async () => {
      vi.useFakeTimers();

      try {
        // Start on day 1
        vi.setSystemTime(new Date('2026-03-02T23:59:59.000Z'));

        const logger = new AuditLogger({ logDir: '/logs', logger: mockLogger });
        const path1 = logger.getLogFilePath();

        expect(path1).toBe('/logs/audit-2026-03-02.ndjson');

        // Advance to day 2
        vi.setSystemTime(new Date('2026-03-03T00:00:01.000Z'));

        await logger.write(makePreToolEntry());

        const path2 = logger.getLogFilePath();

        expect(path2).toBe('/logs/audit-2026-03-03.ndjson');
        expect(path2).not.toBe(path1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('logs rotation event when date changes', async () => {
      vi.useFakeTimers();

      try {
        vi.setSystemTime(new Date('2026-03-02T23:59:59.000Z'));

        const logger = new AuditLogger({ logDir: '/logs', logger: mockLogger });

        vi.setSystemTime(new Date('2026-03-03T00:00:01.000Z'));

        await logger.write(makePreToolEntry());

        expect(mockLogger.info).toHaveBeenCalledWith(
          expect.objectContaining({
            previousDate: '2026-03-02',
            newDate: '2026-03-03',
          }),
          'Rotating audit log file',
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not rotate when the date has not changed', async () => {
      vi.useFakeTimers();

      try {
        vi.setSystemTime(new Date('2026-03-02T12:00:00.000Z'));

        const logger = new AuditLogger({ logDir: '/logs', logger: mockLogger });

        vi.clearAllMocks();

        vi.setSystemTime(new Date('2026-03-02T12:30:00.000Z'));

        await logger.write(makePreToolEntry());

        // Should not log a rotation event
        expect(mockLogger.info).not.toHaveBeenCalledWith(
          expect.anything(),
          'Rotating audit log file',
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('writes to the rotated file path after rotation', async () => {
      vi.useFakeTimers();

      try {
        vi.setSystemTime(new Date('2026-03-02T23:59:59.000Z'));

        const logger = new AuditLogger({ logDir: '/logs', logger: mockLogger });

        // Write on day 1
        await logger.write(makePreToolEntry());
        const pathDay1 = mockAppendFile.mock.calls[0][0] as string;
        expect(pathDay1).toBe('/logs/audit-2026-03-02.ndjson');

        // Advance to day 2
        vi.setSystemTime(new Date('2026-03-03T00:00:01.000Z'));

        await logger.write(makePostToolEntry());
        const pathDay2 = mockAppendFile.mock.calls[1][0] as string;
        expect(pathDay2).toBe('/logs/audit-2026-03-03.ndjson');
      } finally {
        vi.useRealTimers();
      }
    });

    it('resets hash chain to genesis on daily rotation', async () => {
      vi.useFakeTimers();

      try {
        vi.setSystemTime(new Date('2026-03-02T23:59:59.000Z'));

        const logger = new AuditLogger({ logDir: '/logs', logger: mockLogger });

        // Write on day 1
        await logger.write(makePreToolEntry());

        // Advance to day 2
        vi.setSystemTime(new Date('2026-03-03T00:00:01.000Z'));

        await logger.write(makePostToolEntry());

        // The second entry (new day) should use genesis as previousHash
        const content2 = mockAppendFile.mock.calls[1][1] as string;
        const parsed2 = JSON.parse(content2.trim());
        expect(parsed2.previousHash).toBe(GENESIS_HASH);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ── Hash chain ───────────────────────────────────────────────────

  describe('hash chain', () => {
    it('first entry uses genesis as previousHash', async () => {
      const logger = new AuditLogger({ logDir: '/logs', logger: mockLogger });

      await logger.write(makePreToolEntry());

      const content = mockAppendFile.mock.calls[0][1] as string;
      const parsed = JSON.parse(content.trim());

      expect(parsed.previousHash).toBe(GENESIS_HASH);
    });

    it('second entry uses first entry hash as previousHash', async () => {
      const logger = new AuditLogger({ logDir: '/logs', logger: mockLogger });

      await logger.write(makePreToolEntry());
      await logger.write(makePostToolEntry());

      const content1 = mockAppendFile.mock.calls[0][1] as string;
      const parsed1 = JSON.parse(content1.trim());

      const content2 = mockAppendFile.mock.calls[1][1] as string;
      const parsed2 = JSON.parse(content2.trim());

      expect(parsed2.previousHash).toBe(parsed1.hash);
    });

    it('builds a three-entry chain with correct linkage', async () => {
      const logger = new AuditLogger({ logDir: '/logs', logger: mockLogger });

      await logger.write(makePreToolEntry());
      await logger.write(makePostToolEntry());
      await logger.write(makeSessionEndEntry());

      const entries = mockAppendFile.mock.calls.map((call) =>
        JSON.parse((call[1] as string).trim()),
      );

      // Entry 0: genesis -> hash0
      expect(entries[0].previousHash).toBe(GENESIS_HASH);

      // Entry 1: hash0 -> hash1
      expect(entries[1].previousHash).toBe(entries[0].hash);

      // Entry 2: hash1 -> hash2
      expect(entries[2].previousHash).toBe(entries[1].hash);

      // All hashes are unique
      const hashes = entries.map((e: { hash: string }) => e.hash);
      expect(new Set(hashes).size).toBe(3);
    });

    it('computes hash as SHA-256(JSON.stringify(entry) + previousHash)', async () => {
      const logger = new AuditLogger({ logDir: '/logs', logger: mockLogger });
      const entry = makePreToolEntry();

      await logger.write(entry);

      const content = mockAppendFile.mock.calls[0][1] as string;
      const parsed = JSON.parse(content.trim());

      // Manually compute expected hash
      const expectedHash = sha256(JSON.stringify(entry) + GENESIS_HASH);

      expect(parsed.hash).toBe(expectedHash);
    });

    it('does not advance previousHash when write fails', async () => {
      mockAppendFile.mockRejectedValueOnce(new Error('disk error'));
      mockAppendFile.mockResolvedValue(undefined);

      const logger = new AuditLogger({ logDir: '/logs', logger: mockLogger });

      // First write fails
      await expect(logger.write(makePreToolEntry())).rejects.toThrow();

      // Second write should still use genesis (chain not advanced)
      await logger.write(makePostToolEntry());

      const content = mockAppendFile.mock.calls[1][1] as string;
      const parsed = JSON.parse(content.trim());

      expect(parsed.previousHash).toBe(GENESIS_HASH);
    });
  });
});

// ── computeEntryHash ───────────────────────────────────────────────

describe('computeEntryHash', () => {
  it('returns SHA-256 of JSON.stringify(entry) + previousHash', () => {
    const entry = makePreToolEntry();
    const hash = computeEntryHash(entry, GENESIS_HASH);

    const expected = sha256(JSON.stringify(entry) + GENESIS_HASH);
    expect(hash).toBe(expected);
  });

  it('produces different hashes for different previousHash values', () => {
    const entry = makePreToolEntry();

    const hash1 = computeEntryHash(entry, GENESIS_HASH);
    const hash2 = computeEntryHash(entry, 'different-previous');

    expect(hash1).not.toBe(hash2);
  });

  it('produces different hashes for different entries', () => {
    const entry1 = makePreToolEntry({ tool: 'Bash' });
    const entry2 = makePreToolEntry({ tool: 'Read' });

    const hash1 = computeEntryHash(entry1, GENESIS_HASH);
    const hash2 = computeEntryHash(entry2, GENESIS_HASH);

    expect(hash1).not.toBe(hash2);
  });
});

// ── verifyIntegrity ────────────────────────────────────────────────

describe('AuditLogger.verifyIntegrity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Helper: build a valid NDJSON string from a series of entries
   * with a correct hash chain.
   */
  function buildValidNdjson(
    entries: (AuditEntryPreTool | AuditEntryPostTool | AuditEntrySessionEnd)[],
  ): string {
    const lines: string[] = [];
    let prevHash = GENESIS_HASH;

    for (const entry of entries) {
      const hash = computeEntryHash(entry, prevHash);
      const hashed = { ...entry, previousHash: prevHash, hash };
      lines.push(JSON.stringify(hashed));
      prevHash = hash;
    }

    return `${lines.join('\n')}\n`;
  }

  it('returns valid=true for a correctly chained file', async () => {
    const ndjson = buildValidNdjson([
      makePreToolEntry(),
      makePostToolEntry(),
      makeSessionEndEntry(),
    ]);

    mockReadFile.mockResolvedValueOnce(ndjson);

    const result = await AuditLogger.verifyIntegrity('/logs/audit-2026-03-02.ndjson');

    expect(result.valid).toBe(true);
    expect(result.entriesChecked).toBe(3);
    expect(result.error).toBeUndefined();
  });

  it('returns valid=true for an empty file', async () => {
    mockReadFile.mockResolvedValueOnce('');

    const result = await AuditLogger.verifyIntegrity('/logs/empty.ndjson');

    expect(result.valid).toBe(true);
    expect(result.entriesChecked).toBe(0);
  });

  it('returns valid=true for a single-entry file', async () => {
    const ndjson = buildValidNdjson([makePreToolEntry()]);

    mockReadFile.mockResolvedValueOnce(ndjson);

    const result = await AuditLogger.verifyIntegrity('/logs/single.ndjson');

    expect(result.valid).toBe(true);
    expect(result.entriesChecked).toBe(1);
  });

  it('detects tampered entry content (hash mismatch)', async () => {
    const entry1 = makePreToolEntry();
    const entry2 = makePostToolEntry();

    const hash1 = computeEntryHash(entry1, GENESIS_HASH);
    const hash2 = computeEntryHash(entry2, hash1);

    // Tamper with entry2's tool field but keep original hash
    const tampered = {
      ...entry2,
      tool: 'TAMPERED',
      previousHash: hash1,
      hash: hash2,
    };

    const lines = `${[
      JSON.stringify({ ...entry1, previousHash: GENESIS_HASH, hash: hash1 }),
      JSON.stringify(tampered),
    ].join('\n')}\n`;

    mockReadFile.mockResolvedValueOnce(lines);

    const result = await AuditLogger.verifyIntegrity('/logs/tampered.ndjson');

    expect(result.valid).toBe(false);
    expect(result.brokenAtLine).toBe(1);
    expect(result.error).toMatch(/[Hh]ash mismatch/);
  });

  it('detects broken chain (previousHash mismatch)', async () => {
    const entry1 = makePreToolEntry();
    const entry2 = makePostToolEntry();

    const hash1 = computeEntryHash(entry1, GENESIS_HASH);

    // Entry2 has wrong previousHash (genesis instead of hash1)
    const wrongPrevHash = GENESIS_HASH;
    const hash2 = computeEntryHash(entry2, wrongPrevHash);

    const lines = `${[
      JSON.stringify({ ...entry1, previousHash: GENESIS_HASH, hash: hash1 }),
      JSON.stringify({ ...entry2, previousHash: wrongPrevHash, hash: hash2 }),
    ].join('\n')}\n`;

    mockReadFile.mockResolvedValueOnce(lines);

    const result = await AuditLogger.verifyIntegrity('/logs/broken-chain.ndjson');

    expect(result.valid).toBe(false);
    expect(result.brokenAtLine).toBe(1);
    expect(result.error).toMatch(/[Pp]revious hash mismatch/);
  });

  it('detects malformed JSON lines', async () => {
    mockReadFile.mockResolvedValueOnce('not valid json\n');

    const result = await AuditLogger.verifyIntegrity('/logs/malformed.ndjson');

    expect(result.valid).toBe(false);
    expect(result.brokenAtLine).toBe(0);
    expect(result.error).toMatch(/[Mm]alformed JSON/);
  });

  it('returns error when file cannot be read', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT: no such file or directory'));

    const result = await AuditLogger.verifyIntegrity('/logs/nonexistent.ndjson');

    expect(result.valid).toBe(false);
    expect(result.entriesChecked).toBe(0);
    expect(result.error).toMatch(/[Ff]ailed to read file/);
  });

  it('validates a chain with all three entry types', async () => {
    const entries = [
      makePreToolEntry(),
      makePostToolEntry(),
      makeSessionEndEntry(),
      makePreToolEntry({ tool: 'Read', timestamp: '2026-03-02T12:02:00.000Z' }),
      makePostToolEntry({ tool: 'Read', timestamp: '2026-03-02T12:02:01.000Z' }),
    ];

    const ndjson = buildValidNdjson(entries);
    mockReadFile.mockResolvedValueOnce(ndjson);

    const result = await AuditLogger.verifyIntegrity('/logs/mixed.ndjson');

    expect(result.valid).toBe(true);
    expect(result.entriesChecked).toBe(5);
  });
});
