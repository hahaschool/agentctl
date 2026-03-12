/**
 * Cron expression utilities — parsing, description, and next-run calculation.
 *
 * Supports standard 5-field cron: minute hour day-of-month month day-of-week
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CronMode = 'every-minute' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom';

export type CronParts = {
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
};

export type CronPreset = {
  mode: CronMode;
  /** For hourly: minute of the hour (0-59) */
  minuteOfHour: number;
  /** For daily/weekly/monthly: hour (0-23) */
  hour: number;
  /** For daily/weekly/monthly: minute (0-59) */
  minute: number;
  /** For weekly: day of week (0=Sunday..6=Saturday) */
  dayOfWeek: number;
  /** For monthly: day of month (1-31) */
  dayOfMonth: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

// ---------------------------------------------------------------------------
// Parse / Split
// ---------------------------------------------------------------------------

export function parseCron(expression: string): CronParts | null {
  const trimmed = expression.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) return null;

  return {
    minute: parts[0] ?? '*',
    hour: parts[1] ?? '*',
    dayOfMonth: parts[2] ?? '*',
    month: parts[3] ?? '*',
    dayOfWeek: parts[4] ?? '*',
  };
}

export function cronToString(parts: CronParts): string {
  return `${parts.minute} ${parts.hour} ${parts.dayOfMonth} ${parts.month} ${parts.dayOfWeek}`;
}

// ---------------------------------------------------------------------------
// Detect mode from a cron expression
// ---------------------------------------------------------------------------

export function detectMode(expression: string): CronMode {
  const parts = parseCron(expression);
  if (!parts) return 'custom';

  const { minute, hour, dayOfMonth, month, dayOfWeek } = parts;

  // Every minute: * * * * *
  if (minute === '*' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'every-minute';
  }

  // Hourly: N * * * * (single minute, rest wildcard)
  if (
    isSimpleNumber(minute) &&
    hour === '*' &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    return 'hourly';
  }

  // Daily: N N * * * (specific minute and hour, rest wildcard)
  if (
    isSimpleNumber(minute) &&
    isSimpleNumber(hour) &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    return 'daily';
  }

  // Weekly: N N * * N (specific minute, hour, and day-of-week)
  if (
    isSimpleNumber(minute) &&
    isSimpleNumber(hour) &&
    dayOfMonth === '*' &&
    month === '*' &&
    isSimpleNumber(dayOfWeek)
  ) {
    return 'weekly';
  }

  // Monthly: N N N * * (specific minute, hour, and day-of-month)
  if (
    isSimpleNumber(minute) &&
    isSimpleNumber(hour) &&
    isSimpleNumber(dayOfMonth) &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    return 'monthly';
  }

  return 'custom';
}

// ---------------------------------------------------------------------------
// Extract preset values from expression
// ---------------------------------------------------------------------------

export function extractPreset(expression: string): CronPreset {
  const mode = detectMode(expression);
  const parts = parseCron(expression);

  const defaults: CronPreset = {
    mode,
    minuteOfHour: 0,
    hour: 9,
    minute: 0,
    dayOfWeek: 1,
    dayOfMonth: 1,
  };

  if (!parts) return { ...defaults, mode: 'custom' };

  if (mode === 'hourly') {
    return { ...defaults, minuteOfHour: safeInt(parts.minute, 0) };
  }

  if (mode === 'daily') {
    return {
      ...defaults,
      minute: safeInt(parts.minute, 0),
      hour: safeInt(parts.hour, 9),
    };
  }

  if (mode === 'weekly') {
    return {
      ...defaults,
      minute: safeInt(parts.minute, 0),
      hour: safeInt(parts.hour, 9),
      dayOfWeek: safeInt(parts.dayOfWeek, 1),
    };
  }

  if (mode === 'monthly') {
    return {
      ...defaults,
      minute: safeInt(parts.minute, 0),
      hour: safeInt(parts.hour, 9),
      dayOfMonth: safeInt(parts.dayOfMonth, 1),
    };
  }

  return defaults;
}

// ---------------------------------------------------------------------------
// Build expression from preset
// ---------------------------------------------------------------------------

export function presetToExpression(preset: CronPreset): string {
  switch (preset.mode) {
    case 'every-minute':
      return '* * * * *';
    case 'hourly':
      return `${preset.minuteOfHour} * * * *`;
    case 'daily':
      return `${preset.minute} ${preset.hour} * * *`;
    case 'weekly':
      return `${preset.minute} ${preset.hour} * * ${preset.dayOfWeek}`;
    case 'monthly':
      return `${preset.minute} ${preset.hour} ${preset.dayOfMonth} * *`;
    case 'custom':
      return '* * * * *';
  }
}

// ---------------------------------------------------------------------------
// Human-readable description
// ---------------------------------------------------------------------------

