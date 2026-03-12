import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type VerifySandboxOptions, verifySandboxActive } from './sandbox-verifier.js';

// ── Mock child_process.execFile ─────────────────────────────────────

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('node:os', () => ({
  platform: vi.fn(() => 'linux'),
}));

import { execFile } from 'node:child_process';
import { platform } from 'node:os';

const mockExecFile = vi.mocked(execFile);
const mockPlatform = vi.mocked(platform);

// ── Helpers ─────────────────────────────────────────────────────────

function createSilentLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as VerifySandboxOptions['logger'];
}

function makeOptions(overrides?: Partial<VerifySandboxOptions>): VerifySandboxOptions {
  return {
    pid: 12345,
    runtime: 'claude-code',
    logger: createSilentLogger(),
    ...overrides,
  };
}

/**
 * Helper to mock sequential execFile calls. Each entry maps to the
 * stdout value returned by the nth invocation.
 */
function mockExecFileResults(results: (string | Error)[]): void {
  let callIndex = 0;
  mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
    const result = results[callIndex] ?? new Error('No more mock results');
    callIndex++;
    if (result instanceof Error) {
      (callback as (err: Error | null, stdout: string) => void)(result, '');
    } else {
      (callback as (err: Error | null, stdout: string) => void)(null, result);
    }
    return undefined as never;
  });
}

// ── Tests ───────────────────────────────────────────────────────────

describe('verifySandboxActive', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-12T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns enforced=false when no PID is provided', async () => {
    const result = await verifySandboxActive(makeOptions({ pid: null }));

    expect(result.enforced).toBe(false);
    expect(result.method).toBe('none');
    expect(result.details).toContain('No agent PID');
    expect(result.checkedAt).toBe('2026-03-12T10:00:00.000Z');
  });

  it('detects bubblewrap on Linux when parent process is bwrap', async () => {
    mockPlatform.mockReturnValue('linux');

    // First call: ps -o comm= -p 12345 → agent process name
    // Second call: ps -o ppid= -p 12345 → parent PID
    // Third call: ps -o comm= -p 1000 → parent process name (bwrap)
    mockExecFileResults(['claude-code', '1000', 'bwrap']);

    const result = await verifySandboxActive(makeOptions());

    expect(result.enforced).toBe(true);
    expect(result.method).toBe('bubblewrap');
    expect(result.details).toContain('bubblewrap');
    expect(result.pid).toBe(12345);
  });

  it('detects Seatbelt on macOS', async () => {
    mockPlatform.mockReturnValue('darwin');

    // ps -o flags= -p 12345 → some flags
    // ps -o ppid= -p 12345 → parent PID
    // ps -o comm= -p 999 → parent comm
    mockExecFileResults(['40004', '999', 'sandbox-exec']);

    const result = await verifySandboxActive(makeOptions());

    expect(result.enforced).toBe(true);
    expect(result.method).toBe('seatbelt');
    expect(result.details).toContain('Seatbelt');
  });

  it('detects Codex --sandbox flag in process arguments', async () => {
    mockPlatform.mockReturnValue('linux');

    // ps -o args= -p 12345 → full command line
    mockExecFileResults(['codex --model gpt-5-codex --sandbox read-only']);

    const result = await verifySandboxActive(makeOptions({ runtime: 'codex' }));

    expect(result.enforced).toBe(true);
    expect(result.method).toBe('codex-sandbox');
    expect(result.details).toContain('--sandbox read-only');
  });

  it('returns enforced=false when Codex is launched without --sandbox', async () => {
    mockPlatform.mockReturnValue('linux');

    // ps -o args= -p 12345 → no --sandbox flag
    mockExecFileResults(['codex --model gpt-5-codex']);

    const result = await verifySandboxActive(makeOptions({ runtime: 'codex' }));

    expect(result.enforced).toBe(false);
    expect(result.method).toBe('none');
    expect(result.details).toContain('without --sandbox');
  });
});
