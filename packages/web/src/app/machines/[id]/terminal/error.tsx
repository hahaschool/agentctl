'use client';

import { RouteErrorCard } from '@/components/RouteErrorCard';

export default function TerminalError({
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
      title="Terminal Error"
      description="The terminal could not be loaded. The machine may be offline or the worker may be unavailable."
      fallbackHref="/machines"
      fallbackLabel="All Machines"
    />
  );
}
