import type { Logger } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditLogger } from './audit-logger.js';
import { createStopHook, type StopInput } from './stop-hook.js';

// ── Helpers ───────────────────────────────────────────────────────────

const mockLogger = {
  child: () => mockLogger,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
} as unknown as Logger;

function makeInput(overrides?: Partial<StopInput>): StopInput {
  return {
    sessionId: 'session-1',
    agentId: 'agent-1',
    reason: 'completed',
    totalCostUsd: 0.012,
    totalTurns: 5,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('createStopHook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes a session_end entry to the audit logger', async () => {
    const mockAuditLogger = {
      write: vi.fn().mockResolvedValue(undefined),
    } as unknown as AuditLogger;

    const hook = createStopHook({ auditLogger: mockAuditLogger, logger: mockLogger });

    await hook(makeInput());

    expect(mockAuditLogger.write).toHaveBeenCalledTimes(1);

    const entry = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[0][0];

    expect(entry.kind).toBe('session_end');
    expect(entry.sessionId).toBe('session-1');
    expect(entry.agentId).toBe('agent-1');
    expect(entry.reason).toBe('completed');
    expect(entry.totalCostUsd).toBe(0.012);
    expect(entry.totalTurns).toBe(5);
  });

  it('includes an ISO timestamp in the audit entry', async () => {
    const mockAuditLogger = {
      write: vi.fn().mockResolvedValue(undefined),
    } as unknown as AuditLogger;

    const hook = createStopHook({ auditLogger: mockAuditLogger, logger: mockLogger });

    await hook(makeInput());

    const entry = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[0][0];

    // ISO 8601 format check
    expect(typeof entry.timestamp).toBe('string');
    expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
  });

  it('logs session end information', async () => {
    const mockAuditLogger = {
      write: vi.fn().mockResolvedValue(undefined),
    } as unknown as AuditLogger;

    const hook = createStopHook({ auditLogger: mockAuditLogger, logger: mockLogger });

    await hook(makeInput());

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        sessionId: 'session-1',
        reason: 'completed',
        totalCostUsd: 0.012,
        totalTurns: 5,
      }),
      'Agent session ended',
    );
  });

  describe('graceful vs force stop', () => {
    it('records graceful stop with "user" reason', async () => {
      const mockAuditLogger = {
        write: vi.fn().mockResolvedValue(undefined),
      } as unknown as AuditLogger;

      const hook = createStopHook({ auditLogger: mockAuditLogger, logger: mockLogger });

      await hook(makeInput({ reason: 'user' }));

      const entry = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[0][0];

      expect(entry.kind).toBe('session_end');
      expect(entry.reason).toBe('user');
    });

    it('records force stop with "user" reason and preserves cost/turn data', async () => {
      const mockAuditLogger = {
        write: vi.fn().mockResolvedValue(undefined),
      } as unknown as AuditLogger;

      const hook = createStopHook({ auditLogger: mockAuditLogger, logger: mockLogger });

      // Force stop mid-run: fewer turns, partial cost
      await hook(
        makeInput({
          reason: 'user',
          totalCostUsd: 0.003,
          totalTurns: 1,
        }),
      );

      const entry = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[0][0];

      expect(entry.reason).toBe('user');
      expect(entry.totalCostUsd).toBe(0.003);
      expect(entry.totalTurns).toBe(1);
    });

    it('records error-triggered stop with error reason', async () => {
      const mockAuditLogger = {
        write: vi.fn().mockResolvedValue(undefined),
      } as unknown as AuditLogger;

      const hook = createStopHook({ auditLogger: mockAuditLogger, logger: mockLogger });

      await hook(
        makeInput({
          reason: 'error: SDK crashed unexpectedly',
          totalCostUsd: 0.008,
          totalTurns: 3,
        }),
      );

      const entry = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[0][0];

      expect(entry.kind).toBe('session_end');
      expect(entry.reason).toBe('error: SDK crashed unexpectedly');
      expect(entry.totalCostUsd).toBe(0.008);
      expect(entry.totalTurns).toBe(3);
    });

    it('records completed stop with zero cost for no-op runs', async () => {
      const mockAuditLogger = {
        write: vi.fn().mockResolvedValue(undefined),
      } as unknown as AuditLogger;

      const hook = createStopHook({ auditLogger: mockAuditLogger, logger: mockLogger });

      await hook(
        makeInput({
          reason: 'completed',
          totalCostUsd: 0,
          totalTurns: 0,
        }),
      );

      const entry = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[0][0];

      expect(entry.reason).toBe('completed');
      expect(entry.totalCostUsd).toBe(0);
      expect(entry.totalTurns).toBe(0);
    });
  });

  describe('error handling', () => {
    it('propagates audit logger write errors', async () => {
      const mockAuditLogger = {
        write: vi.fn().mockRejectedValue(new Error('Disk full')),
      } as unknown as AuditLogger;

      const hook = createStopHook({ auditLogger: mockAuditLogger, logger: mockLogger });

      await expect(hook(makeInput())).rejects.toThrow('Disk full');
    });

    it('propagates filesystem permission errors', async () => {
      const mockAuditLogger = {
        write: vi.fn().mockRejectedValue(new Error('EACCES: permission denied')),
      } as unknown as AuditLogger;

      const hook = createStopHook({ auditLogger: mockAuditLogger, logger: mockLogger });

      await expect(hook(makeInput())).rejects.toThrow('EACCES: permission denied');
    });

    it('propagates read-only filesystem errors', async () => {
      const mockAuditLogger = {
        write: vi.fn().mockRejectedValue(new Error('EROFS: read-only file system')),
      } as unknown as AuditLogger;

      const hook = createStopHook({ auditLogger: mockAuditLogger, logger: mockLogger });

      await expect(hook(makeInput())).rejects.toThrow('EROFS: read-only file system');
    });

    it('still logs session info before the write fails', async () => {
      const mockAuditLogger = {
        write: vi.fn().mockRejectedValue(new Error('Write failed')),
      } as unknown as AuditLogger;

      const hook = createStopHook({ auditLogger: mockAuditLogger, logger: mockLogger });

      try {
        await hook(makeInput());
      } catch {
        // expected
      }

      // The info log should have been called before the write attempt
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-1',
          sessionId: 'session-1',
        }),
        'Agent session ended',
      );
    });
  });

  describe('multiple invocations', () => {
    it('can be called multiple times with different inputs', async () => {
      const mockAuditLogger = {
        write: vi.fn().mockResolvedValue(undefined),
      } as unknown as AuditLogger;

      const hook = createStopHook({ auditLogger: mockAuditLogger, logger: mockLogger });

      await hook(makeInput({ sessionId: 'session-a', reason: 'completed' }));
      await hook(makeInput({ sessionId: 'session-b', reason: 'error: timeout' }));

      expect(mockAuditLogger.write).toHaveBeenCalledTimes(2);

      const firstEntry = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const secondEntry = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[1][0];

      expect(firstEntry.sessionId).toBe('session-a');
      expect(firstEntry.reason).toBe('completed');
      expect(secondEntry.sessionId).toBe('session-b');
      expect(secondEntry.reason).toBe('error: timeout');
    });
  });
});
