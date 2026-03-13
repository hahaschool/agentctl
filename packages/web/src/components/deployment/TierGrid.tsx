'use client';

import type { DeploymentTierStatus } from '@/lib/api';

import { TierCard } from './TierCard';

// ---------------------------------------------------------------------------
// Skeleton placeholder for loading state
// ---------------------------------------------------------------------------

function TierSkeleton(): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-card p-4 animate-pulse">
      <div className="flex items-center justify-between mb-3">
        <div className="space-y-1.5">
          <div className="h-4 w-24 bg-muted rounded" />
          <div className="h-3 w-16 bg-muted rounded" />
        </div>
        <div className="h-5 w-16 bg-muted rounded" />
      </div>
      <div className="space-y-2 mt-4">
        <div className="h-3 w-full bg-muted rounded" />
        <div className="h-3 w-full bg-muted rounded" />
        <div className="h-3 w-3/4 bg-muted rounded" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TierGrid
// ---------------------------------------------------------------------------

type TierGridProps = {
  readonly tiers: DeploymentTierStatus[];
  readonly loading: boolean;
};

export function TierGrid({ tiers, loading }: TierGridProps): React.JSX.Element {
  if (loading && tiers.length === 0) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TierSkeleton />
        <TierSkeleton />
        <TierSkeleton />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {tiers.map((tier) => (
        <TierCard key={tier.name} tier={tier} />
      ))}
    </div>
  );
}
