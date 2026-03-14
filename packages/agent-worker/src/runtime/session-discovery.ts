// ---------------------------------------------------------------------------
// Session Discovery — scans the local Claude Code session filesystem.
//
// Extracted from CliSessionManager to keep session management and
// filesystem discovery as separate concerns.
// ---------------------------------------------------------------------------

import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { DiscoveredSession } from '@agentctl/shared';

export type { DiscoveredSession };

type DiscoveryLogger = {
  debug: (obj: Record<string, unknown>, msg: string) => void;
};

type JsonlSessionMetadata = {
  summary: string;
  messageCount: number;
  lastActivity: string;
  branch: string | null;
};

/** Legacy sessions-index.json entry (Record<sessionId, entry> format). */
type SessionIndexEntry = {
  summary?: string;
  title?: string;
  messageCount?: number;
  lastActiveAt?: string;
  updatedAt?: string;
  gitBranch?: string;
};

/** v1 sessions-index.json entry (entries array format). */
type SessionIndexEntryV1 = {
  sessionId: string;
  fullPath?: string;
  fileMtime?: number;
  firstPrompt?: string;
  summary?: string;
  messageCount?: number;
  created?: string;
  modified?: string;
  gitBranch?: string;
  projectPath?: string;
  isSidechain?: boolean;
};

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

function isNonNullObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSessionIndexEntryV1(value: unknown): value is SessionIndexEntryV1 {
  return isNonNullObject(value) && 'sessionId' in value && typeof value.sessionId === 'string';
}

function extractTextContent(content: unknown): string | null {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === 'string') {
      parts.push(block);
      continue;
    }

    if (!isNonNullObject(block)) {
      continue;
    }

    if (typeof block.text === 'string') {
      parts.push(block.text);
      continue;
    }

    if (typeof block.content === 'string') {
      parts.push(block.content);
    }
  }

  return parts.length > 0 ? parts.join('\n') : null;
}

function normalizeSummary(text: string | null | undefined): string {
  if (!text) {
    return '';
  }

  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }

  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Discover existing Claude Code sessions from the local filesystem.
 *
 * Claude Code stores sessions under `~/.claude/projects/` in two patterns:
 *
 * 1. **With sessions-index.json** — contains `{ version, entries: [...], originalPath }`
 *    where each entry has sessionId, summary, messageCount, etc.
 *    These may be directly in a project dir or nested one level deeper
 *    (e.g. under a `-` parent directory).
 *
 * 2. **Without sessions-index.json** — only `.jsonl` files exist.
 *    We stream-parse the JSONL to recover summary, branch, message count,
 *    and last activity.
 */
