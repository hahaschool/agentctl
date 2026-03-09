import type React from 'react';

import { Skeleton } from '@/components/ui/skeleton';

export type DashboardEmptyPanelProps = {
  loading: boolean;
  message: string;
};

export function DashboardEmptyPanel({
  loading,
  message,
}: DashboardEmptyPanelProps): React.JSX.Element {
  if (loading) {
    return (
      <div className="p-4 bg-card space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={`sk-${String(i)}`} className="flex items-center gap-3">
            <Skeleton className="h-3 w-3 rounded-full shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-2.5 w-1/2" />
            </div>
            <Skeleton className="h-3 w-12 shrink-0" />
          </div>
        ))}
      </div>
    );
  }
  return <div className="p-8 text-center text-muted-foreground bg-card text-[13px]">{message}</div>;
}
