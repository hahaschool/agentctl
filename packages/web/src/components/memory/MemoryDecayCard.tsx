'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2, Zap } from 'lucide-react';
import type React from 'react';
import { useCallback, useState } from 'react';

import { useToast } from '@/components/Toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatNumber } from '@/lib/format-utils';
import { memoryDecayStatsQuery, useRunMemoryDecay } from '@/lib/queries';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type StatRowProps = {
  label: string;
  value: string;
  testId: string;
  emphasis?: 'default' | 'amber' | 'emerald';
};

const EMPHASIS_CLASS: Record<Required<StatRowProps>['emphasis'], string> = {
  default: 'text-foreground',
  amber: 'text-amber-600 dark:text-amber-400',
  emerald: 'text-emerald-600 dark:text-emerald-400',
};

function StatRow({ label, value, testId, emphasis = 'default' }: StatRowProps): React.JSX.Element {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span data-testid={testId} className={`font-mono tabular-nums ${EMPHASIS_CLASS[emphasis]}`}>
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MemoryDecayCard(): React.JSX.Element {
  const decayStatsQuery = useQuery(memoryDecayStatsQuery());
  const runDecay = useRunMemoryDecay();
  const toast = useToast();

  const [confirmOpen, setConfirmOpen] = useState(false);

  const stats = decayStatsQuery.data?.stats;
  const isLoading = decayStatsQuery.isLoading;
  const isRunning = runDecay.isPending;

  // Memories likely to be archived next run = facts already in the "low" bucket.
  const eligibleForArchival = stats?.strengthDistribution.low ?? 0;
  const lastResult = runDecay.data?.result;

  const handleConfirm = useCallback(() => {
    runDecay.mutate(undefined, {
      onSuccess: (data) => {
        setConfirmOpen(false);
        const r = data.result;
        toast.success(
          `Decay complete — ${formatNumber(r.decayed)} decayed, ${formatNumber(r.archived)} archived`,
        );
      },
      onError: (error) => {
        setConfirmOpen(false);
        const message = error instanceof Error ? error.message : 'Memory decay failed';
        toast.error(message);
      },
    });
  }, [runDecay, toast]);

  return (
    <Card data-testid="memory-decay-card">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm font-medium">Memory Decay</CardTitle>
          <Button
            type="button"
            size="sm"
            onClick={() => setConfirmOpen(true)}
            disabled={isLoading || isRunning}
            data-testid="memory-decay-trigger-button"
            className="bg-blue-500 text-white hover:bg-blue-500/90 focus-visible:ring-blue-500/40"
          >
            {isRunning ? (
              <>
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                Running…
              </>
            ) : (
              <>
                <Zap className="size-3.5" aria-hidden="true" />
                Trigger decay
              </>
            )}
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div data-testid="memory-decay-loading" className="space-y-2">
            <div className="h-4 animate-pulse rounded bg-muted" />
            <div className="h-4 animate-pulse rounded bg-muted" />
            <div className="h-4 animate-pulse rounded bg-muted" />
          </div>
        ) : decayStatsQuery.error ? (
          <p data-testid="memory-decay-error" className="text-xs text-destructive" role="alert">
            Failed to load decay stats:{' '}
            {decayStatsQuery.error instanceof Error
              ? decayStatsQuery.error.message
              : 'Unknown error'}
          </p>
        ) : stats ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <StatRow
                label="Eligible for archival (low strength)"
                value={formatNumber(eligibleForArchival)}
                testId="memory-decay-eligible"
                emphasis={eligibleForArchival > 0 ? 'amber' : 'default'}
              />
              <StatRow
                label="Pinned (exempt from decay)"
                value={formatNumber(stats.pinnedCount)}
                testId="memory-decay-pinned"
                emphasis="emerald"
              />
              <StatRow
                label="Already archived"
                value={formatNumber(stats.archivedCount)}
                testId="memory-decay-archived"
              />
            </div>

            {lastResult && (
              <div
                data-testid="memory-decay-last-result"
                className="border-t border-border/50 pt-2 text-[11px] text-muted-foreground"
              >
                Last run: decayed {formatNumber(lastResult.decayed)}, archived{' '}
                {formatNumber(lastResult.archived)}, skipped {formatNumber(lastResult.skipped)}
              </div>
            )}
          </div>
        ) : null}
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => !isRunning && setConfirmOpen(open)}>
        <AlertDialogContent data-testid="memory-decay-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Run memory decay?</AlertDialogTitle>
            <AlertDialogDescription>
              This will archive stale memories older than the configured threshold. Pinned facts and
              recently accessed facts are preserved. The action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRunning}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                handleConfirm();
              }}
              disabled={isRunning}
              data-testid="memory-decay-confirm-button"
              className="bg-blue-500 text-white hover:bg-blue-500/90"
            >
              {isRunning ? 'Running…' : 'Run decay'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
