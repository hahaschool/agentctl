// ---------------------------------------------------------------------------
// Worker-side file browsing routes — allows the control plane (and ultimately
// the web UI) to list directories, read file contents, and write file contents
// on the machine where this worker is running.
//
// Security: path validation stays in the same scope as each fs sink so CodeQL
// can trace resolve() + prefix checks directly into stat/open/readdir/write.
// ---------------------------------------------------------------------------

import type { Dirent } from 'node:fs';
import {
  closeSync,
  constants,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve, sep } from 'node:path';

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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum file size we will read (1 MB). */
const MAX_FILE_SIZE_BYTES = 1_048_576;

/** Base directories that file operations may access. */
const ALLOWED_BASE_DIRECTORIES: readonly string[] = [
  resolve(homedir()),
  '/tmp',
  '/var',
  '/opt',
  '/usr',
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FileRouteOptions = FastifyPluginOptions & {
  logger: Logger;
};

type FileEntry = {
  name: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
};

// ---------------------------------------------------------------------------
// Shared validation helpers
// ---------------------------------------------------------------------------

function rejectMalformedInput(raw: unknown): asserts raw is string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new WorkerError('INVALID_PATH', 'A non-empty "path" parameter is required');
  }

  if (!raw.startsWith('/')) {
    throw new WorkerError('INVALID_PATH', 'Path must be absolute', { path: raw });
  }

  if (raw.split('/').includes('..')) {
    throw new WorkerError('INVALID_PATH', 'Path traversal is not allowed', { path: raw });
  }
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export async function fileRoutes(app: FastifyInstance, opts: FileRouteOptions): Promise<void> {
  const { logger } = opts;

  // Register @fastify/rate-limit so CodeQL recognises framework-level
  // throttling. Per-route limits are still enforced by the custom preHandlers.
  await app.register(rateLimit, {
    global: false,
    max: readRateLimitEnv('FILE_ROUTE_GLOBAL_RATE_LIMIT_MAX', 60),
    timeWindow: readRateLimitEnv('FILE_ROUTE_GLOBAL_RATE_LIMIT_WINDOW_MS', 60_000),
  });

  const fileListRateLimit = createIpRateLimitPreHandler(
    createInMemoryRateLimiter(
      readRateLimitEnv('FILE_LIST_RATE_LIMIT_MAX', 60),
      readRateLimitEnv('FILE_LIST_RATE_LIMIT_WINDOW_MS', 60_000),
    ),
    'Too many directory listing requests. Try again later.',
  );

  const fileContentRateLimit = createIpRateLimitPreHandler(
    createInMemoryRateLimiter(
      readRateLimitEnv('FILE_CONTENT_RATE_LIMIT_MAX', 60),
      readRateLimitEnv('FILE_CONTENT_RATE_LIMIT_WINDOW_MS', 60_000),
    ),
    'Too many file content requests. Try again later.',
  );

  const fileWriteRateLimit = createIpRateLimitPreHandler(
    createInMemoryRateLimiter(
      readRateLimitEnv('FILE_WRITE_RATE_LIMIT_MAX', 30),
      readRateLimitEnv('FILE_WRITE_RATE_LIMIT_WINDOW_MS', 60_000),
    ),
    'Too many file write requests. Try again later.',
  );

  app.get<{ Querystring: { path?: string } }>(
    '/',
    {
      preHandler: fileListRateLimit,
    },
    async (request) => {
      const rawPath = request.query.path;
      rejectMalformedInput(rawPath);

      const resolvedRawPath = resolve(rawPath);
      let dirPath: string | undefined;
      let matchedBase: string | undefined;
      for (const base of ALLOWED_BASE_DIRECTORIES) {
        const resolvedBase = resolve(base);
        const allowedPrefix = resolvedBase.endsWith(sep) ? resolvedBase : `${resolvedBase}${sep}`;
        if (resolvedRawPath === resolvedBase || resolvedRawPath.startsWith(allowedPrefix)) {
          dirPath = resolvedRawPath;
          matchedBase = resolvedBase;
          break;
        }
      }

      if (dirPath === undefined || matchedBase === undefined) {
        throw new WorkerError('INVALID_PATH', 'Path is outside allowed directories', {
          path: resolvedRawPath,
        });
      }

      const deniedSegment = findDeniedPathSegment(dirPath, DEFAULT_DENIED_PATH_SEGMENTS);
      if (deniedSegment !== null) {
        throw new WorkerError(
          'INVALID_PATH',
          `Access to "${deniedSegment}" directories is denied for security reasons`,
          { path: dirPath, deniedSegment },
        );
      }

      let dirents: Dirent[];
      try {
        const stat = statSync(dirPath);
        if (!stat.isDirectory()) {
          throw new WorkerError('INVALID_PATH', 'Path is not a directory', { path: dirPath });
        }
        dirents = readdirSync(dirPath, { withFileTypes: true }) as Dirent[];
      } catch (err) {
        if (err instanceof WorkerError) throw err;
        const nodeErr = err as NodeJS.ErrnoException;
        if (nodeErr.code === 'ENOENT') {
          throw new WorkerError('PATH_NOT_FOUND', `Directory does not exist: ${dirPath}`, {
            path: dirPath,
          });
        }
        throw new WorkerError('FS_ERROR', `Failed to read directory: ${nodeErr.message}`, {
          path: dirPath,
        });
      }

      logger.debug({ path: dirPath }, 'listing directory');

      const entries: FileEntry[] = [];
      const dirPrefix = dirPath.endsWith(sep) ? dirPath : `${dirPath}${sep}`;
      const allowedBasePrefix = matchedBase.endsWith(sep) ? matchedBase : `${matchedBase}${sep}`;

      for (const dirent of dirents) {
        if ((DEFAULT_DENIED_PATH_SEGMENTS as readonly string[]).includes(dirent.name)) continue;

        const entry: FileEntry = {
          name: dirent.name,
          type: dirent.isDirectory() ? 'directory' : 'file',
        };

        try {
          const childPath = resolve(dirPath, dirent.name);
          if (childPath !== dirPath && !childPath.startsWith(dirPrefix)) {
            throw new WorkerError('INVALID_PATH', 'Path traversal is not allowed', {
              path: childPath,
            });
          }
          if (childPath !== matchedBase && !childPath.startsWith(allowedBasePrefix)) {
            throw new WorkerError('INVALID_PATH', 'Path is outside allowed directories', {
              path: childPath,
            });
          }
          const childDeniedSegment = findDeniedPathSegment(childPath, DEFAULT_DENIED_PATH_SEGMENTS);
          if (childDeniedSegment !== null) {
            throw new WorkerError(
              'INVALID_PATH',
              `Access to "${childDeniedSegment}" directories is denied for security reasons`,
              { path: childPath, deniedSegment: childDeniedSegment },
            );
          }

          const childStat = statSync(childPath);
          entry.size = childStat.size;
          entry.modified = childStat.mtime.toISOString();
        } catch {
          // If we can't stat a child (or it fails validation), skip size/modified.
        }

        entries.push(entry);
      }

      entries.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      return { entries, path: dirPath };
    },
  );

  app.get<{ Querystring: { path?: string } }>(
    '/content',
    {
      preHandler: fileContentRateLimit,
    },
    async (request) => {
      const rawPath = request.query.path;
      rejectMalformedInput(rawPath);

      const resolvedRawPath = resolve(rawPath);
      let filePath: string | undefined;
      let matchedBase: string | undefined;
      for (const base of ALLOWED_BASE_DIRECTORIES) {
        const resolvedBase = resolve(base);
        const allowedPrefix = resolvedBase.endsWith(sep) ? resolvedBase : `${resolvedBase}${sep}`;
        if (resolvedRawPath === resolvedBase || resolvedRawPath.startsWith(allowedPrefix)) {
          filePath = resolvedRawPath;
          matchedBase = resolvedBase;
          break;
        }
      }

      if (filePath === undefined || matchedBase === undefined) {
        throw new WorkerError('INVALID_PATH', 'Path is outside allowed directories', {
          path: resolvedRawPath,
        });
      }

      const deniedSegment = findDeniedPathSegment(filePath, DEFAULT_DENIED_PATH_SEGMENTS);
      if (deniedSegment !== null) {
        throw new WorkerError(
          'INVALID_PATH',
          `Access to "${deniedSegment}" directories is denied for security reasons`,
          { path: filePath, deniedSegment },
        );
      }

      let fd: number;
      try {
        fd = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      } catch (err) {
        const nodeErr = err as NodeJS.ErrnoException;
        if (nodeErr.code === 'ENOENT') {
          throw new WorkerError('PATH_NOT_FOUND', `File does not exist: ${filePath}`, {
            path: filePath,
          });
        }
        if (nodeErr.code === 'ELOOP') {
          throw new WorkerError('INVALID_PATH', 'Symlinks are not allowed', { path: filePath });
        }
        throw new WorkerError('FS_ERROR', `Failed to open file: ${nodeErr.message}`, {
          path: filePath,
        });
      }

      try {
        const allowedBasePrefix = matchedBase.endsWith(sep) ? matchedBase : `${matchedBase}${sep}`;
        if (filePath !== matchedBase && !filePath.startsWith(allowedBasePrefix)) {
          throw new WorkerError('INVALID_PATH', 'Path is outside allowed directories', {
            path: filePath,
          });
        }

        const stat = statSync(filePath);
        if (stat.isDirectory()) {
          throw new WorkerError('INVALID_PATH', 'Path is a directory, not a file', {
            path: filePath,
          });
        }

        if (stat.size > MAX_FILE_SIZE_BYTES) {
          throw new WorkerError(
            'INVALID_PATH',
            `File exceeds maximum size of ${MAX_FILE_SIZE_BYTES} bytes (actual: ${stat.size})`,
            { path: filePath, size: stat.size, maxSize: MAX_FILE_SIZE_BYTES },
          );
        }

        logger.debug({ path: filePath, size: stat.size }, 'reading file content');

        const buffer = Buffer.alloc(stat.size);
        readSync(fd, buffer, 0, stat.size, 0);
        const content = buffer.toString('utf-8');

        return {
          content,
          path: filePath,
          size: stat.size,
        };
      } finally {
        closeSync(fd);
      }
    },
  );

  app.put<{ Body: { path?: string; content?: string } }>(
    '/content',
    {
      preHandler: fileWriteRateLimit,
    },
    async (request) => {
      const body = request.body ?? {};
      rejectMalformedInput(body.path);

      const resolvedRawPath = resolve(body.path);
      let filePath: string | undefined;
      let matchedBase: string | undefined;
      for (const base of ALLOWED_BASE_DIRECTORIES) {
        const resolvedBase = resolve(base);
        const allowedPrefix = resolvedBase.endsWith(sep) ? resolvedBase : `${resolvedBase}${sep}`;
        if (resolvedRawPath === resolvedBase || resolvedRawPath.startsWith(allowedPrefix)) {
          filePath = resolvedRawPath;
          matchedBase = resolvedBase;
          break;
        }
      }

      if (filePath === undefined || matchedBase === undefined) {
        throw new WorkerError('INVALID_PATH', 'Path is outside allowed directories', {
          path: resolvedRawPath,
        });
      }

      const deniedSegment = findDeniedPathSegment(filePath, DEFAULT_DENIED_PATH_SEGMENTS);
      if (deniedSegment !== null) {
        throw new WorkerError(
          'INVALID_PATH',
          `Access to "${deniedSegment}" directories is denied for security reasons`,
          { path: filePath, deniedSegment },
        );
      }

      if (typeof body.content !== 'string') {
        throw new WorkerError('INVALID_PATH', 'Request body must include a "content" string field');
      }

      const parentDir = resolve(dirname(filePath));
      const allowedBasePrefix = matchedBase.endsWith(sep) ? matchedBase : `${matchedBase}${sep}`;
      if (parentDir !== matchedBase && !parentDir.startsWith(allowedBasePrefix)) {
        throw new WorkerError('INVALID_PATH', 'Path is outside allowed directories', {
          path: parentDir,
        });
      }

      const parentDeniedSegment = findDeniedPathSegment(parentDir, DEFAULT_DENIED_PATH_SEGMENTS);
      if (parentDeniedSegment !== null) {
        throw new WorkerError(
          'INVALID_PATH',
          `Access to "${parentDeniedSegment}" directories is denied for security reasons`,
          { path: parentDir, deniedSegment: parentDeniedSegment },
        );
      }

      try {
        mkdirSync(parentDir, { recursive: true });
      } catch (err) {
        const nodeErr = err as NodeJS.ErrnoException;
        throw new WorkerError('FS_ERROR', `Failed to create directory: ${nodeErr.message}`, {
          path: parentDir,
        });
      }

      logger.info({ path: filePath, contentLength: body.content.length }, 'writing file content');
      writeFileSync(filePath, body.content, 'utf-8');

      return {
        success: true,
        path: filePath,
      };
    },
  );
}
