import type { Metadata } from 'next';
import { Suspense } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { MemoryBrowserView } from '@/views/MemoryBrowserView';

export const metadata: Metadata = { title: 'Memory Browser' };

function BrowserSkeleton() {
  return (
    <div className="flex h-full">
      <div className="hidden w-56 space-y-4 border-r border-border p-4 lg:block">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
      <div className="flex-1 space-y-2 p-4">
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<BrowserSkeleton />}>
      <MemoryBrowserView />
    </Suspense>
  );
}
