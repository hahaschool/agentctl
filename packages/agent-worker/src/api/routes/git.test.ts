import { WorkerError } from '@agentctl/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSilentLogger } from '../../test-helpers.js';
import { gitRoutes } from './git.js';

// ---------------------------------------------------------------------------
// Mock node:fs and node:child_process
// ---------------------------------------------------------------------------

vi.mock('node:fs', () => ({
  statSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function buildApp(): Promise<FastifyInstance> {
  const Fastify = await import('fastify');
  const app = Fastify.default({ logger: false });

  // Replicate error handler from server.ts
  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof WorkerError) {
      let statusCode = 500;
      if (err.code.endsWith('_NOT_FOUND')) statusCode = 404;
      else if (err.code.startsWith('INVALID_') || err.code.startsWith('NOT_A_')) statusCode = 400;
      return reply.status(statusCode).send({
        error: err.code,
        message: err.message,
      });
    }
    // Fastify schema validation errors
    if ((err as { statusCode?: number; validation?: unknown }).statusCode === 400) {
      return reply.status(400).send(err);
    }
    return reply.status(500).send({ error: 'INTERNAL_ERROR', message: err.message });
  });

  await app.register(gitRoutes, {
    prefix: '/api/git',
    logger: createSilentLogger(),
  });

  return app;
}

function makeStat(isDir: boolean): ReturnType<typeof statSync> {
  return {
    isDirectory: () => isDir,
    isFile: () => !isDir,
  } as unknown as ReturnType<typeof statSync>;
}

/**
 * Set up execFile mock to respond to different git commands.
 * commandMap maps a key (first arg after 'git') to its stdout response.
 */
function mockGitCommands(commandMap: Record<string, string>): void {
  vi.mocked(execFile).mockImplementation(
    (_cmd: string, args: unknown, _opts: unknown, cb?: unknown) => {
      const argList = args as string[];
      const callback = cb as (err: Error | null, result: { stdout: string }) => void;

      // Build a key from args to match against commandMap
      const key = argList.join(' ');

      for (const [pattern, stdout] of Object.entries(commandMap)) {
        if (key.includes(pattern)) {
          callback(null, { stdout: `${stdout}\n` });
          return {} as ReturnType<typeof execFile>;
        }
      }

      // Default: command not found in map — return empty
      callback(null, { stdout: '\n' });
      return {} as ReturnType<typeof execFile>;
    },
  );
}

/**
 * Set up execFile mock to fail for specific commands.
 */
