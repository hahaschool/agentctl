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
          <Skeleton className="h-8 w-28" />
        </div>
      </div>

      {/* Filter controls */}
      <div className="flex gap-2.5 items-center mb-4 flex-wrap">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-32" />
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3 mb-6">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={`stat-sk-${String(i)}`} className="p-4 bg-card border border-border rounded-lg">
            <Skeleton className="h-3 w-20 mb-2" />
            <Skeleton className="h-6 w-12" />
          </div>
        ))}
      </div>

      {/* Agent cards grid */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={`agent-sk-${String(i)}`}
            className="p-4 bg-card border border-border rounded-lg space-y-3"
          >
            <div className="flex justify-between items-center">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
            </div>
            <div className="border-t border-border pt-2">
              <Skeleton className="h-3 w-24" />
            </div>
            <div className="border-t border-border pt-2">
              <Skeleton className="h-8 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
