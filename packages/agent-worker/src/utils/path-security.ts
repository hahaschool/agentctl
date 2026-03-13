import {
  closeSync,
  existsSync,
  constants as fsConstants,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  writeFileSync,
} from 'node:fs';
import { resolve, sep } from 'node:path';

export const DEFAULT_DENIED_PATH_SEGMENTS = [
  '.ssh',
  '.gnupg',
  '.aws',
  '.env',
  'credentials',
] as const;

/**
 * Resolve a user-controlled path and ensure it stays inside the allowed base.
 * The returned value is safe to pass directly to fs/child_process sinks.
 */
export function sanitizePath(userPath: string, allowedBase: string): string {
  const resolvedBase = resolve(allowedBase);
  const resolvedPath = resolve(userPath);
  const allowedPrefix = resolvedBase.endsWith(sep) ? resolvedBase : `${resolvedBase}${sep}`;

  if (resolvedPath !== resolvedBase && !resolvedPath.startsWith(allowedPrefix)) {
    throw new Error(`Resolved path "${resolvedPath}" is outside the allowed base path`);
  }

  return resolvedPath;
}

export function findDeniedPathSegment(
  userPath: string,
  deniedSegments: readonly string[] = DEFAULT_DENIED_PATH_SEGMENTS,
): string | null {
  const segments = resolve(userPath).split(/[\\/]+/);
  for (const segment of segments) {
    if (deniedSegments.includes(segment)) {
      return segment;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Safe fs wrappers — sanitise + operate atomically so CodeQL sees that
// user-controlled paths never reach raw fs sinks directly.
//
// Each wrapper inlines the path prefix check immediately before the fs
// operation so static analysis (CodeQL) can trace the sanitisation barrier.
// ---------------------------------------------------------------------------

/**
 * Safe wrapper around `existsSync`.  Sanitises `userPath` relative to
 * `allowedBase` and returns the resolved path only if it exists.
 */
export function safeExistsSync(userPath: string, allowedBase: string): string | null {
  const resolvedBase = resolve(allowedBase);
  const safe = resolve(userPath);
  const prefix = resolvedBase.endsWith(sep) ? resolvedBase : `${resolvedBase}${sep}`;
  if (safe !== resolvedBase && !safe.startsWith(prefix)) {
    throw new Error(`Path "${safe}" escapes allowed base "${resolvedBase}"`);
  }
  return existsSync(safe) ? safe : null;
}

/**
 * Safe wrapper around `readFileSync`.
 * Sanitises + validates the path before reading.
 */
export function safeReadFileSync(
  userPath: string,
  allowedBase: string,
  encoding: BufferEncoding = 'utf-8',
): string {
  const resolvedBase = resolve(allowedBase);
  const safe = resolve(userPath);
  const prefix = resolvedBase.endsWith(sep) ? resolvedBase : `${resolvedBase}${sep}`;
  if (safe !== resolvedBase && !safe.startsWith(prefix)) {
    throw new Error(`Path "${safe}" escapes allowed base "${resolvedBase}"`);
  }
  return readFileSync(safe, encoding);
}

/**
 * Safe wrapper around `writeFileSync`.
 * Sanitises + validates the path before writing.
 */
export function safeWriteFileSync(userPath: string, allowedBase: string, data: string): void {
  const resolvedBase = resolve(allowedBase);
  const safe = resolve(userPath);
  const prefix = resolvedBase.endsWith(sep) ? resolvedBase : `${resolvedBase}${sep}`;
  if (safe !== resolvedBase && !safe.startsWith(prefix)) {
    throw new Error(`Path "${safe}" escapes allowed base "${resolvedBase}"`);
  }
  writeFileSync(safe, data);
}

/**
 * Safe open + fstat + read combination (avoids TOCTOU).
 * Returns the file content as a string, or throws on size-exceeded / not-found.
 */
export function safeReadFileAtomic(
  userPath: string,
  allowedBase: string,
  maxSize: number,
): { content: string; size: number } {
  const resolvedBase = resolve(allowedBase);
  const safe = resolve(userPath);
  const prefix = resolvedBase.endsWith(sep) ? resolvedBase : `${resolvedBase}${sep}`;
  if (safe !== resolvedBase && !safe.startsWith(prefix)) {
    throw new Error(`Path "${safe}" escapes allowed base "${resolvedBase}"`);
  }

  const fd = openSync(safe, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (stat.size > maxSize) {
      throw Object.assign(new Error('File too large'), { code: 'FILE_TOO_LARGE', size: stat.size });
    }
    const buffer = Buffer.alloc(stat.size);
    const bytesRead = readSync(fd, buffer, 0, stat.size, 0);
    return { content: buffer.subarray(0, bytesRead).toString('utf-8'), size: stat.size };
  } finally {
    closeSync(fd);
  }
}
