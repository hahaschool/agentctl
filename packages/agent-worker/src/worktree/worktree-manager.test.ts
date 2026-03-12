import { mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { AgentError } from '@agentctl/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../test-helpers.js';
import { WorktreeManager, type WorktreeManagerOptions } from './worktree-manager.js';

// ── Mock child_process.execFile ────────────────────────────────────────────

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

// After mocking, import the module so we can control the mock.
import { execFile } from 'node:child_process';

type ExecFileCallback = (...args: never[]) => unknown;

/**
 * Type-safe wrapper around the mocked execFile. The real module is promisified
 * inside worktree-manager.ts via `promisify(execFile)`, which turns it into a
 * function returning `Promise<{ stdout, stderr }>`.  Because `promisify` reads
 * the mock at call-time, we just need the callback-style mock to invoke the
 * callback with the desired result.
 */
function mockExecFileSuccess(stdout = '', stderr = ''): void {
  (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb?: ExecFileCallback) => {
      // promisify calls execFile(cmd, args, opts, cb)
      if (typeof cb === 'function') {
        (cb as (err: null, result: { stdout: string; stderr: string }) => void)(null, {
          stdout,
          stderr,
        });
      } else if (typeof _opts === 'function') {
        // promisify might pass (cmd, args, cb) without opts
        (_opts as (err: null, result: { stdout: string; stderr: string }) => void)(null, {
          stdout,
          stderr,
        });
      }
    },
  );
}

function mockExecFileFailure(message: string): void {
  (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb?: ExecFileCallback) => {
      const err = new Error(message);
      if (typeof cb === 'function') {
        (cb as (err: Error) => void)(err);
      } else if (typeof _opts === 'function') {
        (_opts as (err: Error) => void)(err);
      }
    },
  );
}

/**
 * Set up a sequence of execFile outcomes (resolved/rejected).  Each call to
 * execFile will shift the next entry off the queue.
 */
function mockExecFileSequence(
  steps: Array<{ stdout?: string; stderr?: string } | { error: string }>,
): void {
  const queue = [...steps];

  (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb?: ExecFileCallback) => {
      const next = queue.shift();
      const callback: ((...args: unknown[]) => void) | null =
        typeof cb === 'function'
          ? (cb as (...args: unknown[]) => void)
          : typeof _opts === 'function'
            ? (_opts as (...args: unknown[]) => void)
            : null;

      if (!callback) return;

      if (!next) {
        callback(null, { stdout: '', stderr: '' });
        return;
      }

      if ('error' in next) {
        callback(new Error(next.error));
      } else {
        callback(null, { stdout: next.stdout ?? '', stderr: next.stderr ?? '' });
      }
    },
  );
}

// ── Mock logger ────────────────────────────────────────────────────────────

const mockLogger = createMockLogger();

// ── Helpers ────────────────────────────────────────────────────────────────

const PROJECT_PATH = '/home/user/my-project';
const DEFAULT_TREES_DIR = path.join(PROJECT_PATH, '.trees');

function makeOptions(overrides?: Partial<WorktreeManagerOptions>): WorktreeManagerOptions {
  return {
    projectPath: PROJECT_PATH,
    logger: mockLogger,
    ...overrides,
  };
}

