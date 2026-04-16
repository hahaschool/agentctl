'use client';

import { useQuery } from '@tanstack/react-query';
import { Layers3 } from 'lucide-react';
import { useState } from 'react';

import { PromoteGate } from '@/components/deployment/PromoteGate';
import { PromotionHistory } from '@/components/deployment/PromotionHistory';
import { PromotionProgress } from '@/components/deployment/PromotionProgress';
import { TierGrid } from '@/components/deployment/TierGrid';
import { EmptyState } from '@/components/EmptyState';
import { deploymentTiersQuery, promotionHistoryQuery } from '@/lib/queries';

export function DeploymentView(): React.JSX.Element {
  const {
    data: tiersData,
    isLoading: tiersLoading,
    error: tiersError,
  } = useQuery(deploymentTiersQuery());
  const { data: historyData } = useQuery(promotionHistoryQuery());
  const [activePromotionId, setActivePromotionId] = useState<string | null>(null);

  const tiers = tiersData?.tiers ?? [];
  const hasTiers = tiers.length > 0;
  const showEmptyState = !tiersLoading && !tiersError && !hasTiers;

  return (
    <div className="min-h-full p-4 md:p-6 animate-page-enter">
      <div className="mx-auto max-w-7xl">
        <h1 className="text-2xl font-bold tracking-tight mb-6">Deployment</h1>

        {tiersError && (
          <div className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            Failed to load tier status. Is the control plane running?
          </div>
        )}

        {showEmptyState ? (
          <EmptyState
            icon={Layers3}
            title="No deployment tiers configured"
            description="Deployment tiers (beta, dev-1, dev-2) are defined in your PM2 ecosystem config and environment files. Run ./scripts/env-up.sh to set up a tier."
          />
        ) : (
          <div className="flex gap-6">
            <div className="flex-1 space-y-6">
              <TierGrid tiers={tiers} loading={tiersLoading} />
              <PromoteGate tiers={tiers} onPromoteStarted={setActivePromotionId} />
            </div>
            <div className="w-72 shrink-0 hidden lg:block">
              <PromotionHistory records={historyData?.records ?? []} />
            </div>
          </div>
        )}

        {activePromotionId && (
          <PromotionProgress
            promotionId={activePromotionId}
            onClose={() => setActivePromotionId(null)}
          />
        )}
      </div>
    </div>
  );
}
