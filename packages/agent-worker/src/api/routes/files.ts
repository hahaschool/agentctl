// ---------------------------------------------------------------------------
// Worker-side file browsing routes — allows the control plane (and ultimately
// the web UI) to list directories, read file contents, and write file contents
// on the machine where this worker is running.
//
// Security: every route handler validates file paths inline using the shared
// `sanitizePath` + `findDeniedPathSegment` utilities from path-security.ts.
// The sanitisation is intentionally performed at each call site (rather than
// in a shared wrapper) so that CodeQL's interprocedural taint analysis can
// trace the resolve() → startsWith() → fs-sink flow within the same scope.
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
import { dirname, resolve } from 'node:path';

import { WorkerError } from '@agentctl/shared';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { Logger } from 'pino';

import {
  DEFAULT_DENIED_PATH_SEGMENTS,
  findDeniedPathSegment,
  sanitizePath,
} from '../../utils/path-security.js';

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
// Shared validation helpers (not path resolution — just pre-checks)
// ---------------------------------------------------------------------------

/**
 * Reject obviously invalid raw input before attempting sanitisation.
 * Throws WorkerError for non-string, empty, relative, or `..`-containing paths.
 */
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

/**
 * Run the shared `sanitizePath` against every allowed base directory and
 * then check for denied segments. Returns the resolved, validated path.
 *
 * This function is deliberately kept small and returns the same value that
 * `sanitizePath` produces (which is `path.resolve()` output verified via
 * `startsWith()`). Each route handler calls this AND uses the return value
 * directly in fs calls so CodeQL can trace the taint barrier.
 */
function toSafePath(raw: string): string {
  let safePath: string | undefined;
  for (const base of ALLOWED_BASE_DIRECTORIES) {
    try {
      safePath = sanitizePath(raw, base);
      break;
    } catch {
      // Path not under this base — try the next one
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

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export async function fileRoutes(app: FastifyInstance, opts: FileRouteOptions): Promise<void> {
  const { logger } = opts;

  // -------------------------------------------------------------------------
  // GET /api/files — list directory contents
  // -------------------------------------------------------------------------

  app.get<{ Querystring: { path?: string } }>('/', async (request) => {
    // -- Validate path inline so CodeQL traces the taint barrier -------------
    const rawPath = request.query.path;
    rejectMalformedInput(rawPath);
    const dirPath = toSafePath(rawPath);

    // Avoid TOCTOU: attempt the operation directly and handle errors
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

    for (const dirent of dirents) {
      // Skip denied segments in child entries too
      if ((DEFAULT_DENIED_PATH_SEGMENTS as readonly string[]).includes(dirent.name)) continue;

      const entry: FileEntry = {
        name: dirent.name,
        type: dirent.isDirectory() ? 'directory' : 'file',
      };

      // Validate child paths through sanitizePath before passing to statSync
      // to satisfy CodeQL's js/path-injection check on child entries.
      try {
        const childPath = sanitizePath(resolve(dirPath, dirent.name), dirPath);
        const childStat = statSync(childPath);
        entry.size = childStat.size;
        entry.modified = childStat.mtime.toISOString();
      } catch {
        // If we can't stat a child (or it fails validation), skip size/modified
      }

      entries.push(entry);
    }

    // Sort: directories first, then alphabetically
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return { entries, path: dirPath };
  });

  // -------------------------------------------------------------------------
  // GET /api/files/content — read file content
  // -------------------------------------------------------------------------

  app.get<{ Querystring: { path?: string } }>('/content', async (request) => {
    // -- Validate path inline so CodeQL traces the taint barrier -------------
    const rawPath = request.query.path;
    rejectMalformedInput(rawPath);
    const filePath = toSafePath(rawPath);

    // Avoid TOCTOU (js/file-system-race): open the file atomically instead of
    // checking existence first, then reading. O_NOFOLLOW prevents symlink attacks.
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
  });

  // -------------------------------------------------------------------------
  // PUT /api/files/content — write file content
  // -------------------------------------------------------------------------

  app.put<{ Body: { path?: string; content?: string } }>('/content', async (request) => {
    const body = request.body ?? {};

    // -- Validate path inline so CodeQL traces the taint barrier -------------
    rejectMalformedInput(body.path);
    const filePath = toSafePath(body.path);

    if (typeof body.content !== 'string') {
      throw new WorkerError('INVALID_PATH', 'Request body must include a "content" string field');
    }

    // Validate the parent directory path to prevent js/http-to-file-access.
    // We use sanitizePath on dirname(filePath) so that both the file path and
    // its parent are proven safe before any fs write operation.
    const parentDir = dirname(filePath);
    const safeDirPath = toSafePath(parentDir);

    // Create parent directories if they don't exist (use recursive which is
    // idempotent, avoiding TOCTOU from existsSync check)
    try {
      mkdirSync(safeDirPath, { recursive: true });
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      throw new WorkerError('FS_ERROR', `Failed to create directory: ${nodeErr.message}`, {
        path: safeDirPath,
      });
    }

    logger.info({ path: filePath, contentLength: body.content.length }, 'writing file content');

    // Write using the sanitized filePath — CodeQL traces this from the
    // sanitizePath call above through to the writeFileSync sink.
    writeFileSync(filePath, body.content, 'utf-8');

    return {
      success: true,
      path: filePath,
    };
  });
}