/** Standard porcelain output for a single worktree */
function porcelainBlock(opts: {
  path: string;
  head?: string;
  branch?: string;
  locked?: boolean;
  bare?: boolean;
}): string {
  const lines = [`worktree ${opts.path}`];
  if (opts.bare) {
    lines.push('bare');
  } else {
    lines.push(`HEAD ${opts.head ?? 'abc1234567890abcdef1234567890abcdef123456'}`);
    if (opts.branch) {
      lines.push(`branch refs/heads/${opts.branch}`);
    } else {
      lines.push('detached');
    }
    if (opts.locked) {
      lines.push('locked');
    }
  }
  return lines.join('\n');
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('WorktreeManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Constructor ──────────────────────────────────────────────────────

  describe('constructor', () => {
    it('stores projectPath from options', () => {
      const manager = new WorktreeManager(makeOptions());

      expect(manager.getWorktreePath('test')).toBe(path.join(DEFAULT_TREES_DIR, 'agent-test'));
    });

    it('defaults treesDir to <projectPath>/.trees', () => {
      const manager = new WorktreeManager(makeOptions());

      // Verify the default trees dir by checking path construction
      const expected = path.join(PROJECT_PATH, '.trees', 'agent-foo');
      expect(manager.getWorktreePath('foo')).toBe(expected);
    });

    it('accepts a custom treesDir', () => {
      const customDir = '/custom/worktrees';
      const manager = new WorktreeManager(makeOptions({ treesDir: customDir }));

      expect(manager.getWorktreePath('bar')).toBe(path.join(customDir, 'agent-bar'));
    });
  });

  // ── getWorktreePath ──────────────────────────────────────────────────

  describe('getWorktreePath', () => {
    it('returns <treesDir>/agent-<agentId>', () => {
      const manager = new WorktreeManager(makeOptions());

      expect(manager.getWorktreePath('abc')).toBe(path.join(DEFAULT_TREES_DIR, 'agent-abc'));
    });

    it('handles agent IDs with hyphens', () => {
      const manager = new WorktreeManager(makeOptions());

      expect(manager.getWorktreePath('my-agent-1')).toBe(
        path.join(DEFAULT_TREES_DIR, 'agent-my-agent-1'),
      );
    });

    it('handles numeric agent IDs', () => {
      const manager = new WorktreeManager(makeOptions());

      expect(manager.getWorktreePath('42')).toBe(path.join(DEFAULT_TREES_DIR, 'agent-42'));
    });
  });

  // ── create ───────────────────────────────────────────────────────────

  describe('create', () => {
    it('assigns the first available dev tier and bootstraps env sourcing in the worktree', async () => {
      const projectPath = await mkdtemp(path.join(tmpdir(), 'worktree-manager-'));
      const expectedPath = path.join(projectPath, '.trees', 'agent-tiered');
      const sourceEnvPath = path.join(projectPath, '.env.dev-1');

      try {
        await writeFile(sourceEnvPath, 'TIER=dev-1\nPORT=8180\n');

        const manager = new WorktreeManager(makeOptions({ projectPath }));

        mockExecFileSequence([
          { stdout: '.git\n' }, // assertGitRepo
          { stdout: '.git\n' }, // assertGitRepo (inside list for exists)
          { stdout: '' }, // list (empty)
          { error: 'not a valid ref' }, // branchExists
          { stdout: '' }, // flock dev-1
          { stdout: '' }, // git worktree add
          { stdout: '.git\n' }, // assertGitRepo (inside list for get)
          {
            stdout: porcelainBlock({
              path: expectedPath,
              branch: 'agent-tiered/work',
              head: 'deadbeef',
            }),
          }, // list (for get)
        ]);

        const result = await manager.create({ agentId: 'tiered', projectPath });

        expect(result.tier).toBe('dev-1');
        expect(result.envFilePath).toBe(path.join(expectedPath, '.env.dev-1'));
        expect(result.envLoadCommand).toBe('source ./.agentctl/source-tier-env.sh');

        expect(await readlink(path.join(expectedPath, '.env.dev-1'))).toBe(
          path.relative(expectedPath, sourceEnvPath),
        );

        const bootstrapScript = await readFile(
          path.join(expectedPath, '.agentctl', 'source-tier-env.sh'),
          'utf8',
        );
        expect(bootstrapScript).toContain('source "${WORKTREE_ROOT}/.env.dev-1"');

        const calls = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls;
        const flockCall = calls.find(
          (c: unknown[]) => c[0] === 'flock' && Array.isArray(c[1]) && c[1][2] === '-c',
        );
        expect(flockCall?.[1]).toEqual(['-n', '/tmp/agentctl-tier-locks/dev-1.lock', '-c', 'true']);
      } finally {
        await rm(projectPath, { recursive: true, force: true });
      }
    });

    it('skips locked dev tiers and assigns the next available tier', async () => {
      const projectPath = await mkdtemp(path.join(tmpdir(), 'worktree-manager-'));
      const expectedPath = path.join(projectPath, '.trees', 'agent-tiered-2');

      try {
        await writeFile(path.join(projectPath, '.env.dev-1'), 'TIER=dev-1\nPORT=8180\n');
        await writeFile(path.join(projectPath, '.env.dev-2'), 'TIER=dev-2\nPORT=8280\n');

        const manager = new WorktreeManager(makeOptions({ projectPath }));

        mockExecFileSequence([
          { stdout: '.git\n' }, // assertGitRepo
          { stdout: '.git\n' }, // assertGitRepo (inside list for exists)
          { stdout: '' }, // list (empty)
          { error: 'not a valid ref' }, // branchExists
          { error: 'lock held' }, // flock dev-1
          { stdout: '' }, // flock dev-2
          { stdout: '' }, // git worktree add
          { stdout: '.git\n' }, // assertGitRepo (inside list for get)
          {
            stdout: porcelainBlock({
              path: expectedPath,
              branch: 'agent-tiered-2/work',
              head: 'deadbeef',
            }),
          }, // list (for get)
        ]);

        const result = await manager.create({ agentId: 'tiered-2', projectPath });

        expect(result.tier).toBe('dev-2');
        expect(result.envFilePath).toBe(path.join(expectedPath, '.env.dev-2'));

        const calls = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls;
        const flockCalls = calls.filter((c: unknown[]) => c[0] === 'flock');
        expect(flockCalls).toHaveLength(2);
        expect(flockCalls[0]?.[1]).toEqual(['-n', '/tmp/agentctl-tier-locks/dev-1.lock', '-c', 'true']);
        expect(flockCalls[1]?.[1]).toEqual(['-n', '/tmp/agentctl-tier-locks/dev-2.lock', '-c', 'true']);
      } finally {
        await rm(projectPath, { recursive: true, force: true });
      }
    });

    it('calls git worktree add with correct arguments', async () => {
      const manager = new WorktreeManager(makeOptions());
      const expectedPath = path.join(DEFAULT_TREES_DIR, 'agent-a1');

      // Full call sequence:
      // 1. assertGitRepo(options.projectPath)
      // 2. exists → get → list → assertGitRepo(this.projectPath) + git worktree list
      // 3. branchExists
      // 4. git worktree add
      // 5. get → list → assertGitRepo(this.projectPath) + git worktree list
      mockExecFileSequence([
        { stdout: '.git\n' }, // 1. assertGitRepo
        { stdout: '.git\n' }, // 2a. assertGitRepo (inside list)
        { stdout: '' }, // 2b. list (empty = no existing worktrees)
        { error: 'not a valid ref' }, // 3. branchExists → branch does not exist
        { stdout: '' }, // 4. git worktree add
        { stdout: '.git\n' }, // 5a. assertGitRepo (inside list for get)
        {
          stdout: porcelainBlock({
            path: expectedPath,
            branch: 'agent-a1/work',
            head: 'deadbeef',
          }),
        }, // 5b. list (for get)
      ]);

      const result = await manager.create({ agentId: 'a1', projectPath: PROJECT_PATH });

      expect(result.path).toBe(expectedPath);
      expect(result.branch).toBe('agent-a1/work');
      expect(result.head).toBe('deadbeef');
      expect(result.isLocked).toBe(false);

      // Verify that `git worktree add` was called with the right args
      const calls = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const addCall = calls.find(
        (c: unknown[]) =>
          c[0] === 'git' && Array.isArray(c[1]) && c[1][0] === 'worktree' && c[1][1] === 'add',
      );
      expect(addCall).toBeDefined();
      expect(addCall?.[1]).toEqual([
        'worktree',
        'add',
        expectedPath,
        '-b',
        'agent-a1/work',
        'main',
      ]);
      expect(addCall?.[2]).toEqual({ cwd: PROJECT_PATH });
    });

    it('uses default description "work" when none provided', async () => {
      const manager = new WorktreeManager(makeOptions());
      const expectedPath = path.join(DEFAULT_TREES_DIR, 'agent-a1');

      mockExecFileSequence([
        { stdout: '.git\n' }, // assertGitRepo
        { stdout: '.git\n' }, // assertGitRepo (inside list for exists)
        { stdout: '' }, // list (empty)
        { error: 'not a valid ref' }, // branchExists
        { stdout: '' }, // git worktree add
        { stdout: '.git\n' }, // assertGitRepo (inside list for get)
        {
          stdout: porcelainBlock({ path: expectedPath, branch: 'agent-a1/work' }),
        },
      ]);

      const result = await manager.create({ agentId: 'a1', projectPath: PROJECT_PATH });

      expect(result.branch).toBe('agent-a1/work');
    });

    it('uses custom description in branch name', async () => {
      const manager = new WorktreeManager(makeOptions());
      const expectedPath = path.join(DEFAULT_TREES_DIR, 'agent-a1');

      mockExecFileSequence([
        { stdout: '.git\n' }, // assertGitRepo
        { stdout: '.git\n' }, // assertGitRepo (inside list for exists)
        { stdout: '' }, // list (empty)
        { error: 'not a valid ref' }, // branchExists
        { stdout: '' }, // git worktree add
        { stdout: '.git\n' }, // assertGitRepo (inside list for get)
        {
          stdout: porcelainBlock({ path: expectedPath, branch: 'agent-a1/feature/auth' }),
        },
      ]);

      const result = await manager.create({
        agentId: 'a1',
        description: 'feature/auth',
        projectPath: PROJECT_PATH,
      });

      expect(result.branch).toBe('agent-a1/feature/auth');
    });

    it('uses custom baseBranch when provided', async () => {
      const manager = new WorktreeManager(makeOptions());
      const expectedPath = path.join(DEFAULT_TREES_DIR, 'agent-a1');

      mockExecFileSequence([
        { stdout: '.git\n' }, // assertGitRepo
        { stdout: '.git\n' }, // assertGitRepo (inside list for exists)
        { stdout: '' }, // list (empty)
        { error: 'not a valid ref' }, // branchExists
        { stdout: '' }, // git worktree add
        { stdout: '.git\n' }, // assertGitRepo (inside list for get)
        {
          stdout: porcelainBlock({ path: expectedPath, branch: 'agent-a1/work' }),
        },
      ]);

      await manager.create({
        agentId: 'a1',
        baseBranch: 'develop',
        projectPath: PROJECT_PATH,
      });

      const calls = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const addCall = calls.find(
        (c: unknown[]) =>
          c[0] === 'git' && Array.isArray(c[1]) && c[1][0] === 'worktree' && c[1][1] === 'add',
      );
      // Last argument should be the baseBranch
      expect(addCall?.[1][5]).toBe('develop');
    });

    it('logs info after successful creation', async () => {
      const manager = new WorktreeManager(makeOptions());
      const expectedPath = path.join(DEFAULT_TREES_DIR, 'agent-a1');

      mockExecFileSequence([
        { stdout: '.git\n' }, // assertGitRepo
        { stdout: '.git\n' }, // assertGitRepo (inside list for exists)
        { stdout: '' }, // list (empty)
        { error: 'not a valid ref' }, // branchExists
        { stdout: '' }, // git worktree add
        { stdout: '.git\n' }, // assertGitRepo (inside list for get)
        {
          stdout: porcelainBlock({ path: expectedPath, branch: 'agent-a1/work' }),
        },
      ]);

      await manager.create({ agentId: 'a1', projectPath: PROJECT_PATH });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'a1',
          branch: 'agent-a1/work',
          baseBranch: 'main',
          path: expectedPath,
        }),
        'Worktree created',
      );
    });

    it('throws WORKTREE_CREATE_FAILED when worktree already exists', async () => {
      const manager = new WorktreeManager(makeOptions());
      const existingPath = path.join(DEFAULT_TREES_DIR, 'agent-dup');

      // Flow: assertGitRepo, exists -> list (assertGitRepo + list returns match) -> throws
      mockExecFileSequence([
        { stdout: '.git\n' }, // assertGitRepo
        { stdout: '.git\n' }, // assertGitRepo (inside list for exists)
        {
          stdout: porcelainBlock({ path: existingPath, branch: 'agent-dup/work' }),
        }, // list returns existing worktree
      ]);

      await expect(manager.create({ agentId: 'dup', projectPath: PROJECT_PATH })).rejects.toThrow(
        AgentError,
      );

      try {
        // Reset mock for second attempt
        mockExecFileSequence([
          { stdout: '.git\n' },
          { stdout: '.git\n' },
          {
            stdout: porcelainBlock({ path: existingPath, branch: 'agent-dup/work' }),
          },
        ]);
        await manager.create({ agentId: 'dup', projectPath: PROJECT_PATH });
      } catch (err) {
        expect(err).toBeInstanceOf(AgentError);
        expect((err as AgentError).code).toBe('WORKTREE_CREATE_FAILED');
        expect((err as AgentError).message).toContain("already exists for agent 'dup'");
        expect((err as AgentError).context).toEqual({
          agentId: 'dup',
          path: existingPath,
        });
      }
    });

    it('throws BRANCH_EXISTS when branch already exists', async () => {
      const manager = new WorktreeManager(makeOptions());

      // Flow: assertGitRepo, exists -> list (assertGitRepo + empty list), branchExists (found) -> throws
      mockExecFileSequence([
        { stdout: '.git\n' }, // assertGitRepo
        { stdout: '.git\n' }, // assertGitRepo (inside list for exists)
        { stdout: '' }, // list (no existing worktree)
        { stdout: 'abc123\n' }, // branchExists -> branch found
      ]);

      await expect(manager.create({ agentId: 'bx', projectPath: PROJECT_PATH })).rejects.toThrow(
        AgentError,
      );

      try {
        mockExecFileSequence([
          { stdout: '.git\n' },
          { stdout: '.git\n' },
          { stdout: '' },
          { stdout: 'abc123\n' },
        ]);
        await manager.create({ agentId: 'bx', projectPath: PROJECT_PATH });
      } catch (err) {
        expect(err).toBeInstanceOf(AgentError);
        expect((err as AgentError).code).toBe('BRANCH_EXISTS');
        expect((err as AgentError).message).toContain('agent-bx/work');
      }
    });

    it('throws NOT_A_GIT_REPO when projectPath is not a git repo', async () => {
      const manager = new WorktreeManager(makeOptions());

      mockExecFileFailure('fatal: not a git repository');

      await expect(manager.create({ agentId: 'x', projectPath: PROJECT_PATH })).rejects.toThrow(
        AgentError,
      );

      mockExecFileFailure('fatal: not a git repository');

      try {
        await manager.create({ agentId: 'x', projectPath: PROJECT_PATH });
      } catch (err) {
        expect(err).toBeInstanceOf(AgentError);
        expect((err as AgentError).code).toBe('NOT_A_GIT_REPO');
      }
    });

    it('throws WORKTREE_CREATE_FAILED when git worktree add fails', async () => {
      const manager = new WorktreeManager(makeOptions());

      // Flow: assertGitRepo, exists -> list (assertGitRepo + empty), branchExists (not found), worktree add (fails) -> throws
      mockExecFileSequence([
        { stdout: '.git\n' }, // assertGitRepo
        { stdout: '.git\n' }, // assertGitRepo (inside list for exists)
        { stdout: '' }, // list (empty)
        { error: 'not a valid ref' }, // branchExists -> not found
        { error: 'fatal: could not create worktree' }, // git worktree add fails
      ]);

      await expect(manager.create({ agentId: 'fail', projectPath: PROJECT_PATH })).rejects.toThrow(
        AgentError,
      );

      mockExecFileSequence([
        { stdout: '.git\n' },
        { stdout: '.git\n' },
        { stdout: '' },
        { error: 'not a valid ref' },
        { error: 'fatal: could not create worktree' },
      ]);

      try {
        await manager.create({ agentId: 'fail', projectPath: PROJECT_PATH });
      } catch (err) {
        expect(err).toBeInstanceOf(AgentError);
        expect((err as AgentError).code).toBe('WORKTREE_CREATE_FAILED');
        expect((err as AgentError).message).toContain("agent 'fail'");
      }
    });

    it('throws WORKTREE_CREATE_FAILED when created worktree cannot be read back', async () => {
      const manager = new WorktreeManager(makeOptions());

      // Flow: assertGitRepo, exists -> list (assertGitRepo + empty), branchExists, worktree add,
      //       get -> list (assertGitRepo + empty) -> throws
      mockExecFileSequence([
        { stdout: '.git\n' }, // assertGitRepo
        { stdout: '.git\n' }, // assertGitRepo (inside list for exists)
        { stdout: '' }, // list (empty)
        { error: 'not a valid ref' }, // branchExists
        { stdout: '' }, // git worktree add succeeds
        { stdout: '.git\n' }, // assertGitRepo (inside list for get)
        { stdout: '' }, // list returns empty - worktree not found
      ]);

      await expect(manager.create({ agentId: 'ghost', projectPath: PROJECT_PATH })).rejects.toThrow(
        AgentError,
      );

      mockExecFileSequence([
        { stdout: '.git\n' },
        { stdout: '.git\n' },
        { stdout: '' },
        { error: 'not a valid ref' },
        { stdout: '' },
        { stdout: '.git\n' },
        { stdout: '' },
      ]);

      try {
        await manager.create({ agentId: 'ghost', projectPath: PROJECT_PATH });
      } catch (err) {
        expect(err).toBeInstanceOf(AgentError);
        expect((err as AgentError).code).toBe('WORKTREE_CREATE_FAILED');
        expect((err as AgentError).message).toContain('could not be read back');
      }
    });
  });

  // ── remove ───────────────────────────────────────────────────────────

  describe('remove', () => {
    it('calls git worktree remove with --force', async () => {
      const manager = new WorktreeManager(makeOptions());
      const worktreePath = path.join(DEFAULT_TREES_DIR, 'agent-r1');

      mockExecFileSequence([
        { stdout: '.git\n' }, // assertGitRepo (from list)
        {
          stdout: porcelainBlock({ path: worktreePath, branch: 'agent-r1/work' }),
        }, // list (for get)
        { stdout: '' }, // git worktree remove
      ]);

      await manager.remove('r1');

      const calls = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const removeCall = calls.find(
        (c: unknown[]) =>
          c[0] === 'git' && Array.isArray(c[1]) && c[1][0] === 'worktree' && c[1][1] === 'remove',
      );
      expect(removeCall).toBeDefined();
      expect(removeCall?.[1]).toEqual(['worktree', 'remove', worktreePath, '--force']);
      expect(removeCall?.[2]).toEqual({ cwd: PROJECT_PATH });
    });

    it('logs info after successful removal', async () => {
      const manager = new WorktreeManager(makeOptions());
      const worktreePath = path.join(DEFAULT_TREES_DIR, 'agent-r1');

      mockExecFileSequence([
        { stdout: '.git\n' },
        {
          stdout: porcelainBlock({ path: worktreePath, branch: 'agent-r1/work' }),
        },
        { stdout: '' },
      ]);

      await manager.remove('r1');

      expect(mockLogger.info).toHaveBeenCalledWith(
        { agentId: 'r1', path: worktreePath },
        'Worktree removed',
      );
    });

    it('throws WORKTREE_NOT_FOUND when worktree does not exist', async () => {
      const manager = new WorktreeManager(makeOptions());

      mockExecFileSequence([
        { stdout: '.git\n' }, // assertGitRepo
        { stdout: '' }, // list returns empty
      ]);

      await expect(manager.remove('nonexistent')).rejects.toThrow(AgentError);

      mockExecFileSequence([{ stdout: '.git\n' }, { stdout: '' }]);

      try {
        await manager.remove('nonexistent');
      } catch (err) {
        expect(err).toBeInstanceOf(AgentError);
        expect((err as AgentError).code).toBe('WORKTREE_NOT_FOUND');
        expect((err as AgentError).message).toContain("agent 'nonexistent'");
      }
    });

    it('unlocks worktree before removing if locked', async () => {
      const manager = new WorktreeManager(makeOptions());
      const worktreePath = path.join(DEFAULT_TREES_DIR, 'agent-locked');

      mockExecFileSequence([
        { stdout: '.git\n' }, // assertGitRepo (from list in get)
        {
          stdout: porcelainBlock({
            path: worktreePath,
            branch: 'agent-locked/work',
            locked: true,
          }),
        }, // list (for get) — shows locked
        { stdout: '' }, // git worktree unlock
        { stdout: '' }, // git worktree remove
      ]);

      await manager.remove('locked');

      const calls = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const unlockCall = calls.find(
        (c: unknown[]) =>
          c[0] === 'git' && Array.isArray(c[1]) && c[1][0] === 'worktree' && c[1][1] === 'unlock',
      );
      const removeCall = calls.find(
        (c: unknown[]) =>
          c[0] === 'git' && Array.isArray(c[1]) && c[1][0] === 'worktree' && c[1][1] === 'remove',
      );

      expect(unlockCall).toBeDefined();
      expect(removeCall).toBeDefined();

      // Unlock should happen before remove
      const unlockIdx = unlockCall ? calls.indexOf(unlockCall) : -1;
      const removeIdx = removeCall ? calls.indexOf(removeCall) : -1;
      expect(unlockIdx).toBeGreaterThan(-1);
      expect(removeIdx).toBeGreaterThan(-1);
      expect(unlockIdx).toBeLessThan(removeIdx);
    });

    it('throws WORKTREE_REMOVE_FAILED when git worktree remove fails', async () => {
      const manager = new WorktreeManager(makeOptions());
      const worktreePath = path.join(DEFAULT_TREES_DIR, 'agent-rfail');

      mockExecFileSequence([
        { stdout: '.git\n' },
        {
          stdout: porcelainBlock({ path: worktreePath, branch: 'agent-rfail/work' }),
        },
        { error: 'fatal: cannot remove' },
      ]);

      await expect(manager.remove('rfail')).rejects.toThrow(AgentError);

      mockExecFileSequence([
        { stdout: '.git\n' },
        {
          stdout: porcelainBlock({ path: worktreePath, branch: 'agent-rfail/work' }),
        },
        { error: 'fatal: cannot remove' },
      ]);

      try {
        await manager.remove('rfail');
      } catch (err) {
        expect(err).toBeInstanceOf(AgentError);
        expect((err as AgentError).code).toBe('WORKTREE_REMOVE_FAILED');
      }
    });
  });

  // ── list ─────────────────────────────────────────────────────────────

  describe('list', () => {
    it('returns empty array when no worktrees exist', async () => {
      const manager = new WorktreeManager(makeOptions());

      mockExecFileSequence([
        { stdout: '.git\n' }, // assertGitRepo
        { stdout: '' }, // git worktree list --porcelain
      ]);

      const result = await manager.list();

      expect(result).toEqual([]);
    });

    it('parses single worktree from porcelain output', async () => {
      const manager = new WorktreeManager(makeOptions());
      const worktreePath = '/home/user/my-project/.trees/agent-a1';

      mockExecFileSequence([
        { stdout: '.git\n' },
        {
          stdout: porcelainBlock({
            path: worktreePath,
            head: 'abc123',
            branch: 'agent-a1/work',
          }),
        },
      ]);

      const result = await manager.list();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        path: worktreePath,
        head: 'abc123',
        branch: 'agent-a1/work',
        isLocked: false,
      });
    });

    it('parses multiple worktrees', async () => {
      const manager = new WorktreeManager(makeOptions());

      const output = [
        porcelainBlock({
          path: '/project',
          head: 'aaa111',
          branch: 'main',
        }),
        porcelainBlock({
          path: '/project/.trees/agent-a1',
          head: 'bbb222',
          branch: 'agent-a1/work',
        }),
        porcelainBlock({
          path: '/project/.trees/agent-a2',
          head: 'ccc333',
          branch: 'agent-a2/feature/login',
          locked: true,
        }),
      ].join('\n\n');

      mockExecFileSequence([{ stdout: '.git\n' }, { stdout: output }]);

      const result = await manager.list();

      expect(result).toHaveLength(3);
      expect(result[0].branch).toBe('main');
      expect(result[1].branch).toBe('agent-a1/work');
      expect(result[2].branch).toBe('agent-a2/feature/login');
      expect(result[2].isLocked).toBe(true);
    });

    it('skips bare repository entries', async () => {
      const manager = new WorktreeManager(makeOptions());

      const output = [
        porcelainBlock({ path: '/project/.bare', bare: true }),
        porcelainBlock({
          path: '/project/.trees/agent-a1',
          head: 'abc123',
          branch: 'agent-a1/work',
        }),
      ].join('\n\n');

      mockExecFileSequence([{ stdout: '.git\n' }, { stdout: output }]);

      const result = await manager.list();

      expect(result).toHaveLength(1);
      expect(result[0].branch).toBe('agent-a1/work');
    });

    it('handles detached HEAD worktrees', async () => {
      const manager = new WorktreeManager(makeOptions());

      const output = ['worktree /project/.trees/agent-detached', 'HEAD abc123', 'detached'].join(
        '\n',
      );

      mockExecFileSequence([{ stdout: '.git\n' }, { stdout: output }]);

      const result = await manager.list();

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('/project/.trees/agent-detached');
      expect(result[0].head).toBe('abc123');
      expect(result[0].branch).toBe('');
      expect(result[0].isLocked).toBe(false);
    });

    it('correctly identifies locked worktrees', async () => {
      const manager = new WorktreeManager(makeOptions());

      const output = [
        'worktree /project/.trees/agent-locked',
        'HEAD def456',
        'branch refs/heads/agent-locked/work',
        'locked',
      ].join('\n');

      mockExecFileSequence([{ stdout: '.git\n' }, { stdout: output }]);

      const result = await manager.list();

      expect(result).toHaveLength(1);
      expect(result[0].isLocked).toBe(true);
    });

    it('strips refs/heads/ prefix from branch names', async () => {
      const manager = new WorktreeManager(makeOptions());

      const output = [
        'worktree /project/.trees/agent-a1',
        'HEAD abc123',
        'branch refs/heads/agent-a1/feature/auth',
      ].join('\n');

      mockExecFileSequence([{ stdout: '.git\n' }, { stdout: output }]);

      const result = await manager.list();

      expect(result[0].branch).toBe('agent-a1/feature/auth');
    });

    it('throws NOT_A_GIT_REPO when not in a git repo', async () => {
      const manager = new WorktreeManager(makeOptions());

      mockExecFileFailure('fatal: not a git repository');

      await expect(manager.list()).rejects.toThrow(AgentError);

      mockExecFileFailure('fatal: not a git repository');

      try {
        await manager.list();
      } catch (err) {
        expect(err).toBeInstanceOf(AgentError);
        expect((err as AgentError).code).toBe('NOT_A_GIT_REPO');
      }
    });
  });

  // ── get ──────────────────────────────────────────────────────────────

  describe('get', () => {
    it('returns worktree info when it exists', async () => {
      const manager = new WorktreeManager(makeOptions());
      const worktreePath = path.join(DEFAULT_TREES_DIR, 'agent-g1');

      mockExecFileSequence([
        { stdout: '.git\n' },
        {
          stdout: porcelainBlock({
            path: worktreePath,
            head: 'aaa111',
            branch: 'agent-g1/work',
          }),
        },
      ]);

      const result = await manager.get('g1');

      expect(result).not.toBeNull();
      expect(result?.path).toBe(worktreePath);
      expect(result?.branch).toBe('agent-g1/work');
    });

    it('returns null when worktree does not exist', async () => {
      const manager = new WorktreeManager(makeOptions());

      mockExecFileSequence([{ stdout: '.git\n' }, { stdout: '' }]);

      const result = await manager.get('missing');

      expect(result).toBeNull();
    });
  });

  // ── exists ───────────────────────────────────────────────────────────

  describe('exists', () => {
    it('returns true when worktree exists', async () => {
      const manager = new WorktreeManager(makeOptions());
      const worktreePath = path.join(DEFAULT_TREES_DIR, 'agent-e1');

      mockExecFileSequence([
        { stdout: '.git\n' },
        {
          stdout: porcelainBlock({
            path: worktreePath,
            branch: 'agent-e1/work',
          }),
        },
      ]);

      const result = await manager.exists('e1');

      expect(result).toBe(true);
    });

    it('returns false when worktree does not exist', async () => {
      const manager = new WorktreeManager(makeOptions());

      mockExecFileSequence([{ stdout: '.git\n' }, { stdout: '' }]);

      const result = await manager.exists('nope');

      expect(result).toBe(false);
    });
  });

  // ── lock ─────────────────────────────────────────────────────────────

  describe('lock', () => {
    it('calls git worktree lock with correct path', async () => {
      const manager = new WorktreeManager(makeOptions());
      const worktreePath = path.join(DEFAULT_TREES_DIR, 'agent-l1');

      mockExecFileSequence([
        { stdout: '.git\n' }, // assertGitRepo (from list in get)
        {
          stdout: porcelainBlock({ path: worktreePath, branch: 'agent-l1/work' }),
        }, // list (for get)
        { stdout: '' }, // git worktree lock
      ]);

      await manager.lock('l1');

      const calls = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const lockCall = calls.find(
        (c: unknown[]) =>
          c[0] === 'git' && Array.isArray(c[1]) && c[1][0] === 'worktree' && c[1][1] === 'lock',
      );
      expect(lockCall).toBeDefined();
      expect(lockCall?.[1]).toEqual(['worktree', 'lock', worktreePath]);
    });

    it('includes --reason flag when reason is provided', async () => {
      const manager = new WorktreeManager(makeOptions());
      const worktreePath = path.join(DEFAULT_TREES_DIR, 'agent-l2');

      mockExecFileSequence([
        { stdout: '.git\n' },
        {
          stdout: porcelainBlock({ path: worktreePath, branch: 'agent-l2/work' }),
        },
        { stdout: '' },
      ]);

      await manager.lock('l2', 'agent running a task');

      const calls = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const lockCall = calls.find(
        (c: unknown[]) =>
          c[0] === 'git' && Array.isArray(c[1]) && c[1][0] === 'worktree' && c[1][1] === 'lock',
      );
      expect(lockCall?.[1]).toEqual([
        'worktree',
        'lock',
        worktreePath,
        '--reason',
        'agent running a task',
      ]);
    });

    it('throws WORKTREE_NOT_FOUND when worktree does not exist', async () => {
      const manager = new WorktreeManager(makeOptions());

      mockExecFileSequence([{ stdout: '.git\n' }, { stdout: '' }]);

      await expect(manager.lock('phantom')).rejects.toThrow(AgentError);

      mockExecFileSequence([{ stdout: '.git\n' }, { stdout: '' }]);

      try {
        await manager.lock('phantom');
      } catch (err) {
        expect(err).toBeInstanceOf(AgentError);
        expect((err as AgentError).code).toBe('WORKTREE_NOT_FOUND');
      }
    });

    it('logs info after successful lock', async () => {
      const manager = new WorktreeManager(makeOptions());
      const worktreePath = path.join(DEFAULT_TREES_DIR, 'agent-l3');

      mockExecFileSequence([
        { stdout: '.git\n' },
        {
          stdout: porcelainBlock({ path: worktreePath, branch: 'agent-l3/work' }),
        },
        { stdout: '' },
      ]);

      await manager.lock('l3', 'test reason');

      expect(mockLogger.info).toHaveBeenCalledWith(
        { agentId: 'l3', reason: 'test reason' },
        'Worktree locked',
      );
    });
  });

  // ── unlock ───────────────────────────────────────────────────────────

  describe('unlock', () => {
    it('calls git worktree unlock with correct path', async () => {
      const manager = new WorktreeManager(makeOptions());
      const worktreePath = path.join(DEFAULT_TREES_DIR, 'agent-u1');

      mockExecFileSuccess();

      await manager.unlock('u1');

      const calls = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const unlockCall = calls.find(
        (c: unknown[]) =>
          c[0] === 'git' && Array.isArray(c[1]) && c[1][0] === 'worktree' && c[1][1] === 'unlock',
      );
      expect(unlockCall).toBeDefined();
      expect(unlockCall?.[1]).toEqual(['worktree', 'unlock', worktreePath]);
      expect(unlockCall?.[2]).toEqual({ cwd: PROJECT_PATH });
    });

    it('throws WORKTREE_NOT_FOUND when unlock fails', async () => {
      const manager = new WorktreeManager(makeOptions());

      mockExecFileFailure('fatal: not a locked worktree');

      await expect(manager.unlock('bad')).rejects.toThrow(AgentError);

      mockExecFileFailure('fatal: not a locked worktree');

      try {
        await manager.unlock('bad');
      } catch (err) {
        expect(err).toBeInstanceOf(AgentError);
        expect((err as AgentError).code).toBe('WORKTREE_NOT_FOUND');
      }
    });

    it('logs info after successful unlock', async () => {
      const manager = new WorktreeManager(makeOptions());

      mockExecFileSuccess();

      await manager.unlock('u2');

      expect(mockLogger.info).toHaveBeenCalledWith({ agentId: 'u2' }, 'Worktree unlocked');
    });
  });

  // ── Branch name generation ───────────────────────────────────────────

  describe('branch name generation', () => {
    it('follows agent-{id}/{description} convention', async () => {
      const manager = new WorktreeManager(makeOptions());
      const expectedPath = path.join(DEFAULT_TREES_DIR, 'agent-abc');

      mockExecFileSequence([
        { stdout: '.git\n' }, // assertGitRepo
        { stdout: '.git\n' }, // assertGitRepo (inside list for exists)
        { stdout: '' }, // list (empty)
        { error: 'not a valid ref' }, // branchExists
        { stdout: '' }, // git worktree add
        { stdout: '.git\n' }, // assertGitRepo (inside list for get)
        {
          stdout: porcelainBlock({ path: expectedPath, branch: 'agent-abc/my-feature' }),
        },
      ]);

      await manager.create({
        agentId: 'abc',
        description: 'my-feature',
        projectPath: PROJECT_PATH,
      });

      const calls = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const addCall = calls.find(
        (c: unknown[]) =>
          c[0] === 'git' && Array.isArray(c[1]) && c[1][0] === 'worktree' && c[1][1] === 'add',
      );
      // The -b argument (index 3) should be the branch name
      expect(addCall?.[1][3]).toBe('-b');
      expect(addCall?.[1][4]).toBe('agent-abc/my-feature');
    });

    it('defaults description to "work"', async () => {
      const manager = new WorktreeManager(makeOptions());
      const expectedPath = path.join(DEFAULT_TREES_DIR, 'agent-xyz');

      mockExecFileSequence([
        { stdout: '.git\n' }, // assertGitRepo
        { stdout: '.git\n' }, // assertGitRepo (inside list for exists)
        { stdout: '' }, // list (empty)
        { error: 'not a valid ref' }, // branchExists
        { stdout: '' }, // git worktree add
        { stdout: '.git\n' }, // assertGitRepo (inside list for get)
        {
          stdout: porcelainBlock({ path: expectedPath, branch: 'agent-xyz/work' }),
        },
      ]);

      await manager.create({ agentId: 'xyz', projectPath: PROJECT_PATH });

      const calls = (execFile as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const addCall = calls.find(
        (c: unknown[]) =>
          c[0] === 'git' && Array.isArray(c[1]) && c[1][0] === 'worktree' && c[1][1] === 'add',
      );
      expect(addCall?.[1][4]).toBe('agent-xyz/work');
    });
  });

  // ── Path construction ────────────────────────────────────────────────

  describe('path construction', () => {
    it('worktree paths are under the configured treesDir', () => {
      const manager = new WorktreeManager(makeOptions());

      const p = manager.getWorktreePath('test-123');

      expect(p.startsWith(DEFAULT_TREES_DIR)).toBe(true);
    });

    it('worktree paths follow agent-<id> naming', () => {
      const manager = new WorktreeManager(makeOptions());

      const p = manager.getWorktreePath('test-123');

      expect(path.basename(p)).toBe('agent-test-123');
    });

    it('custom treesDir is respected in all paths', () => {
      const customDir = '/mnt/worktrees';
      const manager = new WorktreeManager(makeOptions({ treesDir: customDir }));

      const p = manager.getWorktreePath('w1');

      expect(p).toBe(path.join(customDir, 'agent-w1'));
      expect(p.startsWith(customDir)).toBe(true);
    });
  });

  describe('agentId validation', () => {
    it('rejects agentId with shell metacharacters', async () => {
      mockExecFileSuccess('');
      const manager = new WorktreeManager(makeOptions());

      await expect(
        manager.create({ agentId: 'agent;rm -rf /', projectPath: '/repo' }),
      ).rejects.toThrow('invalid characters');
    });

    it('rejects agentId with path traversal', async () => {
      const manager = new WorktreeManager(makeOptions());

      await expect(
        manager.create({ agentId: '../../../etc/passwd', projectPath: '/repo' }),
      ).rejects.toThrow('invalid characters');
    });

    it('rejects agentId with spaces', async () => {
      const manager = new WorktreeManager(makeOptions());

      await expect(manager.create({ agentId: 'agent id', projectPath: '/repo' })).rejects.toThrow(
        'invalid characters',
      );
    });

    it('accepts valid agentId patterns', () => {
      const manager = new WorktreeManager(makeOptions());
      // These should not throw (getWorktreePath doesn't validate, but create/remove do)
      expect(manager.getWorktreePath('agent-1')).toContain('agent-agent-1');
      expect(manager.getWorktreePath('my_agent_123')).toContain('agent-my_agent_123');
      expect(manager.getWorktreePath('ABC-def-789')).toContain('agent-ABC-def-789');
    });

    it('rejects invalid agentId on remove', async () => {
      const manager = new WorktreeManager(makeOptions());

      await expect(manager.remove('agent;evil')).rejects.toThrow('invalid characters');
    });
  });
});
