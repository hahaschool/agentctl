import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, normalize, resolve } from 'node:path';

// ── Types ───────────────────────────────────────────────────────────

type FsIsolationConfig = {
  workDir: string;
  readOnlyPaths: string[];
  blockedPaths: string[];
  writableDirs: string[];
  maxFileSize: number;
  allowSymlinks: boolean;
};

type PathValidationResult = {
  allowed: boolean;
  reason?: string;
};

type FsIsolation = {
  validatePath: (path: string, operation: 'read' | 'write' | 'delete') => PathValidationResult;
  isPathBlocked: (path: string) => boolean;
  isPathWritable: (path: string) => boolean;
  resolveSecurePath: (basePath: string, userPath: string) => string | null;
  generateMountArgs: () => string[];
  generateSeccompProfile: () => object;
  getBlockedPaths: () => string[];
};

export type { FsIsolation, FsIsolationConfig, PathValidationResult };

// ── Constants ───────────────────────────────────────────────────────

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const HOME = homedir();

// Security-sensitive paths that agents must never access.
// Patterns starting with ~/ are expanded to the user home directory.
// Patterns starting with / are absolute.
const DEFAULT_BLOCKED_PATHS: readonly string[] = [
  `${HOME}/.ssh`,
  `${HOME}/.gnupg`,
  `${HOME}/.aws`,
  `${HOME}/.env`,
  `${HOME}/.config/gcloud`,
  '/etc/shadow',
  '/etc/passwd',
  '/proc',
  '/sys',
];

/**
 * Filename patterns that are always blocked, regardless of directory.
 * These match against the basename of the path.
 */
const BLOCKED_FILENAME_PATTERNS: readonly string[] = [
  'credentials',
  'credentials.json',
  '.env',
  '.git/config',
];

/**
 * Prefix patterns for env-file blocking (e.g. `.env.local`, `.env.production`).
 */
const BLOCKED_FILENAME_PREFIXES: readonly string[] = ['.env.'];

/**
 * Dangerous syscalls that agent containers should never invoke.
 */
const BLOCKED_SYSCALLS: readonly string[] = [
  'mount',
  'umount',
  'umount2',
  'reboot',
  'swapon',
  'swapoff',
  'kexec_load',
  'kexec_file_load',
  'init_module',
  'finit_module',
  'delete_module',
  'pivot_root',
  'syslog',
  'acct',
  'settimeofday',
  'clock_settime',
  'ptrace',
  'personality',
  'unshare',
  'setns',
];

export {
  BLOCKED_FILENAME_PATTERNS,
  BLOCKED_FILENAME_PREFIXES,
  BLOCKED_SYSCALLS,
  DEFAULT_BLOCKED_PATHS,
  DEFAULT_MAX_FILE_SIZE,
};

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Normalize a path: resolve `~`, collapse `..` and `.`, strip trailing slashes.
 */
function normalizePath(p: string): string {
  let expanded = p;
  if (expanded.startsWith('~/')) {
    expanded = `${HOME}${expanded.slice(1)}`;
  } else if (expanded === '~') {
    expanded = HOME;
  }
  return normalize(resolve(expanded));
}

/**
 * Check whether `child` is equal to or nested under `parent` (after normalisation).
 */
function isUnderOrEqual(child: string, parent: string): boolean {
  const normalChild = normalizePath(child);
  const normalParent = normalizePath(parent);

  if (normalChild === normalParent) {
    return true;
  }

  // Ensure parent ends with separator for prefix check
  const parentPrefix = normalParent.endsWith('/') ? normalParent : `${normalParent}/`;
  return normalChild.startsWith(parentPrefix);
}

/**
 * Detect obvious directory-traversal payloads in the raw (un-resolved) input.
 * This catches encoded variants that `path.normalize` would not catch.
 */
function hasTraversalPayload(raw: string): boolean {
  // Normalise common encodings first
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // If decoding fails, continue with the raw string
  }

  // Replace backslashes with forward slashes for Windows-style checks
  const unified = decoded.replace(/\\/g, '/');

  // Look for `..` preceded and/or followed by a separator (or at boundaries)
  if (/(?:^|\/)\.\.(?:\/|$)/.test(unified)) {
    return true;
  }

  return false;
}

