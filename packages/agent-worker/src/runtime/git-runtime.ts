import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { WorkerError } from '@agentctl/shared';

const execFileAsync = promisify(execFile);

export function isGitUnavailableError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }

  const nodeErr = err as NodeJS.ErrnoException;
  const errno = nodeErr.code;
  const syscall = typeof nodeErr.syscall === 'string' ? nodeErr.syscall : '';
  const path = typeof nodeErr.path === 'string' ? nodeErr.path : '';

  if (errno === 'ENOENT' && (path === 'git' || /^spawn git\b/i.test(syscall))) {
    return true;
  }

  return /spawn git ENOENT|git: not found/i.test(err.message);
}

export async function isGitBinaryAvailable(): Promise<boolean> {
  try {
    await execFileAsync('git', ['--version']);
    return true;
  } catch (err) {
    if (isGitUnavailableError(err)) {
      return false;
    }

    throw err;
  }
}

export function createGitUnavailableError(args: string[], cwd?: string): WorkerError {
  return new WorkerError('GIT_UNAVAILABLE', 'Git is not available in this worker runtime', {
    args,
    cwd,
  });
}