function mockGitFailure(failPattern: string, errorMsg: string): void {
  vi.mocked(execFile).mockImplementation(
    (_cmd: string, args: unknown, _opts: unknown, cb?: unknown) => {
      const argList = args as string[];
      const callback = cb as (err: Error | null, result?: { stdout: string }) => void;
      const key = argList.join(' ');

      if (key.includes(failPattern)) {
        callback(new Error(errorMsg));
      } else {
        callback(null, { stdout: '\n' });
      }
      return {} as ReturnType<typeof execFile>;
    },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Git routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  // =========================================================================
  // GET /api/git/status — success cases
  // =========================================================================

  describe('GET /api/git/status (success)', () => {
    it('returns full git status with all fields', async () => {
      const dirPath = '/Users/testuser/project';
      vi.mocked(statSync).mockReturnValue(makeStat(true));

      mockGitCommands({
        'rev-parse --git-dir': '.git',
        'rev-parse --abbrev-ref HEAD': 'feat/awesome',
        'rev-parse --show-toplevel': '/Users/testuser/project',
        'status --porcelain': 'M  src/index.ts\n?? newfile.ts',
        'status --branch --porcelain':
          '## feat/awesome...origin/feat/awesome [ahead 2, behind 1]\n M src/index.ts',
        'log -1 --format=%H%n%s%n%an%n%aI':
          'abc1234567890\nfix: something\nJohn Doe\n2026-03-06T10:00:00+00:00',
        'worktree list --porcelain':
          'worktree /Users/testuser/project\nbranch refs/heads/feat/awesome\n',
        'rev-parse --git-common-dir': '.git',
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/git/status?path=${encodeURIComponent(dirPath)}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      expect(body.branch).toBe('feat/awesome');
      expect(body.worktree).toBe('/Users/testuser/project');
      expect(body.isWorktree).toBe(false);
      expect(body.bareRepo).toBeNull();

      // Status counts
      expect(body.status.staged).toBe(1); // M in first column
      expect(body.status.untracked).toBe(1); // ??
      expect(body.status.modified).toBe(0);
      expect(body.status.ahead).toBe(2);
      expect(body.status.behind).toBe(1);
      expect(body.status.clean).toBe(false);

      // Last commit
      expect(body.lastCommit).not.toBeNull();
      expect(body.lastCommit.hash).toBe('abc1234');
      expect(body.lastCommit.message).toBe('fix: something');
      expect(body.lastCommit.author).toBe('John Doe');
    });

    it('returns clean status when no changes', async () => {
      vi.mocked(statSync).mockReturnValue(makeStat(true));

      mockGitCommands({
        'rev-parse --git-dir': '.git',
        'rev-parse --abbrev-ref HEAD': 'main',
        'rev-parse --show-toplevel': '/Users/testuser/project',
        'status --porcelain': '',
        'status --branch --porcelain': '## main...origin/main',
        'log -1 --format=%H%n%s%n%an%n%aI':
          'def4567890123\ninitial commit\nJane\n2026-03-01T09:00:00Z',
        'worktree list --porcelain': 'worktree /Users/testuser/project\nbranch refs/heads/main\n',
        'rev-parse --git-common-dir': '.git',
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/git/status?path=/Users/testuser/project',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status.clean).toBe(true);
      expect(body.status.staged).toBe(0);
      expect(body.status.modified).toBe(0);
      expect(body.status.untracked).toBe(0);
      expect(body.status.ahead).toBe(0);
      expect(body.status.behind).toBe(0);
    });

    it('detects worktree when git-common-dir contains /worktrees/', async () => {
      vi.mocked(statSync).mockReturnValue(makeStat(true));

      // In a real linked worktree, git-common-dir returns the path through
      // the worktrees directory inside the main .git or .bare dir.
      mockGitCommands({
        'rev-parse --git-dir': '/Users/testuser/repo/.bare/worktrees/feature-1',
        'rev-parse --abbrev-ref HEAD': 'feature-1',
        'rev-parse --show-toplevel': '/Users/testuser/repo/.trees/feature-1',
        'status --porcelain': '',
        'status --branch --porcelain': '## feature-1',
        'log -1 --format=%H%n%s%n%an%n%aI': 'aaa1111222233\nwip\nDev\n2026-03-06T11:00:00Z',
        'worktree list --porcelain':
          'worktree /Users/testuser/repo\nbare\n\nworktree /Users/testuser/repo/.trees/feature-1\nbranch refs/heads/feature-1\n',
        // The git-common-dir for a linked worktree under a bare repo includes
        // both /.bare/ and /worktrees/ in the path
        'rev-parse --git-common-dir': '/Users/testuser/repo/.bare/worktrees/feature-1',
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/git/status?path=/Users/testuser/repo/.trees/feature-1',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.isWorktree).toBe(true);
      expect(body.bareRepo).toBe('/Users/testuser/repo/.bare');
      expect(body.worktrees).toHaveLength(2);
      // First is the bare repo (isMain = true)
      expect(body.worktrees[0].isMain).toBe(true);
    });
  });

  // =========================================================================
  // GET /api/git/status — validation / error cases
  // =========================================================================

  describe('GET /api/git/status (validation & errors)', () => {
    it('returns 429 when repeated status requests exceed the configured limit', async () => {
      process.env.GIT_STATUS_RATE_LIMIT_MAX = '1';
      process.env.GIT_STATUS_RATE_LIMIT_WINDOW_MS = '60000';

      await app.close();
      app = await buildApp();

      vi.mocked(statSync).mockReturnValue(makeStat(true));
      mockGitCommands({
        'rev-parse --git-dir': '.git',
        'rev-parse --abbrev-ref HEAD': 'main',
        'rev-parse --show-toplevel': '/Users/testuser/project',
        'status --porcelain': '',
        'status --branch --porcelain': '## main',
        'log -1 --format=%H%n%s%n%an%n%aI': 'abc1234567890\ninit\nDev\n2026-03-06T10:00:00Z',
        'worktree list --porcelain': 'worktree /Users/testuser/project\nbranch refs/heads/main\n',
        'rev-parse --git-common-dir': '.git',
      });

      try {
        const first = await app.inject({
          method: 'GET',
          url: '/api/git/status?path=/Users/testuser/project',
        });
        const second = await app.inject({
          method: 'GET',
          url: '/api/git/status?path=/Users/testuser/project',
        });

        expect(first.statusCode).toBe(200);
        expect(second.statusCode).toBe(429);
        expect(second.json()).toEqual({
          error: 'Too many git status requests. Try again later.',
          code: 'RATE_LIMITED',
        });
      } finally {
        delete process.env.GIT_STATUS_RATE_LIMIT_MAX;
        delete process.env.GIT_STATUS_RATE_LIMIT_WINDOW_MS;
      }
    });

    it('returns 400 when path query parameter is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/git/status',
      });

      // Fastify schema validation returns 400
      expect(res.statusCode).toBe(400);
    });

    it('returns 404 when directory does not exist', async () => {
      vi.mocked(statSync).mockImplementation(() => {
        throw new Error('ENOENT: no such file or directory');
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/git/status?path=/Users/testuser/nonexistent',
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error).toBe('PATH_NOT_FOUND');
    });

    it('returns 400 when path is not a directory', async () => {
      vi.mocked(statSync).mockReturnValue(makeStat(false));

      const res = await app.inject({
        method: 'GET',
        url: '/api/git/status?path=/Users/testuser/somefile.txt',
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe('NOT_A_DIRECTORY');
    });

    it('returns 400 when path is not a git repository', async () => {
      vi.mocked(statSync).mockReturnValue(makeStat(true));

      // rev-parse --git-dir fails for non-git dirs
      mockGitFailure('rev-parse --git-dir', 'fatal: not a git repository');

      const res = await app.inject({
        method: 'GET',
        url: '/api/git/status?path=/Users/testuser/not-a-repo',
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe('NOT_A_GIT_REPO');
    });

    it('returns 500 when git commands fail after initial checks', async () => {
      vi.mocked(statSync).mockReturnValue(makeStat(true));

      // First call (rev-parse --git-dir) succeeds, all subsequent fail
      let _callCount = 0;
      vi.mocked(execFile).mockImplementation(
        (_cmd: string, args: unknown, _opts: unknown, cb?: unknown) => {
          const argList = args as string[];
          const callback = cb as (err: Error | null, result?: { stdout: string }) => void;
          const key = argList.join(' ');

          if (key.includes('rev-parse --git-dir')) {
            callback(null, { stdout: '.git\n' });
          } else {
            _callCount++;
            callback(new Error('git crashed'));
          }
          return {} as ReturnType<typeof execFile>;
        },
      );

      const res = await app.inject({
        method: 'GET',
        url: '/api/git/status?path=/Users/testuser/project',
      });

      // Promise.allSettled catches individual failures, so the route should still succeed
      // with fallback values (HEAD, 0 counts, etc.)
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.branch).toBe('HEAD');
      expect(body.status.clean).toBe(true);
      expect(body.lastCommit).toBeNull();
      expect(body.worktrees).toEqual([]);
    });
  });

  // =========================================================================
  // Worktree parsing edge cases
  // =========================================================================

  describe('worktree list parsing', () => {
    it('marks first worktree as main when no bare entry exists', async () => {
      vi.mocked(statSync).mockReturnValue(makeStat(true));

      mockGitCommands({
        'rev-parse --git-dir': '.git',
        'rev-parse --abbrev-ref HEAD': 'main',
        'rev-parse --show-toplevel': '/Users/testuser/project',
        'status --porcelain': '',
        'status --branch --porcelain': '## main',
        'log -1 --format=%H%n%s%n%an%n%aI': 'abc1234567890\ninit\nDev\n2026-03-06T10:00:00Z',
        'worktree list --porcelain':
          'worktree /Users/testuser/project\nbranch refs/heads/main\n\nworktree /Users/testuser/project/.trees/feat\nbranch refs/heads/feat\n',
        'rev-parse --git-common-dir': '.git',
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/git/status?path=/Users/testuser/project',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.worktrees).toHaveLength(2);
      // First should be marked as main (fallback)
      expect(body.worktrees[0].isMain).toBe(true);
      expect(body.worktrees[0].branch).toBe('main');
      expect(body.worktrees[1].isMain).toBe(false);
      expect(body.worktrees[1].branch).toBe('feat');
    });

    it('handles empty worktree list', async () => {
      vi.mocked(statSync).mockReturnValue(makeStat(true));

      mockGitCommands({
        'rev-parse --git-dir': '.git',
        'rev-parse --abbrev-ref HEAD': 'main',
        'rev-parse --show-toplevel': '/Users/testuser/project',
        'status --porcelain': '',
        'status --branch --porcelain': '## main',
        'log -1 --format=%H%n%s%n%an%n%aI': 'abc1234567890\ninit\nDev\n2026-03-06T10:00:00Z',
        'worktree list --porcelain': '',
        'rev-parse --git-common-dir': '.git',
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/git/status?path=/Users/testuser/project',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().worktrees).toEqual([]);
    });
  });
});
