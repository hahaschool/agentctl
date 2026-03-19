'use client';

import { MANAGED_RUNTIMES, type ManagedRuntime } from '@agentctl/shared';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

type RuntimeSelectorProps = {
  value: ManagedRuntime;
  onChange: (runtime: ManagedRuntime) => void;
  disabled?: boolean;
  variant?: 'radio' | 'dropdown';
};

const RUNTIME_LABELS: Record<ManagedRuntime, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
};

export function RuntimeSelector({
  value,
  onChange,
  disabled = false,
  variant = 'radio',
}: RuntimeSelectorProps): React.JSX.Element {
  if (variant === 'dropdown') {
    return (
      <Select
        value={value}
        onValueChange={(v) => onChange(v as ManagedRuntime)}
        disabled={disabled}
      >
        <SelectTrigger className="w-[160px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MANAGED_RUNTIMES.map((rt) => (
            <SelectItem key={rt} value={rt}>
              {RUNTIME_LABELS[rt]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // Radio variant
  return (
    <div className="flex gap-3" role="radiogroup" aria-label="Runtime">
      {MANAGED_RUNTIMES.map((rt) => (
        // biome-ignore lint/a11y/useSemanticElements: custom styled radio button
        <button
          key={rt}
          type="button"
          role="radio"
          aria-checked={value === rt}
          disabled={disabled}
          onClick={() => !disabled && onChange(rt)}
          className={`px-3 py-1.5 rounded-md border text-sm transition-colors ${
            value === rt
              ? 'border-blue-500 bg-blue-500/10 text-blue-400'
              : 'border-border text-muted-foreground hover:border-border/80'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          {RUNTIME_LABELS[rt]}
        </button>
      ))}
    </div>
  );
}
