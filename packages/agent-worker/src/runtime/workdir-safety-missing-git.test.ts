import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'node:child_process';
import { checkWorkdirSafety } from './workdir-safety.js';

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
  });

  it('returns guarded for a single active task', async () => {
    const result = await checkWorkdirSafety('/tmp/project', 1);

    expect(result.tier).toBe('guarded');
    expect(result.parallelTaskCount).toBe(1);
    expect(result.warning).toContain('Git is unavailable');
  });

  it('returns unsafe when parallel tasks would need worktree isolation', async () => {
    const result = await checkWorkdirSafety('/tmp/project', 2);

    expect(result.tier).toBe('unsafe');
    expect(result.parallelTaskCount).toBe(2);
    expect(result.blockReason).toContain('Git is unavailable');
  });
});
