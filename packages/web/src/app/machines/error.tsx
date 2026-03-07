'use client';

import { RouteErrorCard } from '@/components/RouteErrorCard';

export default function MachinesError({
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
      title="Failed to load machines"
      description="The machines list could not be loaded. The server may be unavailable or there may be a connection issue."
    />
  );
}
