// ---------------------------------------------------------------------------
// Worker-side file browsing routes — allows the control plane (and ultimately
// the web UI) to list directories, read file contents, and write file contents
// on the machine where this worker is running.
//
// Security: route handlers validate user-controlled paths up front, then hand
// the resolved safe paths to local helpers for filesystem access.
// ---------------------------------------------------------------------------

import type { Dirent } from 'node:fs';
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

import { WorkerError } from '@agentctl/shared';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { Logger } from 'pino';

import {
  DEFAULT_DENIED_PATH_SEGMENTS,
  findDeniedPathSegment,
  safeReadFileAtomic,
  safeWriteFileSync,
  sanitizePath,
} from '../../utils/path-security.js';
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

type SafePath = {
  path: string;
  allowedBase: string;
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

function toSafePath(raw: string): SafePath {
  for (const base of ALLOWED_BASE_DIRECTORIES) {
    try {
      const safePath = sanitizePath(raw, base);
      const deniedSegment = findDeniedPathSegment(safePath, DEFAULT_DENIED_PATH_SEGMENTS);
      if (deniedSegment !== null) {
        throw new WorkerError(
          'INVALID_PATH',
          `Access to "${deniedSegment}" directories is denied for security reasons`,
          { path: safePath, deniedSegment },
        );
      }
      return { path: safePath, allowedBase: resolve(base) };
    } catch (error) {
      if (error instanceof WorkerError) {
        throw error;
      }
      // Path not under this base — try the next one.
    }
  }

  throw new WorkerError('INVALID_PATH', 'Path is outside allowed directories', {
    path: resolve(raw),
  });
}

function listSafeDirectory(safeDirPath: string, allowedBase: string): Dirent[] {
  const normalizedDirPath = sanitizePath(safeDirPath, allowedBase);
  const stat = statSync(normalizedDirPath);
  if (!stat.isDirectory()) {
    throw new WorkerError('INVALID_PATH', 'Path is not a directory', { path: normalizedDirPath });
  }

  return readdirSync(normalizedDirPath, { withFileTypes: true }) as Dirent[];
}

function readSafeChildMetadata(
  safeDirPath: string,
  allowedBase: string,
  childName: string,
): Pick<FileEntry, 'size' | 'modified'> {
  const childPath = sanitizePath(resolve(safeDirPath, childName), allowedBase);
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
  safeFilePath: string,
  allowedBase: string,
): { content: string; size: number } {
  const normalizedFilePath = sanitizePath(safeFilePath, allowedBase);
  const stat = statSync(normalizedFilePath);
  if (stat.isDirectory()) {
    throw new WorkerError('INVALID_PATH', 'Path is a directory, not a file', {
      path: normalizedFilePath,
    });
  }

  if (stat.size > MAX_FILE_SIZE_BYTES) {
    throw new WorkerError(
      'INVALID_PATH',
      `File exceeds maximum size of ${MAX_FILE_SIZE_BYTES} bytes (actual: ${stat.size})`,
      { path: normalizedFilePath, size: stat.size, maxSize: MAX_FILE_SIZE_BYTES },
    );
  }

  return safeReadFileAtomic(normalizedFilePath, allowedBase, MAX_FILE_SIZE_BYTES);
}

function ensureSafeDirectory(safeDirPath: string, allowedBase: string): void {
  const normalizedDirPath = sanitizePath(safeDirPath, allowedBase);
  mkdirSync(normalizedDirPath, { recursive: true });
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
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      preHandler: fileListRateLimit,
    },
    async (request) => {
      const rawPath = request.query.path;
      rejectMalformedInput(rawPath);
      const dirPath = toSafePath(rawPath);

      let dirents: Dirent[];
      try {
        dirents = listSafeDirectory(dirPath.path, dirPath.allowedBase);
      } catch (err) {
        if (err instanceof WorkerError) throw err;
        const nodeErr = err as NodeJS.ErrnoException;
        if (nodeErr.code === 'ENOENT') {
          throw new WorkerError('PATH_NOT_FOUND', `Directory does not exist: ${dirPath.path}`, {
            path: dirPath.path,
          });
        }
        throw new WorkerError('FS_ERROR', `Failed to read directory: ${nodeErr.message}`, {
          path: dirPath.path,
        });
      }

      logger.debug({ path: dirPath.path }, 'listing directory');

      const entries: FileEntry[] = [];

      for (const dirent of dirents) {
        if ((DEFAULT_DENIED_PATH_SEGMENTS as readonly string[]).includes(dirent.name)) continue;

        const entry: FileEntry = {
          name: dirent.name,
          type: dirent.isDirectory() ? 'directory' : 'file',
        };

        try {
          Object.assign(
            entry,
            readSafeChildMetadata(dirPath.path, dirPath.allowedBase, dirent.name),
          );
        } catch {
          // If we can't stat a child (or it fails validation), skip size/modified.
        }

        entries.push(entry);
      }

      entries.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      return { entries, path: dirPath.path };
    },
  );

  app.get<{ Querystring: { path?: string } }>(
    '/content',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      preHandler: fileContentRateLimit,
    },
    async (request) => {
      const rawPath = request.query.path;
      rejectMalformedInput(rawPath);
      const filePath = toSafePath(rawPath);

      try {
        const result = readSafeFileContent(filePath.path, filePath.allowedBase);
        logger.debug({ path: filePath.path, size: result.size }, 'reading file content');

        return {
          content: result.content,
          path: filePath.path,
          size: result.size,
        };
      } catch (err) {
        if (err instanceof WorkerError) throw err;
        const nodeErr = err as NodeJS.ErrnoException & { size?: number };
        if (nodeErr.code === 'ENOENT') {
          throw new WorkerError('PATH_NOT_FOUND', `File does not exist: ${filePath.path}`, {
            path: filePath.path,
          });
        }
        if (nodeErr.code === 'ELOOP') {
          throw new WorkerError('INVALID_PATH', 'Symlinks are not allowed', {
            path: filePath.path,
          });
        }
        if (nodeErr.code === 'FILE_TOO_LARGE') {
          throw new WorkerError(
            'INVALID_PATH',
            `File exceeds maximum size of ${MAX_FILE_SIZE_BYTES} bytes (actual: ${nodeErr.size ?? 'unknown'})`,
            { path: filePath.path, size: nodeErr.size, maxSize: MAX_FILE_SIZE_BYTES },
          );
        }
        throw new WorkerError('FS_ERROR', `Failed to read file: ${nodeErr.message}`, {
          path: filePath.path,
        });
      }
    },
  );

  app.put<{ Body: { path?: string; content?: string } }>(
    '/content',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      preHandler: fileWriteRateLimit,
    },
    async (request) => {
      const body = request.body ?? {};
      rejectMalformedInput(body.path);
      const filePath = toSafePath(body.path);

      if (typeof body.content !== 'string') {
        throw new WorkerError('INVALID_PATH', 'Request body must include a "content" string field');
      }

      const parentDir = sanitizePath(dirname(filePath.path), filePath.allowedBase);

      try {
        ensureSafeDirectory(parentDir, filePath.allowedBase);
      } catch (err) {
        const nodeErr = err as NodeJS.ErrnoException;
        throw new WorkerError('FS_ERROR', `Failed to create directory: ${nodeErr.message}`, {
          path: parentDir,
        });
      }

      logger.info(
        { path: filePath.path, contentLength: body.content.length },
        'writing file content',
      );
      safeWriteFileSync(filePath.path, filePath.allowedBase, body.content);

      return {
        success: true,
        path: filePath.path,
      };
    },
  );
}
