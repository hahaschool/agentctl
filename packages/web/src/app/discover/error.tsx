'use client';

import { RouteErrorCard } from '@/components/RouteErrorCard';

export default function DiscoverError({
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
      title="Failed to load discovery"
      description="The discovery page could not be loaded. The server may be unavailable or there may be a connection issue."
    />
  );
}
