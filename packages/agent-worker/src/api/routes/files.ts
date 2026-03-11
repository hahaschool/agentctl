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
import { dirname, normalize, resolve } from 'node:path';

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
 * Validate that a path is absolute and does not traverse into denied
 * directories. Throws a WorkerError if the path is invalid.
 */
function validatePath(raw: unknown): string {
  if (!raw || typeof raw !== 'string') {
    throw new WorkerError('INVALID_PATH', 'A non-empty "path" parameter is required');
  }

  const resolved = resolve(normalize(raw));

  // Must be absolute (resolve guarantees this, but be explicit)
  if (!resolved.startsWith('/')) {
    throw new WorkerError('INVALID_PATH', 'Path must be absolute', { path: raw });
  }

  // Check for denied path segments
  const segments = resolved.split('/');
  for (const segment of segments) {
    if (DENIED_SEGMENTS.includes(segment)) {
      throw new WorkerError(
        'INVALID_PATH',
        `Access to "${segment}" directories is denied for security reasons`,
        { path: resolved, deniedSegment: segment },
      );
    }
  }

  // Must be under the home directory or a common project path
  const home = homedir();
  if (
    !resolved.startsWith(home) &&
    !resolved.startsWith('/tmp') &&
    !resolved.startsWith('/var') &&
    !resolved.startsWith('/opt') &&
    !resolved.startsWith('/usr')
  ) {
    throw new WorkerError('INVALID_PATH', 'Path is outside allowed directories', {
      path: resolved,
    });
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
    const dirPath = validatePath(request.query.path);

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
    const filePath = validatePath(request.query.path);

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
    const filePath = validatePath(body.path);

    if (typeof body.content !== 'string') {
      throw new WorkerError('INVALID_PATH', 'Request body must include a "content" string field');
    }

    // Also validate the parent directory path to prevent js/http-to-file-access
    const dir = dirname(filePath);
    validatePath(dir);

    // Create parent directories if they don't exist (use recursive which is idempotent,
    // avoiding TOCTOU from existsSync check)
    try {
      mkdirSync(dir, { recursive: true });
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      throw new WorkerError('FS_ERROR', `Failed to create directory: ${nodeErr.message}`, {
        path: dir,
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
