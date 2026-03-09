import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="relative p-4 md:p-6 max-w-[1200px]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
        <div className="flex-1">
          <Skeleton className="h-7 w-40 mb-2" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-8 w-24" />
      </div>

      {/* Search and filters */}
      <div className="flex gap-2.5 items-center mb-6 flex-wrap">
        <Skeleton className="h-10 flex-1 min-w-48" />
        <Skeleton className="h-8 w-32" />
      </div>

      {/* Discovery cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={`discover-sk-${String(i)}`}
            className="p-4 bg-card border border-border/50 rounded-lg space-y-3"
          >
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <div className="flex gap-2 pt-2">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-8 w-24" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
