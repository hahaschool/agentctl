import { execFile } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { WorkdirSafetyTier } from '@agentctl/shared';
import { isGitUnavailableError } from './git-runtime.js';

const execFileAsync = promisify(execFile);

export type SafetyCheckResult = {
  tier: WorkdirSafetyTier;
  isGitRepo: boolean;
  hasUncommittedChanges: boolean;
  parallelTaskCount: number;
  warning?: string;
  blockReason?: string;
};

export type SandboxSetup = {
  sandboxPath: string;
  originalPath: string;
  copyBack: () => Promise<void>;
  cleanup: () => Promise<void>;
};

export async function checkWorkdirSafety(
  workdir: string,
  activeTaskCount: number,
): Promise<SafetyCheckResult> {
  const parallelTaskCount = Math.max(activeTaskCount, 0);
  const gitRepoState = await detectGitRepoState(workdir);

  if (gitRepoState === 'git_unavailable') {
    if (parallelTaskCount > 1) {
      return {
        tier: 'unsafe',
        isGitRepo: false,
        hasUncommittedChanges: false,
        parallelTaskCount,
        blockReason:
          'Git is unavailable and parallel tasks require worktree isolation before execution.',
      };
    }

    return {
      tier: 'guarded',
      isGitRepo: false,
      hasUncommittedChanges: false,
      parallelTaskCount,
      warning: 'Git is unavailable; worktree isolation and repository safety checks are disabled.',
    };
  }

  const isGitRepo = gitRepoState === 'repo';

  if (!isGitRepo) {
    if (parallelTaskCount > 1) {
      return {
        tier: 'unsafe',
        isGitRepo: false,
        hasUncommittedChanges: false,
        parallelTaskCount,
        blockReason: 'Working directory is not a git repository and has parallel tasks running.',
      };
    }

    return {
      tier: 'risky',
      isGitRepo: false,
      hasUncommittedChanges: false,
      parallelTaskCount,
      warning: 'Working directory is not a git repository.',
    };
  }

  const hasUncommittedChanges = await detectUncommittedChanges(workdir);
  if (hasUncommittedChanges) {
    return {
      tier: 'guarded',
      isGitRepo: true,
      hasUncommittedChanges: true,
      parallelTaskCount,
      warning: 'Working directory has uncommitted changes.',
    };
  }

  return {
    tier: 'safe',
    isGitRepo: true,
    hasUncommittedChanges: false,
    parallelTaskCount,
  };
}

export async function createSandbox(workdir: string, taskId: string): Promise<SandboxSetup> {
  const sandboxRoot = await mkdtemp(join(tmpdir(), `agentctl-sandbox-${sanitizeTaskId(taskId)}-`));
  const sandboxPath = join(sandboxRoot, 'workspace');

  await cp(workdir, sandboxPath, {
    recursive: true,
    force: true,
  });

  return {
    sandboxPath,
    originalPath: workdir,
    /**
     * Copy modified/new files from the sandbox back to the original workdir.
     *
     * NOTE: This operation is additive — files that were deleted inside the
     * sandbox are NOT removed from the original workdir. Only new and modified
     * files are overwritten. If full synchronisation (including deletions) is
     * needed, a different strategy (e.g. rsync --delete) must be used instead.
     */
    copyBack: async () => {
      await cp(sandboxPath, workdir, {
        recursive: true,
        force: true,
      });
    },
    cleanup: async () => {
      await rm(sandboxRoot, { recursive: true, force: true });
    },
  };
}

async function detectGitRepoState(
  workdir: string,
): Promise<'repo' | 'not_repo' | 'git_unavailable'> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: workdir,
    });
    return stdout.trim() === 'true' ? 'repo' : 'not_repo';
  } catch (err) {
    return isGitUnavailableError(err) ? 'git_unavailable' : 'not_repo';
  }
}

async function detectUncommittedChanges(workdir: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: workdir,
    });
    return stdout.trim().length > 0;
  } catch {
    // If git fails (e.g. corrupt repo, missing binary), treat the workdir as
    // dirty/guarded so it is NOT classified as safe for unattended writes.
    return true;
  }
}

function sanitizeTaskId(taskId: string): string {
  return taskId.replace(/[^a-zA-Z0-9_-]/g, '-');
}
