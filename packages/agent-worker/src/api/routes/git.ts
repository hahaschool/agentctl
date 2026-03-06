// ---------------------------------------------------------------------------
// Worker-side git status route — provides git repository information for a
// given project directory. Used by the frontend to show branch/worktree info.
// ---------------------------------------------------------------------------

import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import { promisify } from 'node:util';

import { WorkerError } from '@agentctl/shared';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { Logger } from 'pino';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GIT_COMMAND_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GitRouteOptions = FastifyPluginOptions & {
  logger: Logger;
};

type GitFileStatus = {
  clean: boolean;
  staged: number;
  modified: number;
  untracked: number;
  ahead: number;
  behind: number;
};

type GitLastCommit = {
  hash: string;
  message: string;
  author: string;
  date: string;
};

type GitWorktreeEntry = {
  path: string;
  branch: string | null;
  isMain: boolean;
};

type GitStatusResponse = {
  branch: string;
  worktree: string;
  isWorktree: boolean;
  bareRepo: string | null;
  status: GitFileStatus;
  lastCommit: GitLastCommit | null;
  worktrees: GitWorktreeEntry[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: GIT_COMMAND_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

function parseStatusCounts(
  porcelain: string,
): Pick<GitFileStatus, 'staged' | 'modified' | 'untracked'> {
  let staged = 0;
  let modified = 0;
  let untracked = 0;

  for (const line of porcelain.split('\n')) {
    if (!line) continue;
    const x = line[0];
    const y = line[1];

    if (x === '?' && y === '?') {
      untracked++;
    } else {
      if (x && x !== ' ' && x !== '?') staged++;
      if (y && y !== ' ' && y !== '?') modified++;
    }
  }

  return { staged, modified, untracked };
}

function parseAheadBehind(branchStatus: string): Pick<GitFileStatus, 'ahead' | 'behind'> {
  const aheadMatch = branchStatus.match(/ahead (\d+)/);
  const behindMatch = branchStatus.match(/behind (\d+)/);
  return {
    ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
    behind: behindMatch ? Number(behindMatch[1]) : 0,
  };
}

function parseWorktreeList(output: string): GitWorktreeEntry[] {
  const entries: GitWorktreeEntry[] = [];
  let currentPath = '';
  let currentBranch: string | null = null;
  let isBare = false;

  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      // If we have a previous entry, push it
      if (currentPath) {
        entries.push({
          path: currentPath,
          branch: currentBranch,
          isMain: isBare,
        });
      }
      currentPath = line.slice('worktree '.length);
      currentBranch = null;
      isBare = false;
    } else if (line.startsWith('branch ')) {
      const refPath = line.slice('branch '.length);
      currentBranch = refPath.replace('refs/heads/', '');
    } else if (line === 'bare') {
      isBare = true;
    } else if (line === '' && currentPath) {
      entries.push({
        path: currentPath,
        branch: currentBranch,
        isMain: isBare,
      });
      currentPath = '';
      currentBranch = null;
      isBare = false;
    }
  }

  // Push last entry if output doesn't end with blank line
  if (currentPath) {
    entries.push({
      path: currentPath,
      branch: currentBranch,
      isMain: isBare,
    });
  }

  // If no bare entry, mark the first one as main
  if (entries.length > 0 && !entries.some((e) => e.isMain)) {
    entries[0].isMain = true;
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export async function gitRoutes(app: FastifyInstance, options: GitRouteOptions): Promise<void> {
  const { logger } = options;

  // GET /api/git/status?path=<absolute-path>
  app.get<{ Querystring: { path?: string } }>(
    '/status',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            path: { type: 'string' },
          },
          required: ['path'],
        },
      },
    },
    async (request, reply) => {
      const { path: dirPath } = request.query;

      if (!dirPath || typeof dirPath !== 'string') {
        return reply.code(400).send({
          error: 'INVALID_PATH',
          message: 'A non-empty "path" query parameter is required',
        });
      }

      // Security: validate path exists and is a directory
      try {
        const stat = statSync(dirPath);
        if (!stat.isDirectory()) {
          return reply.code(400).send({
            error: 'NOT_A_DIRECTORY',
            message: `Path '${dirPath}' is not a directory`,
          });
        }
      } catch {
        return reply.code(404).send({
          error: 'PATH_NOT_FOUND',
          message: `Path '${dirPath}' does not exist`,
        });
      }

      // Check if it's a git repository
      try {
        await runGit(['rev-parse', '--git-dir'], dirPath);
      } catch {
        return reply.code(400).send({
          error: 'NOT_A_GIT_REPO',
          message: `Path '${dirPath}' is not inside a git repository`,
        });
      }

      try {
        // Run all independent git commands in parallel
        const [
          branchResult,
          toplevelResult,
          statusResult,
          statusBranchResult,
          logResult,
          worktreeResult,
          gitCommonDirResult,
        ] = await Promise.allSettled([
          runGit(['rev-parse', '--abbrev-ref', 'HEAD'], dirPath),
          runGit(['rev-parse', '--show-toplevel'], dirPath),
          runGit(['status', '--porcelain'], dirPath),
          runGit(['status', '--branch', '--porcelain'], dirPath),
          runGit(['log', '-1', '--format=%H%n%s%n%an%n%aI'], dirPath),
          runGit(['worktree', 'list', '--porcelain'], dirPath),
          runGit(['rev-parse', '--git-common-dir'], dirPath),
        ]);

        const branch = branchResult.status === 'fulfilled' ? branchResult.value : 'HEAD';
        const worktreePath = toplevelResult.status === 'fulfilled' ? toplevelResult.value : dirPath;

        // Parse file status
        const porcelain = statusResult.status === 'fulfilled' ? statusResult.value : '';
        const { staged, modified, untracked } = parseStatusCounts(porcelain);

        // Parse ahead/behind
        const branchStatusLine =
          statusBranchResult.status === 'fulfilled'
            ? (statusBranchResult.value.split('\n')[0] ?? '')
            : '';
        const { ahead, behind } = parseAheadBehind(branchStatusLine);

        const fileStatus: GitFileStatus = {
          clean: staged === 0 && modified === 0 && untracked === 0,
          staged,
          modified,
          untracked,
          ahead,
          behind,
        };

        // Parse last commit
        let lastCommit: GitLastCommit | null = null;
        if (logResult.status === 'fulfilled' && logResult.value) {
          const lines = logResult.value.split('\n');
          if (lines.length >= 4) {
            lastCommit = {
              hash: lines[0].slice(0, 7),
              message: lines[1],
              author: lines[2],
              date: lines[3],
            };
          }
        }

        // Parse worktree list
        const worktrees =
          worktreeResult.status === 'fulfilled' ? parseWorktreeList(worktreeResult.value) : [];

        // Detect if current dir is a worktree (not the main working tree)
        const gitCommonDir =
          gitCommonDirResult.status === 'fulfilled' ? gitCommonDirResult.value : '';
        const isWorktree = gitCommonDir.includes('/worktrees/') || gitCommonDir.includes('/.bare/');

        // Detect bare repo path
        let bareRepo: string | null = null;
        if (isWorktree && gitCommonDir) {
          // gitCommonDir points to e.g. /path/to/.bare or /path/to/.git
          const bareMatch = gitCommonDir.match(/^(.+\/\.bare)/);
          if (bareMatch) {
            bareRepo = bareMatch[1];
          }
        }

        const response: GitStatusResponse = {
          branch,
          worktree: worktreePath,
          isWorktree,
          bareRepo,
          status: fileStatus,
          lastCommit,
          worktrees,
        };

        return response;
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : String(err);
        logger.error({ err, path: dirPath }, 'git status failed');
        throw new WorkerError('GIT_STATUS_FAILED', `Failed to get git status: ${errMessage}`, {
          path: dirPath,
        });
      }
    },
  );
}