export function discoverLocalSessions(
  projectPathFilter?: string,
  logger?: DiscoveryLogger,
): DiscoveredSession[] {
  const claudeDir = join(homedir(), '.claude', 'projects');
  if (!existsSync(claudeDir)) {
    return [];
  }

  const discovered: DiscoveredSession[] = [];

  try {
    const topDirs = readdirSync(claudeDir, { withFileTypes: true });

    for (const dir of topDirs) {
      if (!dir.isDirectory()) {
        continue;
      }

      const dirPath = join(claudeDir, dir.name);

      // Try to parse sessions-index.json at this level
      parseSessionIndex(dirPath, dir.name, projectPathFilter, discovered, logger);

      // Also recurse one level deeper — Claude Code nests project dirs
      // under a `-` parent directory (which represents `/`)
      try {
        const subDirs = readdirSync(dirPath, { withFileTypes: true });
        for (const sub of subDirs) {
          if (!sub.isDirectory()) {
            continue;
          }
          parseSessionIndex(
            join(dirPath, sub.name),
            sub.name,
            projectPathFilter,
            discovered,
            logger,
          );
        }
      } catch (err) {
        // Intentional: subdirectory may be unreadable due to permissions;
        // skip gracefully so remaining directories are still discovered.
        logger?.debug(
          { error: err instanceof Error ? err.message : String(err), path: dirPath },
          'Skipped unreadable subdirectory during session discovery',
        );
      }

      // For dirs without sessions-index.json, discover from JSONL files
      if (!existsSync(join(dirPath, 'sessions-index.json'))) {
        discoverFromJsonlFiles(dirPath, dir.name, projectPathFilter, discovered, logger);
      }
    }
  } catch (err) {
    // Intentional: the ~/.claude/projects directory itself may not exist
    // or may be unreadable; return empty results rather than crashing.
    logger?.debug(
      { error: err instanceof Error ? err.message : String(err), path: claudeDir },
      'Failed to read Claude projects directory during session discovery',
    );
  }

  // Deduplicate by sessionId (subdirectory nesting may cause duplicates)
  const seen = new Set<string>();
  const deduped = discovered.filter((s) => {
    if (seen.has(s.sessionId)) return false;
    seen.add(s.sessionId);
    return true;
  });

  // Sort by most recent activity
  deduped.sort((a, b) => {
    const dateA = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
    const dateB = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
    return dateB - dateA;
  });

  return deduped;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse a sessions-index.json file and add discovered sessions.
 *
 * Handles both:
 *   - v1 format: `{ version: 1, entries: [...], originalPath }`
 *   - Legacy format: `Record<string, SessionIndexEntry>`
 */
function parseSessionIndex(
  dirPath: string,
  dirName: string,
  projectPathFilter: string | undefined,
  out: DiscoveredSession[],
  logger?: DiscoveryLogger,
): void {
  const indexPath = join(dirPath, 'sessions-index.json');
  if (!existsSync(indexPath)) {
    return;
  }

  try {
    const raw = readFileSync(indexPath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);

    if (!isNonNullObject(parsed)) {
      return;
    }

    // v1 format: { version, entries: [...], originalPath }
    if ('entries' in parsed && Array.isArray(parsed.entries)) {
      const originalPath = 'originalPath' in parsed ? parsed.originalPath : undefined;
      const projectPath =
        (typeof originalPath === 'string' ? originalPath : null) ?? decodeProjectPath(dirName);

      if (projectPathFilter && !projectPath.includes(projectPathFilter)) {
        return;
      }

      for (const rawEntry of parsed.entries) {
        if (!isSessionIndexEntryV1(rawEntry)) {
          continue;
        }
        out.push({
          sessionId: rawEntry.sessionId,
          projectPath,
          summary: rawEntry.summary ?? rawEntry.firstPrompt ?? '',
          messageCount: rawEntry.messageCount ?? 0,
          lastActivity: rawEntry.modified ?? rawEntry.created ?? '',
          branch: rawEntry.gitBranch ?? null,
        });
      }
      return;
    }

    // Legacy format: Record<string, SessionIndexEntry>
    const decodedPath = decodeProjectPath(dirName);
    if (projectPathFilter && !decodedPath.includes(projectPathFilter)) {
      return;
    }

    for (const [sessionId, entry] of Object.entries(parsed)) {
      if (!isNonNullObject(entry)) {
        continue;
      }
      const e: SessionIndexEntry = {
        summary:
          'summary' in entry && typeof entry.summary === 'string' ? entry.summary : undefined,
        title: 'title' in entry && typeof entry.title === 'string' ? entry.title : undefined,
        messageCount:
          'messageCount' in entry && typeof entry.messageCount === 'number'
            ? entry.messageCount
            : undefined,
        lastActiveAt:
          'lastActiveAt' in entry && typeof entry.lastActiveAt === 'string'
            ? entry.lastActiveAt
            : undefined,
        updatedAt:
          'updatedAt' in entry && typeof entry.updatedAt === 'string' ? entry.updatedAt : undefined,
        gitBranch:
          'gitBranch' in entry && typeof entry.gitBranch === 'string' ? entry.gitBranch : undefined,
      };
      out.push({
        sessionId,
        projectPath: decodedPath,
        summary: e.summary ?? e.title ?? '',
        messageCount: e.messageCount ?? 0,
        lastActivity: e.lastActiveAt ?? e.updatedAt ?? '',
        branch: e.gitBranch ?? null,
      });
    }
  } catch (err) {
    // Intentional: corrupted or malformed sessions-index.json should not
    // prevent discovery of other valid session data.
    logger?.debug(
      { error: err instanceof Error ? err.message : String(err), path: indexPath },
      'Skipped corrupted session index file',
    );
  }
}

/**
 * Discover sessions from raw JSONL files when no sessions-index.json exists.
 * Extracts enough metadata for discover filters to treat them like indexed sessions.
 */
function discoverFromJsonlFiles(
  dirPath: string,
  dirName: string,
  projectPathFilter: string | undefined,
  out: DiscoveredSession[],
  logger?: DiscoveryLogger,
): void {
  const decodedPath = decodeProjectPath(dirName);
  if (projectPathFilter && !decodedPath.includes(projectPathFilter)) {
    return;
  }

  try {
    const files = readdirSync(dirPath, { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.jsonl')) {
        continue;
      }
      const sessionId = file.name.replace(/\.jsonl$/, '');
      // Validate it looks like a UUID
      if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(sessionId)) {
        continue;
      }

      const filePath = join(dirPath, file.name);
      const stats = statSync(join(dirPath, file.name));
      const metadata = extractJsonlSessionMetadata(filePath, stats.mtime.toISOString(), logger);

      out.push({
        sessionId,
        projectPath: decodedPath,
        summary: metadata.summary,
        messageCount: metadata.messageCount,
        lastActivity: metadata.lastActivity,
        branch: metadata.branch,
      });
    }
  } catch (err) {
    // Intentional: directory may be unreadable; skip gracefully so
    // other project directories can still be discovered.
    logger?.debug(
      { error: err instanceof Error ? err.message : String(err), path: dirPath },
      'Skipped unreadable directory during JSONL session discovery',
    );
  }
}

