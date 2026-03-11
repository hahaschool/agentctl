import type React from 'react';

import { cn } from '@/lib/utils';

export function ScopeSelector({
  value,
  options,
  onValueChange,
  className,
}: {
  value: string;
  options: readonly string[];
  onValueChange: (value: string) => void;
  className?: string;
}): React.JSX.Element {
  return (
    <label className={cn('flex flex-col gap-2 text-sm', className)}>
      <span className="font-medium">Scope</span>
      <select
        aria-label="Scope"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
