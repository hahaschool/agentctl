import type { Dirent, Stats } from 'node:fs';
import {
  chmodSync,
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
  writeSync,
} from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { isAbsolute, normalize, relative, resolve, sep } from 'node:path';

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
  return resolveWithinBase(userPath, allowedBase);
}

export function findDeniedPathSegment(
  userPath: string,
  deniedSegments: readonly string[] = DEFAULT_DENIED_PATH_SEGMENTS,
): string | null {
  const segments = resolve(normalize(userPath)).split(/[\\/]+/);
  for (const segment of segments) {
    if (deniedSegments.includes(segment)) {
      return segment;
    }
  }
  return null;
}

function resolveWithinBase(candidatePath: string, allowedBase: string): string {
  if (candidatePath.includes('\u0000') || allowedBase.includes('\u0000')) {
    throw new Error('Path contains null bytes');
  }

  const resolvedBase = resolve(normalize(allowedBase));
  const resolvedPath = resolve(normalize(candidatePath));
  const rel = relative(resolvedBase, resolvedPath);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    return resolvedPath;
  }

  throw new Error(`Resolved path "${resolvedPath}" is outside the allowed base path`);
}

// ---------------------------------------------------------------------------
// Safe fs wrappers — sanitise + operate atomically so CodeQL sees that
// user-controlled paths never reach raw fs sinks directly.
//
// Keep an explicit relative-path boundary check adjacent to each sink call;
// this matches CodeQL's recognised path-sanitiser shape while preserving
// sanitizePath() as the canonical resolver.
// ---------------------------------------------------------------------------

/**
 * Safe wrapper around `existsSync`.  Sanitises `userPath` relative to
 * `allowedBase` and returns the resolved path only if it exists.
 */
export function safeExistsSync(userPath: string, allowedBase: string): string | null {
  const safe = sanitizePath(userPath, allowedBase);
  const resolvedBase = resolve(normalize(allowedBase));
  const relativePath = relative(resolvedBase, safe);
  if (relativePath.startsWith(`..${sep}`) || relativePath === '..') {
    throw new Error(`Resolved path "${safe}" is outside the allowed base path`);
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
  const safe = sanitizePath(userPath, allowedBase);
  const resolvedBase = resolve(normalize(allowedBase));
  const relativePath = relative(resolvedBase, safe);
  if (relativePath.startsWith(`..${sep}`) || relativePath === '..') {
    throw new Error(`Resolved path "${safe}" is outside the allowed base path`);
  }
  return readFileSync(safe, encoding);
}

/**
 * Safe wrapper around async `readFile`.
 * Sanitises + validates the path before reading.
 */
export async function safeReadFile(
  userPath: string,
  allowedBase: string,
  encoding: BufferEncoding = 'utf-8',
): Promise<string> {
  const safe = sanitizePath(userPath, allowedBase);
  const resolvedBase = resolve(normalize(allowedBase));
  const relativePath = relative(resolvedBase, safe);
  if (relativePath.startsWith(`..${sep}`) || relativePath === '..') {
    throw new Error(`Resolved path "${safe}" is outside the allowed base path`);
  }
  return readFile(safe, encoding);
}

/**
 * Safe wrapper around `writeFileSync`.
 * Sanitises + validates the path before writing.
 */
export function safeWriteFileSync(userPath: string, allowedBase: string, data: string): void {
  const safe = sanitizePath(userPath, allowedBase);
  const resolvedBase = resolve(normalize(allowedBase));
  const relativePath = relative(resolvedBase, safe);
  if (relativePath.startsWith(`..${sep}`) || relativePath === '..') {
    throw new Error(`Resolved path "${safe}" is outside the allowed base path`);
  }

  // Open the final path without following symlinks so a validated path cannot
  // be redirected outside the allowed base between the check and the write.
  const fd = openSync(
    safe,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | fsConstants.O_NOFOLLOW,
    0o600,
  );
  try {
    const buffer = Buffer.from(data, 'utf-8');
    let offset = 0;
    while (offset < buffer.length) {
      offset += writeSync(fd, buffer, offset, buffer.length - offset);
    }
  } finally {
    closeSync(fd);
  }
}

/**
 * Safe wrapper around `mkdirSync`.
 * Sanitises + validates the path before creating directories.
 */
export function safeMkdirSync(
  userPath: string,
  allowedBase: string,
  options?: Parameters<typeof mkdirSync>[1],
): string {
  const safe = sanitizePath(userPath, allowedBase);
  const resolvedBase = resolve(normalize(allowedBase));
  const relativePath = relative(resolvedBase, safe);
  if (relativePath.startsWith(`..${sep}`) || relativePath === '..') {
    throw new Error(`Resolved path "${safe}" is outside the allowed base path`);
  }
  mkdirSync(safe, options ?? { recursive: true });
  return safe;
}

/**
 * Safe wrapper around `chmodSync`.
 * Sanitises + validates the path before changing mode bits.
 */
export function safeChmodSync(
  userPath: string,
  allowedBase: string,
  mode: Parameters<typeof chmodSync>[1],
): string {
  const safe = sanitizePath(userPath, allowedBase);
  const resolvedBase = resolve(normalize(allowedBase));
  const relativePath = relative(resolvedBase, safe);
  if (relativePath.startsWith(`..${sep}`) || relativePath === '..') {
    throw new Error(`Resolved path "${safe}" is outside the allowed base path`);
  }
  chmodSync(safe, mode);
  return safe;
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
  const resolvedBase = resolve(normalize(allowedBase));
  const relativePath = relative(resolvedBase, safe);
  if (relativePath.startsWith(`..${sep}`) || relativePath === '..') {
    throw new Error(`Resolved path "${safe}" is outside the allowed base path`);
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

export function safeStatSync(userPath: string, allowedBase: string): Stats {
  const safe = sanitizePath(userPath, allowedBase);
  const resolvedBase = resolve(normalize(allowedBase));
  const relativePath = relative(resolvedBase, safe);
  if (relativePath.startsWith(`..${sep}`) || relativePath === '..') {
    throw new Error(`Resolved path "${safe}" is outside the allowed base path`);
  }
  return statSync(safe);
}

export function safeReaddirSync(userPath: string, allowedBase: string): Dirent[] {
  const safe = sanitizePath(userPath, allowedBase);
  const resolvedBase = resolve(normalize(allowedBase));
  const relativePath = relative(resolvedBase, safe);
  if (relativePath.startsWith(`..${sep}`) || relativePath === '..') {
    throw new Error(`Resolved path "${safe}" is outside the allowed base path`);
  }
  return readdirSync(safe, { withFileTypes: true }) as Dirent[];
}

export async function safeReaddir(userPath: string, allowedBase: string): Promise<Dirent[]> {
  const safe = sanitizePath(userPath, allowedBase);
  const resolvedBase = resolve(normalize(allowedBase));
  const relativePath = relative(resolvedBase, safe);
  if (relativePath.startsWith(`..${sep}`) || relativePath === '..') {
    throw new Error(`Resolved path "${safe}" is outside the allowed base path`);
  }
  return readdir(safe, { withFileTypes: true });
}