/**
 * Max bytes to read from each JSONL file during discovery.
 * 128 KB is enough to capture the first few messages (summary, branch)
 * without blocking the event loop on multi-hundred-MB files.
 */
const JSONL_HEAD_BYTES = 128 * 1024;

function extractJsonlSessionMetadata(
  filePath: string,
  fallbackLastActivity: string,
  logger?: DiscoveryLogger,
): JsonlSessionMetadata {
  const state: JsonlSessionMetadata = {
    summary: '',
    messageCount: 0,
    lastActivity: fallbackLastActivity,
    branch: null,
  };

  const buffer = Buffer.allocUnsafe(64 * 1024);
  let fd: number | null = null;
  let leftover = '';
  let totalBytesRead = 0;

  try {
    fd = openSync(filePath, 'r');

    while (totalBytesRead < JSONL_HEAD_BYTES) {
      const toRead = Math.min(buffer.length, JSONL_HEAD_BYTES - totalBytesRead);
      const bytesRead = readSync(fd, buffer, 0, toRead, null);
      if (bytesRead === 0) {
        break;
      }

      totalBytesRead += bytesRead;
      leftover += buffer.toString('utf8', 0, bytesRead);
      const lines = leftover.split('\n');
      leftover = lines.pop() ?? '';

      for (const line of lines) {
        updateMetadataFromJsonlLine(line, state);
      }
    }

    if (leftover.trim()) {
      updateMetadataFromJsonlLine(leftover, state);
    }
  } catch (err) {
    logger?.debug(
      { error: err instanceof Error ? err.message : String(err), path: filePath },
      'Failed to parse JSONL session metadata during discovery',
    );
  } finally {
    if (fd !== null) {
      closeSync(fd);
    }
  }

  if (!state.summary && state.messageCount > 0) {
    state.summary = 'No prompt';
  }

  return state;
}

function updateMetadataFromJsonlLine(line: string, state: JsonlSessionMetadata): void {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return;
  }

  if (!isNonNullObject(parsed)) {
    return;
  }

  if (!state.branch && typeof parsed.gitBranch === 'string' && parsed.gitBranch.trim()) {
    state.branch = parsed.gitBranch;
  }

  if (typeof parsed.timestamp === 'string' && parsed.timestamp > state.lastActivity) {
    state.lastActivity = parsed.timestamp;
  }

  const message = isNonNullObject(parsed.message) ? parsed.message : null;
  const role = typeof message?.role === 'string' ? message.role : null;

  if (role === 'user' || parsed.type === 'user') {
    state.messageCount++;
    if (!state.summary) {
      state.summary = normalizeSummary(extractTextContent(message?.content));
    }
    return;
  }

  if (role === 'assistant') {
    state.messageCount++;
  }
}

/**
 * Decode a Claude Code project directory name back to its filesystem path.
 *
 * Claude Code encodes project paths by replacing `/` with `-` and
 * prepending with `-`. E.g., `/Users/foo/project` → `-Users-foo-project`.
 *
 * The naive approach (replace all `-` with `/`) breaks for paths that contain
 * hyphens, e.g. `/Users/foo/my-project` encodes to `-Users-foo-my-project`
 * but naive decode gives `/Users/foo/my/project` (wrong).
 *
 * Instead we walk the encoded segments left-to-right. At each step we try
 * two candidates for the next path component:
 *   1. path + "/" + segment   — treat the `-` as a directory separator
 *   2. path + "-" + segment   — treat the `-` as a literal hyphen (merge)
 *
 * We prefer the slash interpretation unless only the hyphen-merged prefix
 * exists on disk, falling back to the slash interpretation when neither exists.
 */
export function decodeProjectPath(encoded: string): string {
  // Normalise: strip the leading '-' that represents the root '/'
  const withoutLeader = encoded.startsWith('-') ? encoded.slice(1) : encoded;
  const segments = withoutLeader.split('-');

  // Start at filesystem root (leading '-' represents '/')
  let path = encoded.startsWith('-') ? '/' : '';

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg === '') {
      // Skip empty segments that arise from the leading '-' strip
      continue;
    }

    if (path === '' || path === '/') {
      // First real segment — only one option: append directly
      path = path === '/' ? `/${seg}` : seg;
    } else {
      // Two candidates: treat the dash as a separator vs. as a literal hyphen
      const slashCandidate = `${path}/${seg}`;
      const hyphenCandidate = `${path}-${seg}`;

      if (existsSync(slashCandidate)) {
        path = slashCandidate;
      } else if (existsSync(hyphenCandidate)) {
        path = hyphenCandidate;
      } else {
        // Neither exists yet; default to slash
        path = slashCandidate;
      }
    }
  }

  return path;
}