export function describeCron(expression: string): string {
  const parts = parseCron(expression);
  if (!parts) return 'Invalid cron expression';

  const mode = detectMode(expression);

  switch (mode) {
    case 'every-minute':
      return 'Runs every minute';
    case 'hourly':
      return `Runs every hour at :${pad2(safeInt(parts.minute, 0))}`;
    case 'daily':
      return `Runs every day at ${formatHourMinute(safeInt(parts.hour, 0), safeInt(parts.minute, 0))}`;
    case 'weekly':
      return `Runs every ${DAY_NAMES[safeInt(parts.dayOfWeek, 0)] ?? 'Sunday'} at ${formatHourMinute(safeInt(parts.hour, 0), safeInt(parts.minute, 0))}`;
    case 'monthly':
      return `Runs on the ${ordinal(safeInt(parts.dayOfMonth, 1))} of every month at ${formatHourMinute(safeInt(parts.hour, 0), safeInt(parts.minute, 0))}`;
    case 'custom':
      return describeCustom(parts);
  }
}

function describeCustom(parts: CronParts): string {
  const segments: string[] = [];

  if (parts.minute === '*') {
    segments.push('every minute');
  } else if (parts.minute.startsWith('*/')) {
    segments.push(`every ${parts.minute.slice(2)} minutes`);
  } else {
    segments.push(`at minute ${parts.minute}`);
  }

  if (parts.hour !== '*') {
    if (parts.hour.startsWith('*/')) {
      segments.push(`every ${parts.hour.slice(2)} hours`);
    } else {
      segments.push(`at hour ${parts.hour}`);
    }
  }

  if (parts.dayOfMonth !== '*') {
    segments.push(`on day ${parts.dayOfMonth}`);
  }

  if (parts.month !== '*') {
    segments.push(`in month ${parts.month}`);
  }

  if (parts.dayOfWeek !== '*') {
    const dayNum = safeInt(parts.dayOfWeek, -1);
    if (dayNum >= 0 && dayNum <= 6) {
      segments.push(`on ${DAY_NAMES[dayNum]}`);
    } else {
      segments.push(`on day-of-week ${parts.dayOfWeek}`);
    }
  }

  return `Runs ${segments.join(', ')}`;
}

// ---------------------------------------------------------------------------
// Compute next N run times
// ---------------------------------------------------------------------------

export function getNextRuns(expression: string, count: number, from?: Date): Date[] {
  const parts = parseCron(expression);
  if (!parts) return [];

  const results: Date[] = [];
  const start = from ? new Date(from) : new Date();
  const cursor = new Date(start);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  const maxIterations = 525_960; // ~1 year of minutes
  let iterations = 0;

  while (results.length < count && iterations < maxIterations) {
    if (matchesCron(cursor, parts)) {
      results.push(new Date(cursor));
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
    iterations++;
  }

  return results;
}

function matchesCron(date: Date, parts: CronParts): boolean {
  return (
    matchesField(date.getMinutes(), parts.minute) &&
    matchesField(date.getHours(), parts.hour) &&
    matchesField(date.getDate(), parts.dayOfMonth) &&
    matchesField(date.getMonth() + 1, parts.month) &&
    matchesField(date.getDay(), parts.dayOfWeek)
  );
}

function matchesField(value: number, field: string): boolean {
  if (field === '*') return true;

  if (field.startsWith('*/')) {
    const step = safeInt(field.slice(2), 1);
    return step > 0 && value % step === 0;
  }

  const segments = field.split(',');
  for (const seg of segments) {
    if (seg.includes('-') && !seg.includes('/')) {
      const [low, high] = seg.split('-').map((s) => safeInt(s, -1));
      if (low !== undefined && high !== undefined && value >= low && value <= high) return true;
    } else if (seg.includes('/')) {
      const [rangePart, stepPart] = seg.split('/');
      const step = safeInt(stepPart ?? '1', 1);
      if (rangePart === '*') {
        if (step > 0 && value % step === 0) return true;
      } else if (rangePart?.includes('-')) {
        const [low, high] = rangePart.split('-').map((s) => safeInt(s, -1));
        if (
          low !== undefined &&
          high !== undefined &&
          value >= low &&
          value <= high &&
          step > 0 &&
          (value - low) % step === 0
        )
          return true;
      }
    } else {
      if (safeInt(seg, -1) === value) return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function isValidCron(expression: string): boolean {
  const parts = parseCron(expression);
  if (!parts) return false;

  return (
    isValidField(parts.minute, 0, 59) &&
    isValidField(parts.hour, 0, 23) &&
    isValidField(parts.dayOfMonth, 1, 31) &&
    isValidField(parts.month, 1, 12) &&
    isValidField(parts.dayOfWeek, 0, 7)
  );
}

function isValidField(field: string, min: number, max: number): boolean {
  if (field === '*') return true;
  if (field.startsWith('*/')) {
    const step = Number.parseInt(field.slice(2), 10);
    return !Number.isNaN(step) && step >= 1 && step <= max;
  }

  const segments = field.split(',');
  for (const seg of segments) {
    if (seg.includes('-')) {
      const rangeParts = seg.split('/')[0]?.split('-') ?? [];
      for (const p of rangeParts) {
        const n = Number.parseInt(p, 10);
        if (Number.isNaN(n) || n < min || n > max) return false;
      }
    } else {
      const n = Number.parseInt(seg, 10);
      if (Number.isNaN(n) || n < min || n > max) return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isSimpleNumber(field: string): boolean {
  return /^\d+$/.test(field);
}

function safeInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? fallback : n;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatHourMinute(hour: number, minute: number): string {
  const period = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${pad2(minute)} ${period}`;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
