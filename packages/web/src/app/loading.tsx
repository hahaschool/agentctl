import { Spinner } from '@/components/Spinner';
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center min-h-[60vh] gap-3">
      <Spinner size="lg" />
      <Skeleton className="h-4 w-24" />
    </div>
  );
}
