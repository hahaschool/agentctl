import type { Logger } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditLogger } from './audit-logger.js';
import { sha256 } from './audit-logger.js';
import { createPostToolUseHook, type PostToolUseInput } from './post-tool-use.js';

// ── Helpers ───────────────────────────────────────────────────────────

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

function makeInput(overrides?: Partial<PostToolUseInput>): PostToolUseInput {
  return {
    sessionId: 'session-1',
    agentId: 'agent-1',
    toolName: 'Bash',
    toolInput: { command: 'echo hello' },
    toolOutput: 'hello\n',
    durationMs: 150,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('createPostToolUseHook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Happy path ────────────────────────────────────────────────────

  describe('happy path', () => {
    it('writes a post_tool_use audit entry with correct fields', async () => {
      const hook = createPostToolUseHook({
        auditLogger: mockAuditLogger,
        logger: mockLogger,
      });

      await hook(makeInput());

      expect(mockAuditLogger.write).toHaveBeenCalledTimes(1);

      const entry = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[0][0];

      expect(entry.kind).toBe('post_tool_use');
      expect(entry.sessionId).toBe('session-1');
      expect(entry.agentId).toBe('agent-1');
      expect(entry.tool).toBe('Bash');
      expect(entry.durationMs).toBe(150);
    });

    it('includes an ISO 8601 timestamp in the audit entry', async () => {
      const hook = createPostToolUseHook({
        auditLogger: mockAuditLogger,
        logger: mockLogger,
      });

      await hook(makeInput());

      const entry = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[0][0];

      expect(typeof entry.timestamp).toBe('string');
      expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
    });

    it('computes inputHash as sha256 of the toolInput object', async () => {
      const toolInput = { command: 'ls -la' };
      const hook = createPostToolUseHook({
        auditLogger: mockAuditLogger,
        logger: mockLogger,
      });

      await hook(makeInput({ toolInput }));

      const entry = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const expectedHash = sha256(toolInput);

      expect(entry.inputHash).toBe(expectedHash);
    });

    it('computes outputHash as sha256 of the toolOutput string', async () => {
      const toolOutput = 'some output data';
      const hook = createPostToolUseHook({
        auditLogger: mockAuditLogger,
        logger: mockLogger,
      });

      await hook(makeInput({ toolOutput }));

      const entry = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const expectedHash = sha256(toolOutput);

      expect(entry.outputHash).toBe(expectedHash);
    });

    it('logs a debug message with tool details', async () => {
      const hook = createPostToolUseHook({
        auditLogger: mockAuditLogger,
        logger: mockLogger,
      });

      await hook(makeInput());

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-1',
          sessionId: 'session-1',
          tool: 'Bash',
          durationMs: 150,
        }),
        'Tool use completed',
      );
    });
  });

  // ── Different tool types ──────────────────────────────────────────

  describe('different tool types', () => {
    it('records non-Bash tool invocations (Read)', async () => {
      const hook = createPostToolUseHook({
        auditLogger: mockAuditLogger,
        logger: mockLogger,
      });

      await hook(
        makeInput({
          toolName: 'Read',
          toolInput: { file_path: '/tmp/test.txt' },
          toolOutput: 'file contents here',
          durationMs: 12,
        }),
      );

      const entry = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[0][0];

      expect(entry.tool).toBe('Read');
      expect(entry.durationMs).toBe(12);
    });

    it('records Write tool invocations', async () => {
      const hook = createPostToolUseHook({
        auditLogger: mockAuditLogger,
        logger: mockLogger,
      });

      await hook(
        makeInput({
          toolName: 'Write',
          toolInput: { file_path: '/tmp/out.txt', content: 'data' },
          toolOutput: 'File written successfully',
          durationMs: 30,
        }),
      );

      const entry = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[0][0];

      expect(entry.tool).toBe('Write');
    });

    it('records Edit tool invocations', async () => {
      const hook = createPostToolUseHook({
        auditLogger: mockAuditLogger,
        logger: mockLogger,
      });

      await hook(
        makeInput({
          toolName: 'Edit',
          toolInput: { file_path: '/tmp/file.ts', old_string: 'foo', new_string: 'bar' },
          toolOutput: 'Edit applied',
          durationMs: 5,
        }),
      );

      const entry = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[0][0];

      expect(entry.tool).toBe('Edit');
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles empty toolOutput string', async () => {
      const hook = createPostToolUseHook({
        auditLogger: mockAuditLogger,
        logger: mockLogger,
      });

      await hook(makeInput({ toolOutput: '' }));

      const entry = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[0][0];

      expect(entry.outputHash).toBe(sha256(''));
      expect(entry.kind).toBe('post_tool_use');
    });

    it('handles empty toolInput object', async () => {
      const hook = createPostToolUseHook({
        auditLogger: mockAuditLogger,
        logger: mockLogger,
      });

      await hook(makeInput({ toolInput: {} }));

      const entry = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[0][0];

      expect(entry.inputHash).toBe(sha256({}));
    });

    it('handles zero durationMs', async () => {
      const hook = createPostToolUseHook({
        auditLogger: mockAuditLogger,
        logger: mockLogger,
      });

      await hook(makeInput({ durationMs: 0 }));

      const entry = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[0][0];

      expect(entry.durationMs).toBe(0);
    });

    it('handles very large durationMs', async () => {
      const hook = createPostToolUseHook({
        auditLogger: mockAuditLogger,
        logger: mockLogger,
      });

      await hook(makeInput({ durationMs: 3_600_000 }));

      const entry = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[0][0];

      expect(entry.durationMs).toBe(3_600_000);
    });

    it('handles toolOutput with special characters and unicode', async () => {
      const toolOutput = 'Line1\nLine2\ttab\r\n\u00e9\u00e8\u00ea \u{1f600}';
      const hook = createPostToolUseHook({
        auditLogger: mockAuditLogger,
        logger: mockLogger,
      });

      await hook(makeInput({ toolOutput }));

      const entry = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[0][0];

      expect(entry.outputHash).toBe(sha256(toolOutput));
    });

    it('handles very large toolOutput', async () => {
      const toolOutput = 'x'.repeat(100_000);
      const hook = createPostToolUseHook({
        auditLogger: mockAuditLogger,
        logger: mockLogger,
      });

      await hook(makeInput({ toolOutput }));

      const entry = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[0][0];

      expect(entry.outputHash).toBe(sha256(toolOutput));
    });

    it('produces different hashes for different inputs', async () => {
      const hook = createPostToolUseHook({
        auditLogger: mockAuditLogger,
        logger: mockLogger,
      });

      await hook(makeInput({ toolInput: { command: 'echo a' }, toolOutput: 'a\n' }));
      await hook(makeInput({ toolInput: { command: 'echo b' }, toolOutput: 'b\n' }));

      const entry1 = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const entry2 = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[1][0];

      expect(entry1.inputHash).not.toBe(entry2.inputHash);
      expect(entry1.outputHash).not.toBe(entry2.outputHash);
    });
  });

  // ── Error handling ────────────────────────────────────────────────

  describe('error handling', () => {
    it('propagates audit logger write errors', async () => {
      const failingAuditLogger = {
        write: vi.fn().mockRejectedValue(new Error('Disk full')),
      } as unknown as AuditLogger;

      const hook = createPostToolUseHook({
        auditLogger: failingAuditLogger,
        logger: mockLogger,
      });

      await expect(hook(makeInput())).rejects.toThrow('Disk full');
    });

    it('still logs debug message before the write fails', async () => {
      const failingAuditLogger = {
        write: vi.fn().mockRejectedValue(new Error('Write failed')),
      } as unknown as AuditLogger;

      const hook = createPostToolUseHook({
        auditLogger: failingAuditLogger,
        logger: mockLogger,
      });

      try {
        await hook(makeInput());
      } catch {
        // expected
      }

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'agent-1',
          sessionId: 'session-1',
          tool: 'Bash',
        }),
        'Tool use completed',
      );
    });
  });

  // ── Multiple invocations ──────────────────────────────────────────

  describe('multiple invocations', () => {
    it('can be called multiple times with different inputs', async () => {
      const hook = createPostToolUseHook({
        auditLogger: mockAuditLogger,
        logger: mockLogger,
      });

      await hook(
        makeInput({
          sessionId: 'session-a',
          toolName: 'Bash',
          durationMs: 100,
        }),
      );
      await hook(
        makeInput({
          sessionId: 'session-b',
          toolName: 'Read',
          durationMs: 200,
        }),
      );

      expect(mockAuditLogger.write).toHaveBeenCalledTimes(2);

      const first = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const second = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[1][0];

      expect(first.sessionId).toBe('session-a');
      expect(first.tool).toBe('Bash');
      expect(first.durationMs).toBe(100);
      expect(second.sessionId).toBe('session-b');
      expect(second.tool).toBe('Read');
      expect(second.durationMs).toBe(200);
    });

    it('each invocation gets a fresh timestamp', async () => {
      const hook = createPostToolUseHook({
        auditLogger: mockAuditLogger,
        logger: mockLogger,
      });

      await hook(makeInput());
      await hook(makeInput());

      const first = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[0][0];
      const second = (mockAuditLogger.write as ReturnType<typeof vi.fn>).mock.calls[1][0];

      // Both should be valid ISO timestamps (they may or may not differ
      // depending on timing, but both must be valid).
      expect(new Date(first.timestamp).toISOString()).toBe(first.timestamp);
      expect(new Date(second.timestamp).toISOString()).toBe(second.timestamp);
    });
  });
});
