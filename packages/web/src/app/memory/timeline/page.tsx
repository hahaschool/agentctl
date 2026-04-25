import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Skeleton } from '@/components/ui/skeleton';
import { MemoryTimelineView } from '@/views/MemoryTimelineView';

export const metadata: Metadata = { title: 'Memory Timeline' };

function TimelineSkeleton() {
  return (
    <div className="space-y-3 p-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-64" />
      <Skeleton className="h-24 w-full rounded-lg" />
      <Skeleton className="h-14 w-full rounded-lg" />
      <Skeleton className="h-14 w-full rounded-lg" />
    </div>
  );
}

export default function Page() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<TimelineSkeleton />}>
        <MemoryTimelineView />
      </Suspense>
    </ErrorBoundary>
  );
}