/**
 * Check if a basename matches the blocked filename patterns.
 */
function isBlockedFilename(name: string): boolean {
  const lower = name.toLowerCase();

  for (const pattern of BLOCKED_FILENAME_PATTERNS) {
    if (lower === pattern.toLowerCase()) {
      return true;
    }
  }

  for (const prefix of BLOCKED_FILENAME_PREFIXES) {
    if (lower.startsWith(prefix.toLowerCase())) {
      return true;
    }
  }

  return false;
}

/**
 * Check whether a path contains a segment matching `.git/config`.
 * We need this because `.git/config` is a two-level pattern.
 */
function containsGitConfig(normalizedPath: string): boolean {
  return normalizedPath.includes('/.git/config') || normalizedPath.endsWith('/.git/config');
}

// ── Factory ─────────────────────────────────────────────────────────

function createFsIsolation(config: Partial<FsIsolationConfig> & { workDir: string }): FsIsolation {
  const resolvedConfig: FsIsolationConfig = {
    workDir: normalizePath(config.workDir),
    readOnlyPaths: (config.readOnlyPaths ?? []).map(normalizePath),
    blockedPaths: [
      ...DEFAULT_BLOCKED_PATHS.map(normalizePath),
      ...(config.blockedPaths ?? []).map(normalizePath),
    ],
    writableDirs: config.writableDirs ?? [],
    maxFileSize: config.maxFileSize ?? DEFAULT_MAX_FILE_SIZE,
    allowSymlinks: config.allowSymlinks ?? false,
  };

  /**
   * Check if a normalised path matches any blocked path.
   */
  function isPathBlocked(rawPath: string): boolean {
    if (!rawPath || rawPath.trim() === '') {
      return true;
    }

    const normalised = normalizePath(rawPath);

    // Check blocked directories / files
    for (const blocked of resolvedConfig.blockedPaths) {
      if (isUnderOrEqual(normalised, blocked)) {
        return true;
      }
    }

    // Check blocked filename patterns against every segment
    const name = basename(normalised);
    if (isBlockedFilename(name)) {
      return true;
    }

    // Check the .git/config two-level pattern
    if (containsGitConfig(normalised)) {
      return true;
    }

    return false;
  }

  /**
   * Check if a path is within one of the writable directories.
   */
  function isPathWritable(rawPath: string): boolean {
    if (!rawPath || rawPath.trim() === '') {
      return false;
    }

    const normalised = normalizePath(rawPath);

    // If no writable dirs are configured, the entire workDir is writable
    if (resolvedConfig.writableDirs.length === 0) {
      return isUnderOrEqual(normalised, resolvedConfig.workDir);
    }

    // Check each writable dir (resolved relative to workDir)
    for (const dir of resolvedConfig.writableDirs) {
      const absDir = normalizePath(resolve(resolvedConfig.workDir, dir));
      if (isUnderOrEqual(normalised, absDir)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Validate whether an operation on a given path is allowed.
   */
  function validatePath(
    rawPath: string,
    operation: 'read' | 'write' | 'delete',
  ): PathValidationResult {
    if (!rawPath || rawPath.trim() === '') {
      return { allowed: false, reason: 'Empty path is not allowed' };
    }

    // Traversal check on the raw input
    if (hasTraversalPayload(rawPath)) {
      return { allowed: false, reason: 'Path traversal detected' };
    }

    const normalised = normalizePath(rawPath);

    // Blocked path check
    if (isPathBlocked(normalised)) {
      return { allowed: false, reason: `Path is blocked: ${normalised}` };
    }

    // Symlink check
    if (!resolvedConfig.allowSymlinks) {
      try {
        const real = realpathSync(normalised);
        // Also resolve the workDir through the real filesystem so that
        // platform-level symlinks (e.g. /var -> /private/var on macOS)
        // do not cause false negatives.
        let realWorkDir: string;
        try {
          realWorkDir = realpathSync(resolvedConfig.workDir);
        } catch {
          realWorkDir = resolvedConfig.workDir;
        }

        if (real !== normalised) {
          // The resolved path differs — it is (or contains) a symlink.
          // Verify the real path is still within allowed boundaries.
          if (isPathBlocked(real)) {
            return { allowed: false, reason: 'Symlink target is blocked' };
          }
          if (!isUnderOrEqual(real, realWorkDir)) {
            // For read operations, also check readOnlyPaths
            if (operation === 'read') {
              const inReadOnly = resolvedConfig.readOnlyPaths.some((ro) => {
                let realRo: string;
                try {
                  realRo = realpathSync(ro);
                } catch {
                  realRo = ro;
                }
                return isUnderOrEqual(real, realRo);
              });
              if (!inReadOnly) {
                return { allowed: false, reason: 'Symlink escapes allowed boundaries' };
              }
            } else {
              return { allowed: false, reason: 'Symlink escapes allowed boundaries' };
            }
          }
        }
      } catch {
        // File doesn't exist yet — that's OK for write operations
        if (operation === 'read') {
          // For read, the file should exist; this is not necessarily an
          // error from a permissions perspective, but we let it pass.
        }
      }
    }

    // Operation-specific checks
    switch (operation) {
      case 'read': {
        // Read is allowed within workDir or readOnlyPaths
        const inWorkDir = isUnderOrEqual(normalised, resolvedConfig.workDir);
        const inReadOnly = resolvedConfig.readOnlyPaths.some((ro) =>
          isUnderOrEqual(normalised, ro),
        );

        if (!inWorkDir && !inReadOnly) {
          return { allowed: false, reason: 'Path is outside readable boundaries' };
        }

        return { allowed: true };
      }

      case 'write':
      case 'delete': {
        // Must be inside workDir
        if (!isUnderOrEqual(normalised, resolvedConfig.workDir)) {
          return { allowed: false, reason: 'Path is outside the working directory' };
        }

        // Must be inside a writable directory (if configured)
        if (!isPathWritable(normalised)) {
          return { allowed: false, reason: 'Path is not in a writable directory' };
        }

        return { allowed: true };
      }

      default: {
        return { allowed: false, reason: `Unknown operation: ${String(operation)}` };
      }
    }
  }

  /**
   * Resolve a user-provided path against a base path, preventing traversal.
   * Returns the resolved absolute path, or null if traversal is detected.
   */
  function resolveSecurePath(basePath: string, userPath: string): string | null {
    if (!userPath || userPath.trim() === '') {
      return null;
    }

    // Check for traversal in the raw user input
    if (hasTraversalPayload(userPath)) {
      return null;
    }

    const normalBase = normalizePath(basePath);
    const resolved = normalize(resolve(normalBase, userPath));

    // The resolved path must be under or equal to the base path
    if (!isUnderOrEqual(resolved, normalBase)) {
      return null;
    }

    return resolved;
  }

  /**
   * Generate Docker `-v` mount arguments with `:ro` / `:rw` flags.
   */
  function generateMountArgs(): string[] {
    const args: string[] = [];

    // Mount workDir as rw
    args.push(`-v=${resolvedConfig.workDir}:${resolvedConfig.workDir}:rw`);

    // Mount read-only paths
    for (const roPath of resolvedConfig.readOnlyPaths) {
      args.push(`-v=${roPath}:${roPath}:ro`);
    }

    return args;
  }

  /**
   * Generate a basic seccomp profile blocking dangerous syscalls.
   */
  function generateSeccompProfile(): object {
    return {
      defaultAction: 'SCMP_ACT_ALLOW',
      syscalls: [
        {
          names: [...BLOCKED_SYSCALLS],
          action: 'SCMP_ACT_ERRNO',
          errnoRet: 1,
        },
      ],
    };
  }

  /**
   * Return the full list of blocked paths (including defaults).
   */
  function getBlockedPaths(): string[] {
    return [...resolvedConfig.blockedPaths];
  }

  return {
    validatePath,
    isPathBlocked,
    isPathWritable,
    resolveSecurePath,
    generateMountArgs,
    generateSeccompProfile,
    getBlockedPaths,
  };
}

export { createFsIsolation };
