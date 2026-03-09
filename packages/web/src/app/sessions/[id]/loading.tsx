import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="relative h-full flex flex-col">
      {/* Header bar */}
      <div className="px-5 py-3 border-b border-border shrink-0 bg-card">
        <div className="flex items-center gap-3 mb-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-5 w-20 rounded-full" />
          <div className="ml-auto flex items-center gap-2">
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-8 w-8 rounded-full" />
          </div>
        </div>
        <div className="flex items-center gap-4 text-[11px] flex-wrap">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3 w-40" />
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Message list toolbar */}
        <div className="px-5 py-1.5 border-b border-border flex items-center gap-3 text-[11px] text-muted-foreground shrink-0 bg-background">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-6 w-20" />
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-auto px-5 py-3 space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <div
              key={`msg-sk-${String(i)}`}
              className={`rounded-lg p-3 space-y-2 ${i % 2 === 0 ? 'mr-8' : 'ml-8'}`}
            >
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          ))}
        </div>

        {/* Input area */}
        <div className="px-5 py-3 border-t border-border bg-card shrink-0">
          <div className="flex gap-2 items-end">
            <Skeleton className="flex-1 h-9 rounded-md" />
            <Skeleton className="h-9 w-16 rounded-md" />
          </div>
        </div>
      </div>
    </div>
  );
}
