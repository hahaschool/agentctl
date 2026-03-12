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
