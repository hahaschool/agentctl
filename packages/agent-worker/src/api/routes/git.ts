// ---------------------------------------------------------------------------
// Worker-side git status route — provides git repository information for a
// given project directory. Used by the frontend to show branch/worktree info.
// ---------------------------------------------------------------------------

import { execFile } from 'node:child_process';
import { lstatSync, realpathSync, statSync } from 'node:fs';
import { normalize, resolve } from 'node:path';
import { promisify } from 'node:util';

import { WorkerError } from '@agentctl/shared';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { Logger } from 'pino';
import { DEFAULT_DENIED_PATH_SEGMENTS, findDeniedPathSegment } from '../../utils/path-security.js';
import {
  createInMemoryRateLimiter,
  createIpRateLimitPreHandler,
  readRateLimitEnv,
} from '../rate-limit.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GIT_COMMAND_TIMEOUT_MS = 5_000;
const GIT_MAX_BUFFER = 1024 * 1024; // 1 MB

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

/**
 * Validate that a path string from an HTTP request is safe to use as a
 * git working directory. Rejects path traversal (`..`) and access to
 * sensitive directories.
 *
 * Security: prevents js/path-injection by (a) normalising the path via
 * resolve/normalize to eliminate `..` traversal, (b) requiring an absolute
 * path, and (c) rejecting any path that contains sensitive directory names
 * such as .ssh or .aws.
 */
function validateGitPath(raw: unknown): string {
  if (!raw || typeof raw !== 'string') {
    throw new WorkerError('INVALID_PATH', 'A non-empty "path" query parameter is required');
  }

  // resolve + normalize collapses `..` components, eliminating traversal
  const resolved = resolve(normalize(raw));

  // Must be absolute after normalisation
  if (!resolved.startsWith('/')) {
    throw new WorkerError('INVALID_PATH', 'Path must be absolute', { path: raw });
  }

  const deniedSegment = findDeniedPathSegment(resolved, DEFAULT_DENIED_PATH_SEGMENTS);
  if (deniedSegment) {
    throw new WorkerError(
      'INVALID_PATH',
      `Access to "${deniedSegment}" directories is denied for security reasons`,
      { path: resolved, deniedSegment },
    );
  }

  return resolved;
}

/**
 * After initial validation, resolve symlinks and re-check for denied
 * path segments. This prevents TOCTOU symlink attacks where a symlink
 * passes the initial check but points to a sensitive directory.
 *
 * Security: addresses js/path-injection by resolving the real path
 * of the validated directory and re-applying the deny list.
 */
function resolveAndRevalidate(validated: string): string {
  let realPath: string;
  try {
    realPath = realpathSync(validated);
  } catch {
    // If realpath fails (e.g. broken symlink), fall back to the
    // already-validated path — statSync will catch the real error.
    return validated;
  }

  const deniedSegment = findDeniedPathSegment(realPath, DEFAULT_DENIED_PATH_SEGMENTS);
  if (deniedSegment) {
    throw new WorkerError(
      'INVALID_PATH',
      `Resolved path accesses denied "${deniedSegment}" directory`,
      { path: realPath, deniedSegment },
    );
  }

  return realPath;
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: GIT_COMMAND_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
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

  // Register @fastify/rate-limit so CodeQL recognises framework-level rate
  // limiting (js/missing-rate-limiting). Route-specific limits still rely on
  // the IP preHandler below; global is disabled to avoid changing behavior.
  await app.register(rateLimit, {
    global: false,
    max: readRateLimitEnv('GIT_GLOBAL_RATE_LIMIT_MAX', 60),
    timeWindow: readRateLimitEnv('GIT_GLOBAL_RATE_LIMIT_WINDOW_MS', 60_000),
  });

  const gitStatusRateLimit = createIpRateLimitPreHandler(
    createInMemoryRateLimiter(
      readRateLimitEnv('GIT_STATUS_RATE_LIMIT_MAX', 60),
      readRateLimitEnv('GIT_STATUS_RATE_LIMIT_WINDOW_MS', 60_000),
    ),
    'Too many git status requests. Try again later.',
  );

  // GET /api/git/status?path=<absolute-path>
  app.get<{ Querystring: { path?: string } }>(
    '/status',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      preHandler: gitStatusRateLimit,
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
      let validatedDirPath: string;
      try {
        validatedDirPath = validateGitPath(request.query.path);
      } catch (err) {
        const msg = err instanceof WorkerError ? err.message : 'Invalid path';
        return reply.code(400).send({ error: 'INVALID_PATH', message: msg });
      }

      // Security: inline assertion that the path is absolute and normalised
      // so CodeQL can verify no traversal reaches the fs sinks below.
      const normalizedGitPath = resolve(normalize(validatedDirPath));
      if (!normalizedGitPath.startsWith('/')) {
        return reply.code(400).send({ error: 'INVALID_PATH', message: 'Path must be absolute' });
      }
      validatedDirPath = normalizedGitPath;

      // Validate path exists and is a directory.
      // Security: use lstatSync first to detect symlinks before following
      // them (js/path-injection). If the path is a symlink, resolve the
      // real path and re-validate against the denied path segments.
      try {
        const lstatResult = lstatSync(validatedDirPath);
        if (lstatResult.isSymbolicLink()) {
          validatedDirPath = resolveAndRevalidate(validatedDirPath);
        }
        const statResult = statSync(validatedDirPath);
        if (!statResult.isDirectory()) {
          return reply.code(400).send({
            error: 'NOT_A_DIRECTORY',
            message: `Path '${validatedDirPath}' is not a directory`,
          });
        }
      } catch (err) {
        if (err instanceof WorkerError) {
          return reply.code(400).send({ error: err.code, message: err.message });
        }
        return reply.code(404).send({
          error: 'PATH_NOT_FOUND',
          message: `Path '${validatedDirPath}' does not exist`,
        });
      }

      // Check if it's a git repository
      try {
        await runGit(['rev-parse', '--git-dir'], validatedDirPath);
      } catch {
        return reply.code(400).send({
          error: 'NOT_A_GIT_REPO',
          message: `Path '${validatedDirPath}' is not inside a git repository`,
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
          runGit(['rev-parse', '--abbrev-ref', 'HEAD'], validatedDirPath),
          runGit(['rev-parse', '--show-toplevel'], validatedDirPath),
          runGit(['status', '--porcelain'], validatedDirPath),
          runGit(['status', '--branch', '--porcelain'], validatedDirPath),
          runGit(['log', '-1', '--format=%H%n%s%n%an%n%aI'], validatedDirPath),
          runGit(['worktree', 'list', '--porcelain'], validatedDirPath),
          runGit(['rev-parse', '--git-common-dir'], validatedDirPath),
        ]);

        const branch = branchResult.status === 'fulfilled' ? branchResult.value : 'HEAD';
        const worktreePath =
          toplevelResult.status === 'fulfilled' ? toplevelResult.value : validatedDirPath;

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
        logger.error({ err, path: validatedDirPath }, 'git status failed');
        throw new WorkerError('GIT_STATUS_FAILED', `Failed to get git status: ${errMessage}`, {
          path: validatedDirPath,
        });
      }
    },
  );
}
