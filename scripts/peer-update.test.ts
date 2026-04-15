import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  appendHistory,
  type FetchFn,
  findLastSuccessfulTag,
  type HistoryEntry,
  hasSuccessfulEntryForTag,
  PeerUpdateError,
  parseArgs,
  readHistory,
  runPeerUpdate,
  setExecOverride,
  setFetchOverride,
} from './peer-update.js';

// ---------------------------------------------------------------------------
// Test harness helpers
// ---------------------------------------------------------------------------

type ExecCall = { cmd: string; args: readonly string[] };

type MockExec = {
  readonly calls: ExecCall[];
  impl: (
    cmd: string,
    args: readonly string[],
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
};

function makeMockExec(): MockExec {
  const calls: ExecCall[] = [];
  const mock: MockExec = {
    calls,
    impl: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
  };
  setExecOverride(async (cmd, args) => {
    calls.push({ cmd, args });
    return mock.impl(cmd, args);
  });
  return mock;
}

function makeFetch(matchTag: string, matchAfter = 0): FetchFn {
  let attempts = 0;
  return async () => {
    attempts += 1;
    if (attempts > matchAfter) {
      return { ok: true, body: { appVersion: matchTag } };
    }
    return { ok: false };
  };
}

function silentLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeTmpHistory(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'peer-update-test-'));
  return path.join(dir, 'update-history.json');
}

beforeEach(() => {
  setExecOverride(null);
  setFetchOverride(null);
});

afterEach(() => {
  setExecOverride(null);
  setFetchOverride(null);
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  it('parses flags and --tag value', () => {
    const flags = parseArgs(['--tag', 'v0.3.4', '--dry-run', '--no-attestation']);
    expect(flags.tag).toBe('v0.3.4');
    expect(flags.dryRun).toBe(true);
    expect(flags.noAttestation).toBe(true);
    expect(flags.rollback).toBe(false);
  });

  it('supports --tag=value form', () => {
    const flags = parseArgs(['--tag=v1.2.3']);
    expect(flags.tag).toBe('v1.2.3');
  });

  it('throws on unknown argument', () => {
    expect(() => parseArgs(['--totally-unknown'])).toThrow(PeerUpdateError);
  });

  it('returns help flag for -h', () => {
    expect(parseArgs(['-h']).help).toBe(true);
    expect(parseArgs(['help']).help).toBe(true);
  });
});

describe('history file', () => {
  it('appends and caps entries at 100', () => {
    const file = makeTmpHistory();
    const base: HistoryEntry = {
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:01:00.000Z',
      fromTag: 'v0.0.1',
      toTag: 'v0.0.2',
      success: true,
      dryRun: false,
    };
    for (let i = 0; i < 105; i += 1) {
      appendHistory({ ...base, toTag: `v0.0.${String(i + 2)}` }, file, 100);
    }
    const read = readHistory(file);
    expect(read).toHaveLength(100);
    expect(read[0]?.toTag).toBe('v0.0.7'); // oldest 5 dropped
    expect(read[99]?.toTag).toBe('v0.0.106');
  });

  it('picks the most recent successful non-dry-run tag', () => {
    const entries: HistoryEntry[] = [
      {
        startedAt: 't',
        finishedAt: 't',
        fromTag: null,
        toTag: 'v1.0.0',
        success: true,
        dryRun: false,
      },
      {
        startedAt: 't',
        finishedAt: 't',
        fromTag: 'v1.0.0',
        toTag: 'v1.1.0',
        success: true,
        dryRun: true, // dry-run should be ignored
      },
      {
        startedAt: 't',
        finishedAt: 't',
        fromTag: 'v1.0.0',
        toTag: 'v1.1.0',
        success: false,
        dryRun: false,
      },
    ];
    expect(findLastSuccessfulTag(entries)).toBe('v1.0.0');
    expect(findLastSuccessfulTag(entries, 'v1.0.0')).toBeNull();
  });

  it('hasSuccessfulEntryForTag ignores dry-run + failed entries', () => {
    const entries: HistoryEntry[] = [
      {
        startedAt: 't',
        finishedAt: 't',
        fromTag: null,
        toTag: 'v0.3.2',
        success: true,
        dryRun: true, // dry-run must be ignored
      },
      {
        startedAt: 't',
        finishedAt: 't',
        fromTag: null,
        toTag: 'v0.3.3',
        success: false,
        dryRun: false,
      },
      {
        startedAt: 't',
        finishedAt: 't',
        fromTag: null,
        toTag: 'v0.3.4',
        success: true,
        dryRun: false,
      },
    ];
    expect(hasSuccessfulEntryForTag(entries, 'v0.3.2')).toBe(false);
    expect(hasSuccessfulEntryForTag(entries, 'v0.3.3')).toBe(false);
    expect(hasSuccessfulEntryForTag(entries, 'v0.3.4')).toBe(true);
    expect(hasSuccessfulEntryForTag(entries, 'v9.9.9')).toBe(false);
  });
});

