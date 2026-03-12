'use client';

import { AlertCircle, Clock } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  type CronMode,
  type CronPreset,
  DAY_NAMES,
  describeCron,
  detectMode,
  extractPreset,
  getNextRuns,
  isValidCron,
  presetToExpression,
} from '@/lib/cron-utils';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CronBuilderProps = {
  /** Current cron expression (controlled) */
  value: string;
  /** Called when the expression changes */
  onChange: (expression: string) => void;
  /** Disable all inputs */
  disabled?: boolean;
  /** Additional CSS class */
  className?: string;
};

// ---------------------------------------------------------------------------
// Mode labels
// ---------------------------------------------------------------------------

const MODE_OPTIONS: ReadonlyArray<{ value: CronMode; label: string }> = [
  { value: 'every-minute', label: 'Every Minute' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'custom', label: 'Custom' },
];

// ---------------------------------------------------------------------------
// Helper: hour options (0-23)
// ---------------------------------------------------------------------------

function formatHour(h: number): string {
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12} ${period}`;
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: String(i),
  label: formatHour(i),
}));

const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => ({
  value: String(i),
  label: String(i).padStart(2, '0'),
}));

const DAY_OF_WEEK_OPTIONS = DAY_NAMES.map((name, i) => ({
  value: String(i),
  label: name,
}));

const DAY_OF_MONTH_OPTIONS = Array.from({ length: 31 }, (_, i) => ({
  value: String(i + 1),
  label: String(i + 1),
}));

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CronBuilder({
  value,
  onChange,
  disabled = false,
  className,
}: CronBuilderProps): React.JSX.Element {
  const [rawInput, setRawInput] = useState(value);
  const [mode, setMode] = useState<CronMode>(() => detectMode(value || '* * * * *'));
  const [preset, setPreset] = useState<CronPreset>(() => extractPreset(value || '* * * * *'));

  useEffect(() => {
    setRawInput(value);
  }, [value]);

  useEffect(() => {
    if (!value) return;
    const detected = detectMode(value);
    setMode(detected);
    setPreset(extractPreset(value));
  }, [value]);

  const handleModeChange = useCallback(
    (newMode: CronMode) => {
      setMode(newMode);
      const newPreset: CronPreset = { ...preset, mode: newMode };
      setPreset(newPreset);
      if (newMode !== 'custom') {
        const expr = presetToExpression(newPreset);
        onChange(expr);
        setRawInput(expr);
      }
    },
    [preset, onChange],
  );

  const handlePresetChange = useCallback(
    (field: keyof CronPreset, val: number) => {
      const newPreset: CronPreset = { ...preset, [field]: val };
      setPreset(newPreset);
      const expr = presetToExpression(newPreset);
      onChange(expr);
      setRawInput(expr);
    },
    [preset, onChange],
  );

  const handleRawChange = useCallback(
    (raw: string) => {
      setRawInput(raw);
      if (isValidCron(raw)) {
        onChange(raw.trim());
      }
    },
    [onChange],
  );

  const valid = useMemo(() => isValidCron(value), [value]);
  const description = useMemo(
    () => (valid ? describeCron(value) : 'Invalid cron expression'),
    [value, valid],
  );
  const nextRuns = useMemo(() => (valid ? getNextRuns(value, 5) : []), [value, valid]);

  return (
    <div className={cn('space-y-3', className)}>
      {/* Mode selector */}
      <div className="space-y-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">Frequency</span>
        <Select
          value={mode}
          onValueChange={(v) => handleModeChange(v as CronMode)}
          disabled={disabled}
        >
          <SelectTrigger className="w-full" aria-label="Cron frequency">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" sideOffset={4}>
            {MODE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Mode-specific pickers */}
      {mode === 'hourly' && (
        <div className="space-y-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">At minute</span>
          <Select
            value={String(preset.minuteOfHour)}
            onValueChange={(v) => handlePresetChange('minuteOfHour', Number(v))}
            disabled={disabled}
          >
            <SelectTrigger className="w-full" aria-label="Minute of hour">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" sideOffset={4} className="max-h-[200px]">
              {MINUTE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  :{opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {mode === 'daily' && (
        <TimeSelector
          hour={preset.hour}
          minute={preset.minute}
          onHourChange={(h) => handlePresetChange('hour', h)}
          onMinuteChange={(m) => handlePresetChange('minute', m)}
          disabled={disabled}
        />
      )}

      {mode === 'weekly' && (
        <>
          <div className="space-y-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">Day of week</span>
            <Select
              value={String(preset.dayOfWeek)}
              onValueChange={(v) => handlePresetChange('dayOfWeek', Number(v))}
              disabled={disabled}
            >
              <SelectTrigger className="w-full" aria-label="Day of week">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" sideOffset={4}>
                {DAY_OF_WEEK_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <TimeSelector
            hour={preset.hour}
            minute={preset.minute}
            onHourChange={(h) => handlePresetChange('hour', h)}
            onMinuteChange={(m) => handlePresetChange('minute', m)}
            disabled={disabled}
          />
        </>
      )}

      {mode === 'monthly' && (
        <>
          <div className="space-y-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">Day of month</span>
            <Select
              value={String(preset.dayOfMonth)}
              onValueChange={(v) => handlePresetChange('dayOfMonth', Number(v))}
              disabled={disabled}
            >
              <SelectTrigger className="w-full" aria-label="Day of month">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" sideOffset={4} className="max-h-[200px]">
                {DAY_OF_MONTH_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <TimeSelector
            hour={preset.hour}
            minute={preset.minute}
            onHourChange={(h) => handlePresetChange('hour', h)}
            onMinuteChange={(m) => handlePresetChange('minute', m)}
            disabled={disabled}
          />
        </>
      )}

      {/* Raw cron input */}
      <div className="space-y-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">Cron Expression</span>
        <Input
          value={rawInput}
          onChange={(e) => handleRawChange(e.target.value)}
          placeholder="* * * * *"
          disabled={disabled}
          className={cn(
            'font-mono text-xs',
            !valid && rawInput.trim() && 'border-red-500/50 focus-visible:ring-red-500/20',
          )}
          aria-label="Cron expression"
          aria-invalid={!valid && rawInput.trim().length > 0}
        />
      </div>

      {/* Description & validation */}
      <div className="flex items-start gap-2 text-xs">
        {valid ? (
          <>
            <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
            <span className="text-muted-foreground">{description}</span>
          </>
        ) : rawInput.trim() ? (
          <>
            <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
            <span className="text-red-500 dark:text-red-400">
              Invalid cron expression. Use 5 fields: minute hour day month weekday
            </span>
          </>
        ) : null}
      </div>

      {/* Next 5 runs */}
      {valid && nextRuns.length > 0 && (
        <div className="space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">Next runs</span>
          <div className="space-y-0.5">
            {nextRuns.map((date) => (
              <div key={date.toISOString()} className="text-[11px] font-mono text-muted-foreground">
                {date.toLocaleString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function TimeSelector({
  hour,
  minute,
  onHourChange,
  onMinuteChange,
  disabled,
}: {
  hour: number;
  minute: number;
  onHourChange: (h: number) => void;
  onMinuteChange: (m: number) => void;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <div className="space-y-1.5">
      <span className="text-[11px] font-medium text-muted-foreground">Time</span>
      <div className="flex gap-2">
        <Select
          value={String(hour)}
          onValueChange={(v) => onHourChange(Number(v))}
          disabled={disabled}
        >
          <SelectTrigger className="flex-1" aria-label="Hour">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" sideOffset={4} className="max-h-[200px]">
            {HOUR_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="self-center text-muted-foreground">:</span>
        <Select
          value={String(minute)}
          onValueChange={(v) => onMinuteChange(Number(v))}
          disabled={disabled}
        >
          <SelectTrigger className="flex-1" aria-label="Minute">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" sideOffset={4} className="max-h-[200px]">
            {MINUTE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
