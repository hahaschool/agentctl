'use client';

import { RouteErrorCard } from '@/components/RouteErrorCard';

export default function SessionDetailError({
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
      title="Failed to load session"
      description="The session could not be loaded. It may have been deleted or the server may be unavailable."
      fallbackHref="/sessions"
      fallbackLabel="All Sessions"
    />
  );
}
