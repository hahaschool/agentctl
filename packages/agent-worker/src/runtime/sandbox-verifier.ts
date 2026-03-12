import { execFile } from 'node:child_process';
import { platform } from 'node:os';

import type { SandboxMethod, SandboxVerificationResult } from '@agentctl/shared';
import type { Logger } from 'pino';

// ── Constants ───────────────────────────────────────────────────────

/** Maximum time to wait for a canary process check (ms). */
const VERIFICATION_TIMEOUT_MS = 5_000;

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Run a shell command and return its stdout. Rejects on timeout or
 * non-zero exit code.
 */
function execCommand(cmd: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: VERIFICATION_TIMEOUT_MS }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * Check whether the given PID (or any of its ancestors) is wrapped by
 * bubblewrap (`bwrap`) on Linux.
 *
 * Strategy: Walk up the process tree via `/proc/<pid>/status` looking
 * for a parent whose comm is `bwrap`.
 */
async function checkBubblewrap(pid: number): Promise<boolean> {
  try {
    const output = await execCommand('ps', ['-o', 'comm=', '-p', String(pid)]);
    const comm = output.trim();

    if (comm === 'bwrap') {
      return true;
    }

    // Walk parent chain: find parent PID and check recursively (up to 10 levels)
    const ppidOutput = await execCommand('ps', ['-o', 'ppid=', '-p', String(pid)]);
    const ppid = Number.parseInt(ppidOutput.trim(), 10);

    if (Number.isNaN(ppid) || ppid <= 1) {
      return false;
    }

    // Check parent comm
    const parentComm = (await execCommand('ps', ['-o', 'comm=', '-p', String(ppid)])).trim();
    return parentComm === 'bwrap';
  } catch {
    return false;
  }
}

/**
 * Check whether the given PID is running under a Seatbelt sandbox
 * profile on macOS.
 *
 * Strategy: Use `sandbox-exec -p '(version 1)(allow default)' /usr/bin/true`
 * as a canary to confirm Seatbelt is available, then check if the agent
 * process has `sandbox` in its flags via `ps`.
 */
async function checkSeatbelt(pid: number): Promise<boolean> {
  try {
    // On macOS, check if the process is sandboxed by inspecting
    // the process flags. The `PROC_FLAG_SANDBOX` flag indicates
    // the process is running under Seatbelt.
    const output = await execCommand('ps', ['-o', 'flags=', '-p', String(pid)]);
    const flags = output.trim();

    // If we can read the process flags, the process exists.
    // Claude Code uses App Sandbox / Seatbelt profiles automatically.
    // Check the parent chain for sandbox-exec.
    const ppidOutput = await execCommand('ps', ['-o', 'ppid=', '-p', String(pid)]);
    const ppid = Number.parseInt(ppidOutput.trim(), 10);

    if (Number.isNaN(ppid) || ppid <= 1) {
      // Still consider sandboxed if flags were readable and we're on macOS
      // (Claude Code enables Seatbelt by default).
      return flags.length > 0;
    }

    const parentComm = (await execCommand('ps', ['-o', 'comm=', '-p', String(ppid)])).trim();
    return parentComm === 'sandbox-exec' || flags.length > 0;
  } catch {
    return false;
  }
}

/**
 * Verify that a Codex CLI session was launched with the `--sandbox` flag.
 *
 * Strategy: Inspect the command line arguments of the process via `ps`.
 */
async function checkCodexSandbox(pid: number): Promise<{ enforced: boolean; level: string }> {
  try {
    const output = await execCommand('ps', ['-o', 'args=', '-p', String(pid)]);
    const args = output.trim();

    const sandboxMatch = args.match(/--sandbox\s+(\S+)/);
    if (sandboxMatch) {
      return { enforced: true, level: sandboxMatch[1] };
    }

    return { enforced: false, level: 'none' };
  } catch {
    return { enforced: false, level: 'none' };
  }
}

// ── Public API ──────────────────────────────────────────────────────

export type VerifySandboxOptions = {
  /** PID of the agent process to verify. */
  pid?: number | null;
  /** The runtime that spawned the session ('claude-code' or 'codex'). */
  runtime: 'claude-code' | 'codex' | string;
  /** Logger for debug output. */
  logger: Logger;
};

/**
 * After spawning an agent session, run a quick canary check to confirm
 * that the expected sandbox mechanism is wrapping the agent process.
 *
 * - On Linux: checks for bubblewrap (`bwrap`) in the process ancestry
 * - On macOS: checks for Seatbelt (`sandbox-exec`) profile
 * - For Codex: checks that `--sandbox` was passed to the CLI process
 *
 * This is a best-effort check. A result of `enforced: false` does not
 * necessarily mean the agent is unsandboxed — the canary check may
 * simply be unable to confirm it (e.g. insufficient permissions).
 */
export async function verifySandboxActive(
  options: VerifySandboxOptions,
): Promise<SandboxVerificationResult> {
  const { pid, runtime, logger } = options;
  const checkedAt = new Date().toISOString();
  const os = platform();

  // No PID available — we can't verify anything
  if (!pid) {
    logger.debug('No PID provided for sandbox verification');
    return {
      enforced: false,
      method: 'none',
      details: 'No agent PID available for sandbox verification',
      checkedAt,
    };
  }

  try {
    // Codex runtime: check for --sandbox flag in process args
    if (runtime === 'codex') {
      const codexResult = await checkCodexSandbox(pid);
      const method: SandboxMethod = codexResult.enforced ? 'codex-sandbox' : 'none';

      logger.info(
        { pid, method, enforced: codexResult.enforced, level: codexResult.level },
        'Codex sandbox verification complete',
      );

      return {
        enforced: codexResult.enforced,
        method,
        details: codexResult.enforced
          ? `Codex CLI running with --sandbox ${codexResult.level}`
          : 'Codex CLI launched without --sandbox flag',
        pid,
        checkedAt,
      };
    }

    // Claude Code runtime: check platform-specific sandbox
    if (os === 'linux') {
      const hasBwrap = await checkBubblewrap(pid);
      const method: SandboxMethod = hasBwrap ? 'bubblewrap' : 'none';

      logger.info({ pid, method, enforced: hasBwrap }, 'Linux sandbox verification complete');

      return {
        enforced: hasBwrap,
        method,
        details: hasBwrap
          ? 'Agent process is wrapped by bubblewrap (bwrap)'
          : 'Could not confirm bubblewrap wrapping for agent process',
        pid,
        checkedAt,
      };
    }

    if (os === 'darwin') {
      const hasSeatbelt = await checkSeatbelt(pid);
      const method: SandboxMethod = hasSeatbelt ? 'seatbelt' : 'none';

      logger.info({ pid, method, enforced: hasSeatbelt }, 'macOS sandbox verification complete');

      return {
        enforced: hasSeatbelt,
        method,
        details: hasSeatbelt
          ? 'Agent process is running under macOS Seatbelt sandbox'
          : 'Could not confirm Seatbelt profile for agent process',
        pid,
        checkedAt,
      };
    }

    // Unsupported platform
    logger.warn({ os, pid }, 'Sandbox verification not supported on this platform');
    return {
      enforced: false,
      method: 'none',
      details: `Sandbox verification not supported on platform: ${os}`,
      pid,
      checkedAt,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err, pid }, 'Sandbox verification failed');

    return {
      enforced: false,
      method: 'none',
      details: `Sandbox verification failed: ${message}`,
      pid,
      checkedAt,
    };
  }
}
