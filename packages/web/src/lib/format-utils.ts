/**
 * Shared formatting utilities used across all pages.
 */

/** Relative time string like "5m ago", "2h ago", "3d ago". */
export function timeAgo(dateStr: string): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/** Format a date string as "Mar 3, 2026". */
export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Format a date string as "Mar 3, 2026, 2:15 PM". */
export function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Format a time string as "2:15:30 PM". */
export function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Duration between two timestamps, e.g. "2h 15m" or "45s". */
export function formatDuration(startStr: string, endStr?: string | null): string {
  const start = new Date(startStr).getTime();
  const end = endStr ? new Date(endStr).getTime() : Date.now();
  const diffMs = Math.max(0, end - start);

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainSec}s`;

  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  return `${hours}h ${remainMin}m`;
}

/**
 * Shorten a filesystem path for display.
 * - Replaces home directory prefixes with ~/
 * - Truncates long paths to last 2–3 segments
 */
export function shortenPath(fullPath: string | null | undefined): string {
  if (!fullPath) return '';
  let shortened = fullPath;

  // Replace known home prefixes with ~/
  const homePrefixes = ['/Users/', '/home/', '/root'];
  for (const prefix of homePrefixes) {
    if (shortened.startsWith(prefix)) {
      if (prefix === '/root') {
        shortened = `~${shortened.slice('/root'.length)}`;
      } else {
        const afterPrefix = shortened.slice(prefix.length);
        const slashIdx = afterPrefix.indexOf('/');
        if (slashIdx >= 0) {
          shortened = `~${afterPrefix.slice(slashIdx)}`;
        } else {
          shortened = '~';
        }
      }
      break;
    }
  }

  const segments = shortened.split('/').filter(Boolean);
  if (segments.length <= 3) return shortened;

  const startsWithTilde = shortened.startsWith('~');
  const lastTwo = segments.slice(-2).join('/');
  return startsWithTilde ? `~/.../${lastTwo}` : `.../${lastTwo}`;
}

/** Truncate a string with ellipsis if it exceeds maxLen. */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return `${str.slice(0, maxLen - 1)}\u2026`;
}

/** Duration from milliseconds, e.g. "2h 15m" or "45s". */
export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || ms <= 0) return '-';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainSec}s`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  return `${hours}h ${remainMin}m`;
}

/** Format a cost value as "$1.23". */
export function formatCost(value: number | null | undefined): string {
  if (value == null) return '$0.00';
  return `$${value.toFixed(2)}`;
}

/** Format a number with locale-appropriate thousands separators. */
export function formatNumber(n: number | string | null | undefined): string {
  if (n == null) return '0';
  const num = typeof n === 'string' ? Number(n) : n;
  if (Number.isNaN(num)) return String(n);
  return num.toLocaleString('en-US');
}

/** Format a byte count as "1.2 KB", "3.5 MB", etc. */
export function formatFileSize(bytes?: number | null): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

const STALE_HEARTBEAT_MS = 60_000;

/** Check if a heartbeat timestamp is stale (>60 s ago). */
export function isStaleHeartbeat(dateStr: string): boolean {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  return diffMs > STALE_HEARTBEAT_MS;
}

/** Escape a value for CSV output — wraps in quotes if it contains commas, quotes, or newlines. */
export function escapeCsvValue(value: string | number | null | undefined): string {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Recency Tailwind class for activity dots.
 * Returns a `bg-*` class instead of a hex color string.
 */
export function recencyColorClass(dateStr: string): string {
  if (!dateStr) return 'bg-muted-foreground';
  const diff = Date.now() - new Date(dateStr).getTime();
  const oneHour = 60 * 60 * 1000;
  const oneDay = 24 * oneHour;
  if (diff < oneHour) return 'bg-green-500';
  if (diff < oneDay) return 'bg-yellow-500';
  return 'bg-muted-foreground';
}
