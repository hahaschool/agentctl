'use client';

import { RouteErrorCard } from '@/components/RouteErrorCard';

export default function LogsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteErrorCard
      error={error}
      reset={reset}
      title="Failed to load logs"
      description="The logs could not be loaded. The server may be unavailable or there may be a connection issue."
    />
  );
}
