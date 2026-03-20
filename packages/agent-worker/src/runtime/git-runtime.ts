import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { WorkerError } from '@agentctl/shared';

const execFileAsync = promisify(execFile);

export function isGitUnavailableError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }

  const errno = 'code' in err ? (err as NodeJS.ErrnoException).code : undefined;
  if (errno === 'ENOENT') {
    return true;
  }

  return /spawn git ENOENT|git: not found|enoent/i.test(err.message);
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
