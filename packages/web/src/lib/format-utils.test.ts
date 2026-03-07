import { describe, expect, it } from 'vitest';

import {
  downloadCsv,
  escapeCsvValue,
  formatCost,
  formatDuration,
  formatDurationMs,
  formatFileSize,
  formatNumber,
  isStaleHeartbeat,
  recencyColorClass,
  shortenPath,
  timeAgo,
  triggerDownload,
  truncate,
} from './format-utils';

// ---------------------------------------------------------------------------
// timeAgo
// ---------------------------------------------------------------------------

describe('timeAgo', () => {
  it('returns empty string for falsy input', () => {
    expect(timeAgo('')).toBe('');
  });

  it('returns "just now" for < 1 minute', () => {
    const now = new Date().toISOString();
    expect(timeAgo(now)).toBe('just now');
  });

  it('returns minutes for < 60 min', () => {
    const date = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(timeAgo(date)).toBe('5m ago');
  });

  it('returns hours for < 24h', () => {
    const date = new Date(Date.now() - 3 * 3600_000).toISOString();
    expect(timeAgo(date)).toBe('3h ago');
  });

  it('returns days for < 30d', () => {
    const date = new Date(Date.now() - 7 * 86_400_000).toISOString();
    expect(timeAgo(date)).toBe('7d ago');
  });

  it('returns months for >= 30d', () => {
    const date = new Date(Date.now() - 90 * 86_400_000).toISOString();
    expect(timeAgo(date)).toBe('3mo ago');
  });
});

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

describe('formatDuration', () => {
  it('returns seconds for short durations', () => {
    expect(formatDuration('2026-01-01T00:00:00Z', '2026-01-01T00:00:45Z')).toBe('45s');
  });

  it('returns minutes and seconds', () => {
    expect(formatDuration('2026-01-01T00:00:00Z', '2026-01-01T00:05:30Z')).toBe('5m 30s');
  });

  it('returns hours and minutes', () => {
    expect(formatDuration('2026-01-01T00:00:00Z', '2026-01-01T02:15:00Z')).toBe('2h 15m');
  });

  it('returns 0s for zero diff', () => {
    expect(formatDuration('2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')).toBe('0s');
  });

  it('returns 0s for negative diff (end before start)', () => {
    expect(formatDuration('2026-01-01T00:01:00Z', '2026-01-01T00:00:00Z')).toBe('0s');
  });
});

// ---------------------------------------------------------------------------
// formatDurationMs
// ---------------------------------------------------------------------------

describe('formatDurationMs', () => {
  it('returns "-" for null', () => {
    expect(formatDurationMs(null)).toBe('-');
  });

  it('returns "-" for undefined', () => {
    expect(formatDurationMs(undefined)).toBe('-');
  });

  it('returns "-" for zero', () => {
    expect(formatDurationMs(0)).toBe('-');
  });

  it('returns "-" for negative', () => {
    expect(formatDurationMs(-1000)).toBe('-');
  });

  it('returns seconds', () => {
    expect(formatDurationMs(45_000)).toBe('45s');
  });

  it('returns minutes and seconds', () => {
    expect(formatDurationMs(330_000)).toBe('5m 30s');
  });

  it('returns hours and minutes', () => {
    expect(formatDurationMs(8_100_000)).toBe('2h 15m');
  });
});

// ---------------------------------------------------------------------------
// shortenPath
// ---------------------------------------------------------------------------

