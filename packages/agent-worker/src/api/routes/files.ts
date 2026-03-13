// ---------------------------------------------------------------------------
// Worker-side file browsing routes — allows the control plane (and ultimately
// the web UI) to list directories, read file contents, and write file contents
// on the machine where this worker is running.
//
// Security: route handlers validate user-controlled paths up front, then pass
// resolved paths plus their allowed base into local filesystem helpers.
// ---------------------------------------------------------------------------

import type { Dirent } from 'node:fs';
import {
  closeSync,
  constants,
  fstatSync,
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

function resolveAllowedPath(raw: string): { path: string; base: string } {
  const resolvedRawPath = resolve(raw);
  let matchedBase: string | undefined;

  for (const base of ALLOWED_BASE_DIRECTORIES) {
    const resolvedBase = resolve(base);
    const allowedPrefix = resolvedBase.endsWith(sep) ? resolvedBase : `${resolvedBase}${sep}`;
    if (resolvedRawPath === resolvedBase || resolvedRawPath.startsWith(allowedPrefix)) {
      matchedBase = resolvedBase;
      break;
    }
  }

  if (matchedBase === undefined) {
    throw new WorkerError('INVALID_PATH', 'Path is outside allowed directories', {
      path: resolvedRawPath,
    });
  }

  const deniedSegment = findDeniedPathSegment(resolvedRawPath, DEFAULT_DENIED_PATH_SEGMENTS);
  if (deniedSegment !== null) {
    throw new WorkerError(
      'INVALID_PATH',
      `Access to "${deniedSegment}" directories is denied for security reasons`,
      { path: resolvedRawPath, deniedSegment },
    );
  }

  return { path: resolvedRawPath, base: matchedBase };
}

function listSafeDirectory(dirPath: string, allowedBase: string): Dirent[] {
  const resolvedDirPath = resolve(dirPath);
  const resolvedBase = resolve(allowedBase);
  const allowedPrefix = resolvedBase.endsWith(sep) ? resolvedBase : `${resolvedBase}${sep}`;
  if (resolvedDirPath !== resolvedBase && !resolvedDirPath.startsWith(allowedPrefix)) {
    throw new WorkerError('INVALID_PATH', 'Path is outside allowed directories', {
      path: resolvedDirPath,
    });
  }

  const stat = statSync(resolvedDirPath);
  if (!stat.isDirectory()) {
    throw new WorkerError('INVALID_PATH', 'Path is not a directory', { path: resolvedDirPath });
  }

  return readdirSync(resolvedDirPath, { withFileTypes: true }) as Dirent[];
}

function readSafeChildMetadata(
  dirPath: string,
  allowedBase: string,
  childName: string,
): Pick<FileEntry, 'size' | 'modified'> {
  const resolvedDirPath = resolve(dirPath);
  const dirPrefix = resolvedDirPath.endsWith(sep) ? resolvedDirPath : `${resolvedDirPath}${sep}`;
  const resolvedBase = resolve(allowedBase);
  const allowedPrefix = resolvedBase.endsWith(sep) ? resolvedBase : `${resolvedBase}${sep}`;
  const childPath = resolve(resolvedDirPath, childName);

  if (childPath !== resolvedDirPath && !childPath.startsWith(dirPrefix)) {
    throw new WorkerError('INVALID_PATH', 'Path traversal is not allowed', {
      path: childPath,
    });
  }
  if (childPath !== resolvedBase && !childPath.startsWith(allowedPrefix)) {
    throw new WorkerError('INVALID_PATH', 'Path is outside allowed directories', {
      path: childPath,
    });
  }

  const deniedSegment = findDeniedPathSegment(childPath, DEFAULT_DENIED_PATH_SEGMENTS);
  if (deniedSegment !== null) {
    throw new WorkerError(
      'INVALID_PATH',
      `Access to "${deniedSegment}" directories is denied for security reasons`,
      { path: childPath, deniedSegment },
    );
  }

  const childStat = statSync(childPath);
  return {
    size: childStat.size,
    modified: childStat.mtime.toISOString(),
  };
}

function readSafeFileContent(
  filePath: string,
  allowedBase: string,
): { content: string; size: number } {
  const resolvedFilePath = resolve(filePath);
  const resolvedBase = resolve(allowedBase);
  const allowedPrefix = resolvedBase.endsWith(sep) ? resolvedBase : `${resolvedBase}${sep}`;
  if (resolvedFilePath !== resolvedBase && !resolvedFilePath.startsWith(allowedPrefix)) {
    throw new WorkerError('INVALID_PATH', 'Path is outside allowed directories', {
      path: resolvedFilePath,
    });
  }

  let fd: number;
  try {
    fd = openSync(resolvedFilePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'ENOENT') {
      throw new WorkerError('PATH_NOT_FOUND', `File does not exist: ${resolvedFilePath}`, {
        path: resolvedFilePath,
      });
    }
    if (nodeErr.code === 'ELOOP') {
      throw new WorkerError('INVALID_PATH', 'Symlinks are not allowed', { path: resolvedFilePath });
    }
    throw new WorkerError('FS_ERROR', `Failed to open file: ${nodeErr.message}`, {
      path: resolvedFilePath,
    });
  }

  try {
    const stat = fstatSync(fd);
    if (stat.isDirectory()) {
      throw new WorkerError('INVALID_PATH', 'Path is a directory, not a file', {
        path: resolvedFilePath,
      });
    }

    if (stat.size > MAX_FILE_SIZE_BYTES) {
      throw new WorkerError(
        'INVALID_PATH',
        `File exceeds maximum size of ${MAX_FILE_SIZE_BYTES} bytes (actual: ${stat.size})`,
        { path: resolvedFilePath, size: stat.size, maxSize: MAX_FILE_SIZE_BYTES },
      );
    }

    const buffer = Buffer.alloc(stat.size);
    const bytesRead = readSync(fd, buffer, 0, stat.size, 0);
    return {
      content: buffer.subarray(0, bytesRead).toString('utf-8'),
      size: stat.size,
    };
  } finally {
    closeSync(fd);
  }
}

function ensureSafeDirectory(dirPath: string, allowedBase: string): void {
  const resolvedDirPath = resolve(dirPath);
  const resolvedBase = resolve(allowedBase);
  const allowedPrefix = resolvedBase.endsWith(sep) ? resolvedBase : `${resolvedBase}${sep}`;
  if (resolvedDirPath !== resolvedBase && !resolvedDirPath.startsWith(allowedPrefix)) {
    throw new WorkerError('INVALID_PATH', 'Path is outside allowed directories', {
      path: resolvedDirPath,
    });
  }

  mkdirSync(resolvedDirPath, { recursive: true });
}

function writeSafeFileContent(filePath: string, allowedBase: string, content: string): void {
  const resolvedFilePath = resolve(filePath);
  const resolvedBase = resolve(allowedBase);
  const allowedPrefix = resolvedBase.endsWith(sep) ? resolvedBase : `${resolvedBase}${sep}`;
  if (resolvedFilePath !== resolvedBase && !resolvedFilePath.startsWith(allowedPrefix)) {
    throw new WorkerError('INVALID_PATH', 'Path is outside allowed directories', {
      path: resolvedFilePath,
    });
  }

  writeFileSync(resolvedFilePath, content);
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export async function fileRoutes(app: FastifyInstance, opts: FileRouteOptions): Promise<void> {
  const { logger } = opts;

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
      const { path: dirPath, base: matchedBase } = resolveAllowedPath(rawPath);

      let dirents: Dirent[];
      try {
        dirents = listSafeDirectory(dirPath, matchedBase);
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

      for (const dirent of dirents) {
        if ((DEFAULT_DENIED_PATH_SEGMENTS as readonly string[]).includes(dirent.name)) continue;

        const entry: FileEntry = {
          name: dirent.name,
          type: dirent.isDirectory() ? 'directory' : 'file',
        };

        try {
          Object.assign(entry, readSafeChildMetadata(dirPath, matchedBase, dirent.name));
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
      const { path: filePath, base: matchedBase } = resolveAllowedPath(rawPath);
      const result = readSafeFileContent(filePath, matchedBase);
      logger.debug({ path: filePath, size: result.size }, 'reading file content');

      return {
        content: result.content,
        path: filePath,
        size: result.size,
      };
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
      const { path: filePath, base: matchedBase } = resolveAllowedPath(body.path);

      if (typeof body.content !== 'string') {
        throw new WorkerError('INVALID_PATH', 'Request body must include a "content" string field');
      }

      const parentDir = dirname(filePath);

      try {
        ensureSafeDirectory(parentDir, matchedBase);
      } catch (err) {
        if (err instanceof WorkerError) throw err;
        const nodeErr = err as NodeJS.ErrnoException;
        throw new WorkerError('FS_ERROR', `Failed to create directory: ${nodeErr.message}`, {
          path: parentDir,
        });
      }

      logger.info({ path: filePath, contentLength: body.content.length }, 'writing file content');
      writeSafeFileContent(filePath, matchedBase, body.content);

      return {
        success: true,
        path: filePath,
      };
    },
  );
}
