import type React from 'react';

import { cn } from '@/lib/utils';

import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

export type ReportType = 'project-progress' | 'knowledge-health' | 'activity-digest';

export type ReportCardConfig = {
  type: ReportType;
  title: string;
  description: string;
  icon: React.ReactNode;
};

export function ReportCard({
  config,
  selected = false,
  onSelect,
  className,
}: {
  config: ReportCardConfig;
  selected?: boolean;
  onSelect?: (type: ReportType) => void;
  className?: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onSelect?.(config.type)}
      className={cn('block w-full text-left', className)}
      aria-pressed={selected}
    >
      <Card
        className={cn(
          'gap-3 rounded-lg border transition-colors hover:border-primary/40 hover:bg-accent/5',
          selected && 'border-primary/60 bg-accent/10',
        )}
      >
        <CardHeader className="gap-2 px-4 pt-4 pb-0">
          <div
            className={cn(
              'flex size-9 items-center justify-center rounded-md border text-muted-foreground',
              selected && 'border-primary/40 text-primary',
            )}
          >
            {config.icon}
          </div>
          <CardTitle className="text-sm leading-snug">{config.title}</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <p className="text-xs text-muted-foreground">{config.description}</p>
        </CardContent>
      </Card>
    </button>
  );
}