describe('shortenPath', () => {
  it('returns empty string for null', () => {
    expect(shortenPath(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(shortenPath(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(shortenPath('')).toBe('');
  });

  it('replaces /Users/user/ with ~/', () => {
    expect(shortenPath('/Users/jane/projects/foo')).toBe('~/projects/foo');
  });

  it('replaces /home/user/ with ~/', () => {
    expect(shortenPath('/home/deploy/apps/myapp')).toBe('~/apps/myapp');
  });

  it('replaces /root with ~', () => {
    expect(shortenPath('/root/projects/foo')).toBe('~/projects/foo');
  });

  it('returns ~ for bare /Users/user (no trailing slash)', () => {
    expect(shortenPath('/Users/jane')).toBe('~');
  });

  it('truncates long paths to last 2 segments', () => {
    expect(shortenPath('/Users/jane/a/b/c/d')).toBe('~/.../' + 'c/d');
  });

  it('does not truncate paths with 3 or fewer segments', () => {
    expect(shortenPath('/opt/app/data')).toBe('/opt/app/data');
  });

  it('truncates non-home long paths', () => {
    expect(shortenPath('/var/lib/some/deep/path/here')).toBe('.../path/here');
  });
});

// ---------------------------------------------------------------------------
// truncate
// ---------------------------------------------------------------------------

describe('truncate', () => {
  it('returns string unchanged if within limit', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('returns string unchanged at exactly maxLen', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('truncates with ellipsis when over limit', () => {
    const result = truncate('hello world', 6);
    expect(result).toBe('hello\u2026');
    expect(result.length).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// formatCost
// ---------------------------------------------------------------------------

describe('formatCost', () => {
  it('returns $0.00 for null', () => {
    expect(formatCost(null)).toBe('$0.00');
  });

  it('returns $0.00 for undefined', () => {
    expect(formatCost(undefined)).toBe('$0.00');
  });

  it('formats normal values', () => {
    expect(formatCost(1.5)).toBe('$1.50');
  });

  it('formats zero', () => {
    expect(formatCost(0)).toBe('$0.00');
  });

  it('formats small values', () => {
    expect(formatCost(0.003)).toBe('$0.00');
  });

  it('formats large values', () => {
    expect(formatCost(1234.567)).toBe('$1234.57');
  });
});

// ---------------------------------------------------------------------------
// formatNumber
// ---------------------------------------------------------------------------

describe('formatNumber', () => {
  it('returns "0" for null', () => {
    expect(formatNumber(null)).toBe('0');
  });

  it('returns "0" for undefined', () => {
    expect(formatNumber(undefined)).toBe('0');
  });

  it('formats a number with commas', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
  });

  it('handles string input', () => {
    expect(formatNumber('42')).toBe('42');
  });

  it('returns original string for NaN input', () => {
    expect(formatNumber('not-a-number')).toBe('not-a-number');
  });
});

// ---------------------------------------------------------------------------
// formatFileSize
// ---------------------------------------------------------------------------

describe('formatFileSize', () => {
  it('returns empty string for null', () => {
    expect(formatFileSize(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(formatFileSize(undefined)).toBe('');
  });

  it('returns bytes for small values', () => {
    expect(formatFileSize(512)).toBe('512 B');
  });

  it('returns KB for medium values', () => {
    expect(formatFileSize(2048)).toBe('2.0 KB');
  });

  it('returns MB for large values', () => {
    expect(formatFileSize(5_242_880)).toBe('5.0 MB');
  });

  it('returns 0 B for zero', () => {
    expect(formatFileSize(0)).toBe('0 B');
  });
});

// ---------------------------------------------------------------------------
// isStaleHeartbeat
// ---------------------------------------------------------------------------

describe('isStaleHeartbeat', () => {
  it('returns false for recent heartbeat (< 60s)', () => {
    const recent = new Date(Date.now() - 30_000).toISOString();
    expect(isStaleHeartbeat(recent)).toBe(false);
  });

  it('returns true for stale heartbeat (> 60s)', () => {
    const stale = new Date(Date.now() - 120_000).toISOString();
    expect(isStaleHeartbeat(stale)).toBe(true);
  });

  it('returns true for very old heartbeat', () => {
    const old = new Date(Date.now() - 3_600_000).toISOString();
    expect(isStaleHeartbeat(old)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// escapeCsvValue
// ---------------------------------------------------------------------------

describe('escapeCsvValue', () => {
  it('returns empty string for null', () => {
    expect(escapeCsvValue(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(escapeCsvValue(undefined)).toBe('');
  });

  it('returns plain string unchanged', () => {
    expect(escapeCsvValue('hello')).toBe('hello');
  });

  it('wraps strings with commas in quotes', () => {
    expect(escapeCsvValue('hello, world')).toBe('"hello, world"');
  });

  it('escapes double quotes', () => {
    expect(escapeCsvValue('say "hi"')).toBe('"say ""hi"""');
  });

  it('wraps strings with newlines in quotes', () => {
    expect(escapeCsvValue('line1\nline2')).toBe('"line1\nline2"');
  });

  it('handles number values', () => {
    expect(escapeCsvValue(42)).toBe('42');
  });
});

// ---------------------------------------------------------------------------
// triggerDownload
// ---------------------------------------------------------------------------

describe('triggerDownload', () => {
  it('creates a blob, appends anchor to DOM, clicks it, cleans up', () => {
    const clicks: string[] = [];
    const removeCalls: string[] = [];
    const revokedUrls: string[] = [];

    const mockElement = {
      href: '',
      download: '',
      style: {} as CSSStyleDeclaration,
      click: () => clicks.push('clicked'),
      remove: () => removeCalls.push('removed'),
    };

    vi.spyOn(document, 'createElement').mockReturnValue(mockElement as unknown as HTMLElement);
    vi.spyOn(document.body, 'append').mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => revokedUrls.push(url));

    triggerDownload('hello world', 'test.txt', 'text/plain');

    expect(clicks).toHaveLength(1);
    expect(removeCalls).toHaveLength(1);
    expect(mockElement.download).toBe('test.txt');
    expect(mockElement.href).toBe('blob:test');
    expect(mockElement.style.display).toBe('none');
    expect(revokedUrls).toEqual(['blob:test']);

    vi.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------
// downloadCsv
// ---------------------------------------------------------------------------

describe('downloadCsv', () => {
  it('creates a CSV blob and triggers download', () => {
    const clicks: string[] = [];
    const revokedUrls: string[] = [];

    const mockElement = {
      href: '',
      download: '',
      style: {} as CSSStyleDeclaration,
      click: () => clicks.push('clicked'),
      remove: vi.fn(),
    };

    vi.spyOn(document, 'createElement').mockReturnValue(mockElement as unknown as HTMLElement);
    vi.spyOn(document.body, 'append').mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => revokedUrls.push(url));

    downloadCsv(
      ['name', 'value'],
      [
        ['Alice', 42],
        ['Bob, Jr', null],
      ],
      'test.csv',
    );

    expect(clicks).toHaveLength(1);
    expect(mockElement.download).toBe('test.csv');
    expect(mockElement.href).toBe('blob:test-url');
    expect(revokedUrls).toEqual(['blob:test-url']);

    vi.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------
// recencyColorClass
// ---------------------------------------------------------------------------

describe('recencyColorClass', () => {
  it('returns muted for empty string', () => {
    expect(recencyColorClass('')).toBe('bg-muted-foreground');
  });

  it('returns green for very recent', () => {
    const recent = new Date(Date.now() - 5 * 60_000).toISOString(); // 5 min ago
    expect(recencyColorClass(recent)).toBe('bg-green-500');
  });

  it('returns yellow for a few hours ago', () => {
    const hours = new Date(Date.now() - 5 * 3600_000).toISOString(); // 5h ago
    expect(recencyColorClass(hours)).toBe('bg-yellow-500');
  });

  it('returns muted for old dates', () => {
    const old = new Date(Date.now() - 48 * 3600_000).toISOString(); // 2 days ago
    expect(recencyColorClass(old)).toBe('bg-muted-foreground');
  });
});
