import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="p-4 md:p-6 max-w-[1000px]">
      {/* Breadcrumb */}
      <Skeleton className="h-4 w-32 mb-4" />

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-8 w-16" />
        </div>
      </div>

      {/* Agent Details Card */}
      <div className="mb-4 p-4 bg-card border border-border/50 rounded-lg">
        <Skeleton className="h-4 w-32 mb-4" />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={`field-sk-${String(i)}`}>
              <Skeleton className="h-3 w-20 mb-1" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </div>

      {/* Cost cards */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        {Array.from({ length: 2 }, (_, i) => (
          <div
            key={`cost-sk-${String(i)}`}
            className="p-4 bg-card border border-border/50 rounded-lg"
          >
            <Skeleton className="h-3 w-20 mb-2" />
            <Skeleton className="h-7 w-16" />
          </div>
        ))}
      </div>

      {/* Recent Runs Card */}
      <div className="p-4 bg-card border border-border/50 rounded-lg">
        <Skeleton className="h-4 w-32 mb-4" />
        <div className="space-y-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={`run-sk-${String(i)}`} className="h-10 rounded" />
          ))}
        </div>
      </div>
    </div>
  );
}
