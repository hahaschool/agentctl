import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="relative p-4 md:p-6 max-w-[1100px]">
      {/* Header */}
      <div className="mb-6">
        <Skeleton className="h-7 w-32 mb-2" />
        <Skeleton className="h-4 w-56" />
      </div>

      {/* Settings sections */}
      <div className="space-y-8">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={`settings-section-${String(i)}`} className="space-y-4">
            {/* Section header */}
            <Skeleton className="h-6 w-40" />

            {/* Settings items */}
            <div className="space-y-3">
              {Array.from({ length: 3 }, (_, j) => (
                <div
                  key={`settings-item-${String(i)}-${String(j)}`}
                  className="p-4 bg-card border border-border rounded-lg"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <Skeleton className="h-5 w-32 mb-1" />
                      <Skeleton className="h-3 w-48" />
                    </div>
                    <Skeleton className="h-8 w-24" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
