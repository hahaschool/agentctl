import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="p-4 md:p-6 max-w-[1000px]">
      {/* Breadcrumb */}
      <Skeleton className="h-4 w-40 mb-4" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-8 rounded-full" />
        </div>
      </div>

      {/* Machine Details Card */}
      <div className="mb-4 p-4 bg-card border border-border/50 rounded-lg">
        <Skeleton className="h-4 w-32 mb-4" />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={`field-sk-${String(i)}`}>
              <Skeleton className="h-3 w-20 mb-1" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </div>

      {/* Capabilities Card */}
      <div className="mb-4 p-4 bg-card border border-border/50 rounded-lg">
        <Skeleton className="h-4 w-28 mb-4" />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={`cap-sk-${String(i)}`}>
              <Skeleton className="h-3 w-20 mb-1" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>

      {/* Agents on this Machine Card */}
      <div className="mb-4 p-4 bg-card border border-border/50 rounded-lg">
        <Skeleton className="h-4 w-40 mb-4" />
        <div className="space-y-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={`agent-sk-${String(i)}`} className="h-10 rounded" />
          ))}
        </div>
      </div>

      {/* Recent Sessions Card */}
      <div className="p-4 bg-card border border-border/50 rounded-lg">
        <Skeleton className="h-4 w-40 mb-4" />
        <div className="space-y-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={`session-sk-${String(i)}`} className="h-10 rounded" />
          ))}
        </div>
      </div>
    </div>
  );
}
