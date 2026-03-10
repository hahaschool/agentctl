import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkWorkdirSafety, createSandbox } from './workdir-safety.js';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function initGitRepo(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'agentctl-tests@example.com'], {
    cwd: dir,
    stdio: 'ignore',
  });
  execFileSync('git', ['config', 'user.name', 'AgentCTL Tests'], { cwd: dir, stdio: 'ignore' });
}

function commitFile(dir: string, relativePath: string, content: string): void {
  writeFileSync(join(dir, relativePath), content, 'utf-8');
  execFileSync('git', ['add', relativePath], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', `add ${relativePath}`], { cwd: dir, stdio: 'ignore' });
}

describe('checkWorkdirSafety', () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir && existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('returns safe for a clean git repository', async () => {
    const dir = makeTempDir('agentctl-safe-');
    initGitRepo(dir);
    commitFile(dir, 'README.md', 'hello');

    const result = await checkWorkdirSafety(dir, 1);

    expect(result.tier).toBe('safe');
    expect(result.isGitRepo).toBe(true);
    expect(result.hasUncommittedChanges).toBe(false);
    expect(result.parallelTaskCount).toBe(1);
  });

  it('returns guarded for a dirty git repository', async () => {
    const dir = makeTempDir('agentctl-guarded-');
    initGitRepo(dir);
    commitFile(dir, 'README.md', 'hello');
    writeFileSync(join(dir, 'README.md'), 'hello world', 'utf-8');

    const result = await checkWorkdirSafety(dir, 1);

    expect(result.tier).toBe('guarded');
    expect(result.isGitRepo).toBe(true);
    expect(result.hasUncommittedChanges).toBe(true);
    expect(result.warning).toContain('uncommitted');
  });

  it('returns risky for a non-git directory without parallel tasks', async () => {
    const dir = makeTempDir('agentctl-risky-');
    writeFileSync(join(dir, 'notes.txt'), 'todo', 'utf-8');

    const result = await checkWorkdirSafety(dir, 1);

    expect(result.tier).toBe('risky');
    expect(result.isGitRepo).toBe(false);
    expect(result.parallelTaskCount).toBe(1);
    expect(result.warning).toContain('not a git repository');
  });

  it('returns unsafe for a non-git directory with parallel tasks', async () => {
    const dir = makeTempDir('agentctl-unsafe-');
    writeFileSync(join(dir, 'notes.txt'), 'todo', 'utf-8');

    const result = await checkWorkdirSafety(dir, 2);

    expect(result.tier).toBe('unsafe');
    expect(result.isGitRepo).toBe(false);
    expect(result.parallelTaskCount).toBe(2);
    expect(result.blockReason).toContain('parallel');
  });
});

describe('createSandbox', () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir && existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('copies the workdir to a sandbox and copyBack persists changes', async () => {
    const dir = makeTempDir('agentctl-sandbox-');
    writeFileSync(join(dir, 'file.txt'), 'before', 'utf-8');

    const sandbox = await createSandbox(dir, 'task-123');

    expect(sandbox.originalPath).toBe(dir);
    expect(existsSync(join(sandbox.sandboxPath, 'file.txt'))).toBe(true);

    writeFileSync(join(sandbox.sandboxPath, 'file.txt'), 'after', 'utf-8');
    writeFileSync(join(sandbox.sandboxPath, 'new.txt'), 'created', 'utf-8');

    await sandbox.copyBack();
    await sandbox.cleanup();

    expect(existsSync(sandbox.sandboxPath)).toBe(false);
    expect(existsSync(join(dir, 'new.txt'))).toBe(true);
  });
});
