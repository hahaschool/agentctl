import { Info } from 'lucide-react';
import type React from 'react';

import { cn } from '@/lib/utils';

import { SimpleTooltip } from './SimpleTooltip';

const VALUE_VARIANT_CLASSES = {
  green: 'text-green-500',
  red: 'text-red-500',
  yellow: 'text-yellow-500',
  default: 'text-foreground',
} as const;

const METRIC_ACCENT_CLASSES: Record<string, string> = {
  green: 'border-l-green-500/60',
  yellow: 'border-l-yellow-500/60',
  red: 'border-l-red-500/60',
  blue: 'border-l-blue-500/60',
  purple: 'border-l-purple-500/60',
};

export type LogsMetricCardProps = {
  label: string;
  value: string;
  valueVariant?: 'green' | 'red' | 'yellow';
  valueClassName?: string;
  accent?: 'green' | 'yellow' | 'red' | 'blue' | 'purple';
  tooltip?: string;
};

export function LogsMetricCard({
  label,
  value,
  valueVariant,
  valueClassName,
  accent,
  tooltip,
}: LogsMetricCardProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'px-[18px] py-4 bg-card border border-border/50 rounded transition-colors hover:border-border',
        accent && 'border-l-[3px]',
        accent && METRIC_ACCENT_CLASSES[accent],
      )}
    >
      <div className="text-[11px] text-muted-foreground mb-1.5 flex items-center gap-1">
        {tooltip ? (
          <SimpleTooltip content={tooltip}>
            <span className="inline-flex items-center gap-1 cursor-default">
              {label}
              <Info size={10} className="text-muted-foreground/60" />
            </span>
          </SimpleTooltip>
        ) : (
          label
        )}
      </div>
      <div
        className={cn(
          'text-2xl font-semibold',
          valueClassName ?? VALUE_VARIANT_CLASSES[valueVariant ?? 'default'],
        )}
      >
        {value}
      </div>
    </div>
  );
}
