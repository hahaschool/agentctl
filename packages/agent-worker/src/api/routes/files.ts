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

function toSafePath(raw: string): string {
  let safePath: string | undefined;
  for (const base of ALLOWED_BASE_DIRECTORIES) {
    try {
      safePath = sanitizePath(raw, base);
      break;
    } catch {
      // Path not under this base — try the next one.
    }
  }

  if (safePath === undefined) {
    throw new WorkerError('INVALID_PATH', 'Path is outside allowed directories', {
      path: resolve(raw),
    });
  }

  const deniedSegment = findDeniedPathSegment(safePath, DEFAULT_DENIED_PATH_SEGMENTS);
  if (deniedSegment !== null) {
    throw new WorkerError(
      'INVALID_PATH',
      `Access to "${deniedSegment}" directories is denied for security reasons`,
      { path: safePath, deniedSegment },
    );
  }

  return safePath;
}

function listSafeDirectory(safeDirPath: string): Dirent[] {
  const stat = statSync(safeDirPath);
  if (!stat.isDirectory()) {
    throw new WorkerError('INVALID_PATH', 'Path is not a directory', { path: safeDirPath });
  }

  return readdirSync(safeDirPath, { withFileTypes: true }) as Dirent[];
}

function readSafeChildMetadata(
  safeDirPath: string,
  childName: string,
): Pick<FileEntry, 'size' | 'modified'> {
  const childPath = sanitizePath(resolve(safeDirPath, childName), safeDirPath);
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

function readSafeFileContent(safeFilePath: string): { content: string; size: number } {
  const stat = statSync(safeFilePath);
  if (stat.isDirectory()) {
    throw new WorkerError('INVALID_PATH', 'Path is a directory, not a file', {
      path: safeFilePath,
    });
  }

  if (stat.size > MAX_FILE_SIZE_BYTES) {
    throw new WorkerError(
      'INVALID_PATH',
      `File exceeds maximum size of ${MAX_FILE_SIZE_BYTES} bytes (actual: ${stat.size})`,
      { path: safeFilePath, size: stat.size, maxSize: MAX_FILE_SIZE_BYTES },
    );
  }

  return safeReadFileAtomic(safeFilePath, dirname(safeFilePath), MAX_FILE_SIZE_BYTES);
}

function ensureSafeDirectory(safeDirPath: string): void {
  mkdirSync(safeDirPath, { recursive: true });
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
      const dirPath = toSafePath(rawPath);

      let dirents: Dirent[];
      try {
        dirents = listSafeDirectory(dirPath);
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
          Object.assign(entry, readSafeChildMetadata(dirPath, dirent.name));
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
      const filePath = toSafePath(rawPath);

      try {
        const result = readSafeFileContent(filePath);
        logger.debug({ path: filePath, size: result.size }, 'reading file content');

        return {
          content: result.content,
          path: filePath,
          size: result.size,
        };
      } catch (err) {
        if (err instanceof WorkerError) throw err;
        const nodeErr = err as NodeJS.ErrnoException & { size?: number };
        if (nodeErr.code === 'ENOENT') {
          throw new WorkerError('PATH_NOT_FOUND', `File does not exist: ${filePath}`, {
            path: filePath,
          });
        }
        if (nodeErr.code === 'ELOOP') {
          throw new WorkerError('INVALID_PATH', 'Symlinks are not allowed', { path: filePath });
        }
        if (nodeErr.code === 'FILE_TOO_LARGE') {
          throw new WorkerError(
            'INVALID_PATH',
            `File exceeds maximum size of ${MAX_FILE_SIZE_BYTES} bytes (actual: ${nodeErr.size ?? 'unknown'})`,
            { path: filePath, size: nodeErr.size, maxSize: MAX_FILE_SIZE_BYTES },
          );
        }
        throw new WorkerError('FS_ERROR', `Failed to read file: ${nodeErr.message}`, {
          path: filePath,
        });
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
      const filePath = toSafePath(body.path);

      if (typeof body.content !== 'string') {
        throw new WorkerError('INVALID_PATH', 'Request body must include a "content" string field');
      }

      const parentDir = toSafePath(dirname(filePath));

      try {
        ensureSafeDirectory(parentDir);
      } catch (err) {
        const nodeErr = err as NodeJS.ErrnoException;
        throw new WorkerError('FS_ERROR', `Failed to create directory: ${nodeErr.message}`, {
          path: parentDir,
        });
      }

      logger.info({ path: filePath, contentLength: body.content.length }, 'writing file content');
      safeWriteFileSync(filePath, parentDir, body.content);

      return {
        success: true,
        path: filePath,
      };
    },
  );
}
