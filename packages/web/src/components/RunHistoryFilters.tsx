'use client';

import type React from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RunStatusFilter = 'all' | 'success' | 'failure' | 'running' | 'cancelled';
export type RunTriggerFilter = 'all' | 'manual' | 'schedule' | 'heartbeat' | 'adhoc';

export type RunHistoryFiltersProps = {
  status: RunStatusFilter;
  trigger: RunTriggerFilter;
  onStatusChange: (status: RunStatusFilter) => void;
  onTriggerChange: (trigger: RunTriggerFilter) => void;
  disabled?: boolean;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_OPTIONS: ReadonlyArray<{ value: RunStatusFilter; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'success', label: 'Success' },
  { value: 'failure', label: 'Failed' },
  { value: 'running', label: 'Running' },
  { value: 'cancelled', label: 'Cancelled' },
];

const TRIGGER_OPTIONS: ReadonlyArray<{ value: RunTriggerFilter; label: string }> = [
  { value: 'all', label: 'All triggers' },
  { value: 'manual', label: 'Manual' },
  { value: 'schedule', label: 'Cron / Schedule' },
  { value: 'heartbeat', label: 'Heartbeat' },
  { value: 'adhoc', label: 'Ad-hoc' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RunHistoryFilters({
  status,
  trigger,
  onStatusChange,
  onTriggerChange,
  disabled = false,
}: RunHistoryFiltersProps): React.JSX.Element {
  return (
    <div className="flex gap-2 flex-wrap">
      <Select
        value={status}
        onValueChange={(v) => onStatusChange(v as RunStatusFilter)}
        disabled={disabled}
      >
        <SelectTrigger
          size="sm"
          className="h-7 min-w-[130px] text-xs"
          aria-label="Filter by status"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" sideOffset={4}>
          {STATUS_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={trigger}
        onValueChange={(v) => onTriggerChange(v as RunTriggerFilter)}
        disabled={disabled}
      >
        <SelectTrigger
          size="sm"
          className="h-7 min-w-[130px] text-xs"
          aria-label="Filter by trigger"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" sideOffset={4}>
          {TRIGGER_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
