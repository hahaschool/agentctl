import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-8 w-16 rounded-md" />
      </div>

      {/* Terminal area */}
      <div className="flex-1 flex items-center justify-center">
        <span className="text-sm text-muted-foreground animate-pulse">
          Connecting to terminal...
        </span>
      </div>
    </div>
  );
}