describe('runPeerUpdate dry-run', () => {
  it('prints each step without invoking mutation commands', async () => {
    const mock = makeMockExec();
    const history = makeTmpHistory();

    const result = await runPeerUpdate({
      flags: {
        tag: 'v0.3.4',
        dryRun: true,
        rollback: false,
        noAttestation: false,
        help: false,
      },
      historyFile: history,
      logger: silentLogger(),
    });

    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.toTag).toBe('v0.3.4');
    // No exec calls for mutation steps; we still accept `git describe` lookups.
    const mutationCalls = mock.calls.filter(
      (c) =>
        c.cmd === 'pnpm' ||
        c.cmd === 'pm2' ||
        (c.cmd === 'git' && c.args[0] === 'checkout') ||
        (c.cmd === 'git' && c.args[0] === 'fetch'),
    );
    expect(mutationCalls).toHaveLength(0);
    // Every step must be marked dryRun
    expect(result.steps.every((s) => s.dryRun)).toBe(true);
  });
});

describe('runPeerUpdate full flow', () => {
  it('uses --tag override and does not call gh api', async () => {
    const mock = makeMockExec();
    mock.impl = async (cmd, args) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return { stdout: 'v0.3.3\n', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    };
    setFetchOverride(makeFetch('v0.3.4'));
    const history = makeTmpHistory();

    const result = await runPeerUpdate({
      flags: {
        tag: 'v0.3.4',
        dryRun: false,
        rollback: false,
        noAttestation: true,
        help: false,
      },
      historyFile: history,
      healthTimeoutMs: 2_000,
      healthIntervalMs: 10,
      logger: silentLogger(),
    });

    expect(result.success).toBe(true);
    expect(result.toTag).toBe('v0.3.4');
    const ghApiCall = mock.calls.find((c) => c.cmd === 'gh' && c.args[0] === 'api');
    expect(ghApiCall).toBeUndefined();
    const persisted = readHistory(history);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.success).toBe(true);
    expect(persisted[0]?.toTag).toBe('v0.3.4');
  });

  it('logs a warning when attestations are not enabled but still succeeds', async () => {
    const mock = makeMockExec();
    mock.impl = async (cmd, args) => {
      if (cmd === 'gh' && args[0] === 'attestation') {
        return {
          stdout: '',
          stderr: 'no attestations found for ref',
          exitCode: 1,
        };
      }
      if (cmd === 'git' && args[0] === 'describe') {
        return { stdout: 'v0.3.3\n', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    };
    setFetchOverride(makeFetch('v0.3.4'));
    const history = makeTmpHistory();
    const logger = silentLogger();

    const result = await runPeerUpdate({
      flags: {
        tag: 'v0.3.4',
        dryRun: false,
        rollback: false,
        noAttestation: false, // attestation attempted, will be skipped gracefully
        help: false,
      },
      historyFile: history,
      healthTimeoutMs: 2_000,
      healthIntervalMs: 10,
      logger,
    });

    expect(result.success).toBe(true);
    expect(result.attestationSkipped).toBe(true);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('rolls back when health poll times out', async () => {
    const mock = makeMockExec();
    mock.impl = async (cmd, args) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return { stdout: 'v0.3.3\n', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    };
    // Never matches the target tag
    setFetchOverride(async () => ({ ok: true, body: { appVersion: 'v0.0.0' } }));
    const history = makeTmpHistory();

    const result = await runPeerUpdate({
      flags: {
        tag: 'v0.3.4',
        dryRun: false,
        rollback: false,
        noAttestation: true,
        help: false,
      },
      historyFile: history,
      healthTimeoutMs: 50,
      healthIntervalMs: 10,
      logger: silentLogger(),
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('HEALTH_TIMEOUT');
    expect(result.rolledBack).toBe(true);
    // Rollback should have issued `git checkout v0.3.3` + pnpm build + pm2 reload.
    const rollbackCheckout = mock.calls.find(
      (c) => c.cmd === 'git' && c.args[0] === 'checkout' && c.args[1] === 'v0.3.3',
    );
    expect(rollbackCheckout).toBeDefined();
  });

  it('rollback flag picks the previous successful tag from history', async () => {
    const history = makeTmpHistory();
    appendHistory(
      {
        startedAt: 't',
        finishedAt: 't',
        fromTag: null,
        toTag: 'v0.3.0',
        success: true,
        dryRun: false,
      },
      history,
    );
    appendHistory(
      {
        startedAt: 't',
        finishedAt: 't',
        fromTag: 'v0.3.0',
        toTag: 'v0.3.1',
        success: true,
        dryRun: false,
      },
      history,
    );

    const mock = makeMockExec();
    mock.impl = async (cmd, args) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return { stdout: 'v0.3.1\n', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    };
    setFetchOverride(makeFetch('v0.3.0'));

    const result = await runPeerUpdate({
      flags: {
        tag: undefined,
        dryRun: false,
        rollback: true,
        noAttestation: false,
        help: false,
      },
      historyFile: history,
      healthTimeoutMs: 2_000,
      healthIntervalMs: 10,
      logger: silentLogger(),
    });

    expect(result.success).toBe(true);
    expect(result.toTag).toBe('v0.3.0');
    // No gh attestation verify on rollback path (already verified previously).
    const attestationCall = mock.calls.find((c) => c.cmd === 'gh' && c.args[0] === 'attestation');
    expect(attestationCall).toBeUndefined();
  });

  it('rollback fails cleanly when no prior successful tag exists', async () => {
    const history = makeTmpHistory();
    makeMockExec();

    const result = await runPeerUpdate({
      flags: {
        tag: undefined,
        dryRun: false,
        rollback: true,
        noAttestation: false,
        help: false,
      },
      historyFile: history,
      healthTimeoutMs: 100,
      healthIntervalMs: 10,
      logger: silentLogger(),
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('NO_ROLLBACK_TARGET');
  });

  it('--rollback --tag targets the explicit tag iff it is in history', async () => {
    const history = makeTmpHistory();
    appendHistory(
      {
        startedAt: 't',
        finishedAt: 't',
        fromTag: null,
        toTag: 'v0.2.9',
        success: true,
        dryRun: false,
      },
      history,
    );
    appendHistory(
      {
        startedAt: 't',
        finishedAt: 't',
        fromTag: 'v0.2.9',
        toTag: 'v0.3.0',
        success: true,
        dryRun: false,
      },
      history,
    );
    appendHistory(
      {
        startedAt: 't',
        finishedAt: 't',
        fromTag: 'v0.3.0',
        toTag: 'v0.3.1',
        success: true,
        dryRun: false,
      },
      history,
    );

    const mock = makeMockExec();
    mock.impl = async (cmd, args) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return { stdout: 'v0.3.1\n', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    };
    // Target is the older (but previously-applied) v0.2.9, not the last entry.
    setFetchOverride(makeFetch('v0.2.9'));

    const result = await runPeerUpdate({
      flags: {
        tag: 'v0.2.9',
        dryRun: false,
        rollback: true,
        noAttestation: false,
        help: false,
      },
      historyFile: history,
      healthTimeoutMs: 2_000,
      healthIntervalMs: 10,
      logger: silentLogger(),
    });

    expect(result.success).toBe(true);
    expect(result.toTag).toBe('v0.2.9');
    expect(result.mode).toBe('rollback');
    expect(result.rolledBackFrom).toBe('v0.3.1');
    expect(result.attestationSkipped).toBe(true);
    // Attestation must not be invoked on the rollback path.
    const attestationCall = mock.calls.find((c) => c.cmd === 'gh' && c.args[0] === 'attestation');
    expect(attestationCall).toBeUndefined();

    const persisted = readHistory(history);
    const last = persisted[persisted.length - 1];
    expect(last?.mode).toBe('rollback');
    expect(last?.rolledBackFrom).toBe('v0.3.1');
    expect(last?.toTag).toBe('v0.2.9');
    expect(last?.success).toBe(true);
  });

  it('--rollback --tag refuses a tag that was never successfully applied', async () => {
    const history = makeTmpHistory();
    appendHistory(
      {
        startedAt: 't',
        finishedAt: 't',
        fromTag: null,
        toTag: 'v0.3.0',
        success: true,
        dryRun: false,
      },
      history,
    );
    makeMockExec();

    const result = await runPeerUpdate({
      flags: {
        tag: 'v0.9.9', // never applied on this node
        dryRun: false,
        rollback: true,
        noAttestation: false,
        help: false,
      },
      historyFile: history,
      healthTimeoutMs: 100,
      healthIntervalMs: 10,
      logger: silentLogger(),
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('ROLLBACK_TARGET_NOT_IN_HISTORY');
  });

  it('--tag without --rollback still verifies attestation (forward-roll)', async () => {
    const mock = makeMockExec();
    mock.impl = async (cmd, args) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return { stdout: 'v0.3.3\n', stderr: '', exitCode: 0 };
      }
      if (cmd === 'gh' && args[0] === 'attestation') {
        return { stdout: 'verified', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    };
    setFetchOverride(makeFetch('v0.3.4'));
    const history = makeTmpHistory();

    const result = await runPeerUpdate({
      flags: {
        tag: 'v0.3.4',
        dryRun: false,
        rollback: false,
        // noAttestation false — we want the real gh attestation call.
        noAttestation: false,
        help: false,
      },
      historyFile: history,
      healthTimeoutMs: 2_000,
      healthIntervalMs: 10,
      logger: silentLogger(),
    });

    expect(result.success).toBe(true);
    expect(result.mode).toBe('forward');
    expect(result.attestationVerified).toBe(true);
    expect(result.attestationSkipped).toBe(false);
    const attestationCall = mock.calls.find((c) => c.cmd === 'gh' && c.args[0] === 'attestation');
    expect(attestationCall).toBeDefined();
    // And never consults gh api (--tag skips the "find latest release" step).
    const ghApiCall = mock.calls.find((c) => c.cmd === 'gh' && c.args[0] === 'api');
    expect(ghApiCall).toBeUndefined();

    // Persisted entry should record mode=forward (no rolledBackFrom).
    const persisted = readHistory(history);
    const last = persisted[persisted.length - 1];
    expect(last?.mode).toBe('forward');
    expect(last?.rolledBackFrom).toBeUndefined();
  });

  it('persists rollback history with mode=rollback + rolledBackFrom on success', async () => {
    const history = makeTmpHistory();
    appendHistory(
      {
        startedAt: 't',
        finishedAt: 't',
        fromTag: null,
        toTag: 'v0.3.0',
        success: true,
        dryRun: false,
      },
      history,
    );
    appendHistory(
      {
        startedAt: 't',
        finishedAt: 't',
        fromTag: 'v0.3.0',
        toTag: 'v0.3.1',
        success: true,
        dryRun: false,
      },
      history,
    );

    const mock = makeMockExec();
    mock.impl = async (cmd, args) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return { stdout: 'v0.3.1\n', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    };
    setFetchOverride(makeFetch('v0.3.0'));

    const result = await runPeerUpdate({
      flags: {
        tag: undefined,
        dryRun: false,
        rollback: true,
        noAttestation: false,
        help: false,
      },
      historyFile: history,
      healthTimeoutMs: 2_000,
      healthIntervalMs: 10,
      logger: silentLogger(),
    });

    expect(result.success).toBe(true);
    expect(result.mode).toBe('rollback');
    expect(result.rolledBackFrom).toBe('v0.3.1');

    const persisted = readHistory(history);
    expect(persisted).toHaveLength(3);
    const last = persisted[persisted.length - 1];
    expect(last?.mode).toBe('rollback');
    expect(last?.rolledBackFrom).toBe('v0.3.1');
    expect(last?.toTag).toBe('v0.3.0');
    // Prior (forward) entries should NOT have been mutated.
    expect(persisted[0]?.mode).toBeUndefined();
    expect(persisted[1]?.mode).toBeUndefined();
    // And the mutation commands must still have been issued.
    const checkoutCall = mock.calls.find(
      (c) => c.cmd === 'git' && c.args[0] === 'checkout' && c.args[1] === 'v0.3.0',
    );
    expect(checkoutCall).toBeDefined();
  });

  it('resolves latest tag via gh api when --tag is omitted', async () => {
    const mock = makeMockExec();
    mock.impl = async (cmd, args) => {
      if (cmd === 'gh' && args[0] === 'api') {
        return { stdout: 'v9.9.9\n', stderr: '', exitCode: 0 };
      }
      if (cmd === 'git' && args[0] === 'describe') {
        return { stdout: 'v9.9.8\n', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    };
    setFetchOverride(makeFetch('v9.9.9'));
    const history = makeTmpHistory();

    const result = await runPeerUpdate({
      flags: {
        tag: undefined,
        dryRun: false,
        rollback: false,
        noAttestation: true,
        help: false,
      },
      historyFile: history,
      healthTimeoutMs: 1_000,
      healthIntervalMs: 10,
      logger: silentLogger(),
    });

    expect(result.success).toBe(true);
    expect(result.toTag).toBe('v9.9.9');
    const ghApi = mock.calls.find((c) => c.cmd === 'gh' && c.args[0] === 'api');
    expect(ghApi).toBeDefined();
  });

  it('skips checkout when already on the target tag', async () => {
    const mock = makeMockExec();
    mock.impl = async (cmd, args) => {
      if (cmd === 'git' && args[0] === 'describe') {
        return { stdout: 'v0.3.4\n', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    };
    setFetchOverride(makeFetch('v0.3.4'));
    const history = makeTmpHistory();

    const result = await runPeerUpdate({
      flags: {
        tag: 'v0.3.4',
        dryRun: false,
        rollback: false,
        noAttestation: true,
        help: false,
      },
      historyFile: history,
      healthTimeoutMs: 1_000,
      healthIntervalMs: 10,
      logger: silentLogger(),
    });

    expect(result.success).toBe(true);
    const fetchCall = mock.calls.find((c) => c.cmd === 'git' && c.args[0] === 'fetch');
    expect(fetchCall).toBeUndefined();
    const checkoutCall = mock.calls.find((c) => c.cmd === 'git' && c.args[0] === 'checkout');
    expect(checkoutCall).toBeUndefined();
  });
});
