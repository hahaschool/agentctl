'use client';

import type React from 'react';
import { Skeleton } from '@/components/ui/skeleton';

export function DiscoverLoadingSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 3 }, (_, gi) => (
        <div
          key={`gsk-${String(gi)}`}
          className="border border-border/50 rounded-lg overflow-hidden"
        >
          <div className="px-4 py-2.5 bg-card flex items-center gap-3">
            <Skeleton className="w-4 h-4 shrink-0" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton className="h-4 w-20" />
          </div>
          <div>
            {Array.from({ length: gi === 0 ? 4 : 2 }, (_, si) => (
              <div
                key={`ssk-${String(si)}`}
                className="flex items-center gap-3 px-4 py-2 border-t border-border"
              >
                <Skeleton className="w-[7px] h-[7px] rounded-full shrink-0" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-3 w-12 shrink-0" />
                <Skeleton className="h-3 w-16 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
