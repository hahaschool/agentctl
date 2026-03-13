'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle, Loader2, Minus, XCircle } from 'lucide-react';

import type { DeploymentPreflightCheck, DeploymentTierStatus } from '@/lib/api';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Check indicator
// ---------------------------------------------------------------------------

function CheckIndicator({ check }: { readonly check: DeploymentPreflightCheck }): React.JSX.Element {
  const icons = {
    pass: <CheckCircle size={14} className="text-green-400" />,
    fail: <XCircle size={14} className="text-red-400" />,
    running: <Loader2 size={14} className="text-blue-400 animate-spin" />,
    skipped: <Minus size={14} className="text-muted-foreground/50" />,
  } as const;

  return (
    <div className="flex items-center gap-1.5">
      {icons[check.status]}
      <span className="text-xs">{check.name}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PromoteGate
// ---------------------------------------------------------------------------

type PromoteGateProps = {
  readonly tiers: DeploymentTierStatus[];
  readonly onPromoteStarted: (id: string) => void;
};

const EMPTY_CHECKS: DeploymentPreflightCheck[] = [
  { name: 'Build', status: 'skipped' },
  { name: 'Tests', status: 'skipped' },
  { name: 'Lint', status: 'skipped' },
  { name: 'Health', status: 'skipped' },
];

export function PromoteGate({ tiers, onPromoteStarted }: PromoteGateProps): React.JSX.Element {
  // Only show dev tiers (exclude "beta" from source options)
  const devTiers = tiers.filter((t) => t.name !== 'beta');
  const [source, setSource] = useState(devTiers[0]?.name ?? '');
  const [checks, setChecks] = useState<DeploymentPreflightCheck[]>(EMPTY_CHECKS);

  const preflightMutation = useMutation({
    mutationFn: () => api.runPreflight(source),
    onSuccess: (data) => {
      setChecks(data.checks);
    },
  });

  const promoteMutation = useMutation({
    mutationFn: () => api.triggerPromotion(source),
    onSuccess: (data) => {
      onPromoteStarted(data.id);
    },
  });

  const allPass = checks.every((c) => c.status === 'pass');
  const anyRunning = checks.some((c) => c.status === 'running') || preflightMutation.isPending;

  const handlePreflight = (): void => {
    // Reset checks to running state before firing
    setChecks(checks.map((c) => ({ ...c, status: 'running' as const })));
    preflightMutation.mutate();
  };

  const handlePromote = (): void => {
    const confirmed = window.confirm(
      `Promote ${source} to beta? This will deploy the current ${source} build to the beta tier.`,
    );
    if (confirmed) {
      promoteMutation.mutate();
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold tracking-tight mb-3">Promote to Beta</h3>

      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-4">
        <label className="text-xs text-muted-foreground shrink-0" htmlFor="source-tier-select">
          Source tier
        </label>
        <select
          id="source-tier-select"
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            setChecks(EMPTY_CHECKS);
          }}
          className="bg-muted border border-border rounded-md px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {devTiers.map((t) => (
            <option key={t.name} value={t.name}>
              {t.label} ({t.name})
            </option>
          ))}
        </select>
      </div>

      {/* Pre-check indicators */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-4">
        {checks.map((check) => (
          <CheckIndicator key={check.name} check={check} />
        ))}
      </div>

      {/* Error display */}
      {preflightMutation.isError && (
        <div className="mb-3 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          Preflight failed: {(preflightMutation.error as Error).message}
        </div>
      )}
      {promoteMutation.isError && (
        <div className="mb-3 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
          Promotion failed: {(promoteMutation.error as Error).message}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handlePreflight}
          disabled={anyRunning || !source}
          className={cn(
            'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
            'bg-muted hover:bg-muted/80 text-foreground',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {anyRunning ? (
            <span className="flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" />
              Running...
            </span>
          ) : (
            'Run Preflight'
          )}
        </button>
        <button
          type="button"
          onClick={handlePromote}
          disabled={!allPass || promoteMutation.isPending}
          className={cn(
            'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
            'bg-primary text-primary-foreground hover:bg-primary/90',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {promoteMutation.isPending ? (
            <span className="flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" />
              Promoting...
            </span>
          ) : (
            'Promote to Beta'
          )}
        </button>
      </div>
    </div>
  );
}
