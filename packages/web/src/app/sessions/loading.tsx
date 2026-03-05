import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="relative p-4 md:p-6 max-w-[1100px]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
        <div className="flex-1">
          <Skeleton className="h-7 w-32 mb-2" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-8 rounded-full" />
        </div>
      </div>

      {/* Filter controls skeleton */}
      <div className="flex gap-2.5 items-center mb-4 flex-wrap">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-32" />
      </div>

      {/* Sessions table skeleton */}
      <div className="space-y-2">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={`session-sk-${String(i)}`} className="p-4 bg-card border border-border rounded-lg">
            <div className="flex items-center gap-4">
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-6 w-20 ml-auto" />
              <Skeleton className="h-6 w-16" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
