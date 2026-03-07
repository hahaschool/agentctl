'use client';

import { RouteErrorCard } from '@/components/RouteErrorCard';

export default function AgentDetailError({
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
      title="Failed to load agent"
      description="The agent could not be loaded. It may have been removed or the server may be unavailable."
      fallbackHref="/agents"
      fallbackLabel="All Agents"
    />
  );
}
