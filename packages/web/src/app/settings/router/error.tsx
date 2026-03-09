'use client';

import { RouteErrorCard } from '@/components/RouteErrorCard';

export default function RouterSettingsError({
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
      title="Failed to load router config"
      description="The router configuration could not be loaded. The LiteLLM proxy may be unavailable."
      fallbackHref="/settings"
      fallbackLabel="Settings"
    />
  );
}
