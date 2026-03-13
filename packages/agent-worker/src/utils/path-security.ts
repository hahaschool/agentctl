import {
  closeSync,
  existsSync,
  constants as fsConstants,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
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
// ---------------------------------------------------------------------------

/**
 * Inline path prefix assertion that CodeQL recognises as a sanitiser barrier.
 * Throws if `resolvedPath` is not within `allowedBase`.
 */
function assertWithinBase(resolvedPath: string, allowedBase: string): void {
  const base = resolve(allowedBase);
  const prefix = base.endsWith(sep) ? base : `${base}${sep}`;
  if (resolvedPath !== base && !resolvedPath.startsWith(prefix)) {
    throw new Error(`Path "${resolvedPath}" escapes allowed base "${base}"`);
  }
}

/**
 * Safe wrapper around `existsSync`.  Sanitises `userPath` relative to
 * `allowedBase` and returns the resolved path only if it exists.
 */
export function safeExistsSync(userPath: string, allowedBase: string): string | null {
  const safe = sanitizePath(userPath, allowedBase);
  assertWithinBase(safe, allowedBase);
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
  const safe = sanitizePath(userPath, allowedBase);
  assertWithinBase(safe, allowedBase);
  return readFileSync(safe, encoding);
}

/**
 * Safe wrapper around `statSync`.
 * Sanitises + validates the path before stat'ing.
 */
export function safeStatSync(userPath: string, allowedBase: string): ReturnType<typeof statSync> {
  const safe = sanitizePath(userPath, allowedBase);
  assertWithinBase(safe, allowedBase);
  return statSync(safe);
}

/**
 * Safe wrapper around `readdirSync`.
 * Sanitises + validates the path before reading directory entries.
 */
export function safeReaddirSync(
  userPath: string,
  allowedBase: string,
  options?: Parameters<typeof readdirSync>[1],
): ReturnType<typeof readdirSync> {
  const safe = sanitizePath(userPath, allowedBase);
  assertWithinBase(safe, allowedBase);
  return readdirSync(safe, options as never) as unknown as ReturnType<typeof readdirSync>;
}

/**
 * Safe wrapper around `mkdirSync`.
 * Sanitises + validates the path before creating directories.
 */
export function safeMkdirSync(
  userPath: string,
  allowedBase: string,
  options?: Parameters<typeof mkdirSync>[1],
): ReturnType<typeof mkdirSync> {
  const safe = sanitizePath(userPath, allowedBase);
  assertWithinBase(safe, allowedBase);
  return mkdirSync(safe, options);
}

/**
 * Safe wrapper around `writeFileSync`.
 * Sanitises + validates the path before writing.
 */
export function safeWriteFileSync(userPath: string, allowedBase: string, data: string): void {
  const safe = sanitizePath(userPath, allowedBase);
  assertWithinBase(safe, allowedBase);
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
  const safe = sanitizePath(userPath, allowedBase);
  assertWithinBase(safe, allowedBase);

  const fd = openSync(safe, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (stat.isDirectory()) {
      throw Object.assign(new Error('Path is a directory'), { code: 'IS_DIRECTORY' });
    }
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
