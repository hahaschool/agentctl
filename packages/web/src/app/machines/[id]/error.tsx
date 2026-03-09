'use client';

import { RouteErrorCard } from '@/components/RouteErrorCard';

export default function MachineDetailError({
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
      title="Failed to load machine"
      description="The machine could not be loaded. It may have been deregistered or the server may be unavailable."
      fallbackHref="/machines"
      fallbackLabel="All Machines"
    />
  );
}
