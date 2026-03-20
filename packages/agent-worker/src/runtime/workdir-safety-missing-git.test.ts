import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'node:child_process';
import { checkWorkdirSafety } from './workdir-safety.js';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('checkWorkdirSafety when git is unavailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(execFile).mockImplementation(
      (_cmd: string, _args: unknown, _opts: unknown, cb?: unknown) => {
        const callback = cb as (err: Error | null, result?: { stdout: string }) => void;
        const err = Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' });
        callback(err);
        return {} as ReturnType<typeof execFile>;
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir && existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('returns guarded for a single active task', async () => {
    const dir = makeTempDir('agentctl-missing-git-');
    const result = await checkWorkdirSafety(dir, 1);

    expect(result.tier).toBe('guarded');
    expect(result.parallelTaskCount).toBe(1);
    expect(result.warning).toContain('Git is unavailable');
  });

  it('returns unsafe when parallel tasks would need worktree isolation', async () => {
    const dir = makeTempDir('agentctl-missing-git-');
    const result = await checkWorkdirSafety(dir, 2);

    expect(result.tier).toBe('unsafe');
    expect(result.parallelTaskCount).toBe(2);
    expect(result.blockReason).toContain('Git is unavailable');
  });

  it('returns unsafe when the workdir is unavailable', async () => {
    const result = await checkWorkdirSafety('/tmp/agentctl-missing-workdir', 1);

    expect(result.tier).toBe('unsafe');
    expect(result.parallelTaskCount).toBe(1);
    expect(result.blockReason).toContain('does not exist or is unavailable');
  });
});
