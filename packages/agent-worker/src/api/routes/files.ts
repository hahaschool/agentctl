// ---------------------------------------------------------------------------
// Worker-side file browsing routes — allows the control plane (and ultimately
// the web UI) to list directories, read file contents, and write file contents
// on the machine where this worker is running.
//
// Security: paths are validated to prevent access to sensitive directories
// (.ssh, .gnupg, .aws, .env, credentials) per project security rules.
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum file size we will read (1 MB). */
const MAX_FILE_SIZE_BYTES = 1_048_576;

/** Path segments that are never allowed to appear in a requested path. */
const DENIED_SEGMENTS = ['.ssh', '.gnupg', '.aws', '.env', 'credentials'];

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
// Path validation
// ---------------------------------------------------------------------------

/**
 * Validate and resolve a user-provided path for safe use in fs operations.
 *
 * CodeQL's `js/path-injection` query requires that the SAME variable produced
 * by `path.resolve()` is checked via `startsWith()` against an allowlist before
 * reaching any fs API.  This function centralises that flow so every call site
 * receives a resolved, validated string that CodeQL can trace.
 *
 * Steps:
 *  1. Reject non-string / empty / relative input.
 *  2. Reject raw input containing `..` segments (belt-and-suspenders).
 *  3. `path.resolve()` normalises the value (collapses `.`, `//`, etc.).
 *  4. Verify the resolved path falls under an allowed base directory.
 *  5. Reject paths that traverse into denied directories (.ssh, .gnupg, …).
 *  6. Return the resolved path — this is the only value callers should use.
 */
function validateAndResolvePath(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new WorkerError('INVALID_PATH', 'A non-empty "path" parameter is required');
  }

  if (!raw.startsWith('/')) {
    throw new WorkerError('INVALID_PATH', 'Path must be absolute', { path: raw });
  }

  if (raw.split('/').includes('..')) {
    throw new WorkerError('INVALID_PATH', 'Path traversal is not allowed', { path: raw });
  }

  // Normalise — the resolved value is what we validate AND what callers use.
  const resolved = resolve(raw);

  // Allowlist check: the resolved path must be exactly, or nested under, one
  // of the allowed base directories.
  const matchedBase = ALLOWED_BASE_DIRECTORIES.find(
    (base) => resolved === base || resolved.startsWith(`${base}/`),
  );

  if (!matchedBase) {
    throw new WorkerError('INVALID_PATH', 'Path is outside allowed directories', {
      path: resolved,
    });
  }

  // Denied-segment check on the fully resolved path.
  for (const segment of resolved.split('/')) {
    if (DENIED_SEGMENTS.includes(segment)) {
      throw new WorkerError(
        'INVALID_PATH',
        `Access to "${segment}" directories is denied for security reasons`,
        { path: resolved, deniedSegment: segment },
      );
    }
  }

  return resolved;
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
    const dirPath = validateAndResolvePath(request.query.path);

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
      if (DENIED_SEGMENTS.includes(dirent.name)) continue;

      const entry: FileEntry = {
        name: dirent.name,
        type: dirent.isDirectory() ? 'directory' : 'file',
      };

      try {
        const childPath = resolve(dirPath, dirent.name);
        const childStat = statSync(childPath);
        entry.size = childStat.size;
        entry.modified = childStat.mtime.toISOString();
      } catch {
        // If we can't stat a child, just skip size/modified
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
    const filePath = validateAndResolvePath(request.query.path);

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
    const filePath = validateAndResolvePath(body.path);

    if (typeof body.content !== 'string') {
      throw new WorkerError('INVALID_PATH', 'Request body must include a "content" string field');
    }

    // Also validate the parent directory path to prevent js/http-to-file-access
    const dirPath = validateAndResolvePath(dirname(filePath));

    // Create parent directories if they don't exist (use recursive which is idempotent,
    // avoiding TOCTOU from existsSync check)
    try {
      mkdirSync(dirPath, { recursive: true });
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      throw new WorkerError('FS_ERROR', `Failed to create directory: ${nodeErr.message}`, {
        path: dirPath,
      });
    }

    logger.info({ path: filePath, contentLength: body.content.length }, 'writing file content');

    writeFileSync(filePath, body.content, 'utf-8');

    return {
      success: true,
      path: filePath,
    };
  });
}
