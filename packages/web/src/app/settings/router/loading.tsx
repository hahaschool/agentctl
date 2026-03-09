import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="relative p-4 md:p-6 max-w-[1100px]">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 mb-4">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-3" />
        <Skeleton className="h-4 w-28" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <Skeleton className="h-7 w-40 mb-2" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-8 w-8 rounded-full" />
      </div>

      {/* Status card */}
      <div className="p-4 bg-card border border-border/50 rounded-lg mb-6">
        <div className="flex items-center gap-3 mb-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-4 w-28" />
        </div>
      </div>

      {/* Model cards */}
      <Skeleton className="h-6 w-24 mb-4" />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={`model-sk-${String(i)}`}
            className="p-5 bg-card border border-border/50 rounded-lg space-y-3"
          >
            <div className="flex justify-between items-start">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-16" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
