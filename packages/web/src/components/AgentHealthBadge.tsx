'use client';

import { useQuery } from '@tanstack/react-query';
import type React from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { agentHealthQuery } from '@/lib/queries';
import { cn } from '@/lib/utils';

type AgentHealthBadgeProps = {
  agentId: string;
  className?: string;
};

const STATUS_STYLES = {
  healthy: {
    dot: 'bg-green-500',
    text: 'text-green-600 dark:text-green-400',
    bg: 'bg-green-500/10 border-green-500/20',
    label: 'Healthy',
  },
  warning: {
    dot: 'bg-yellow-500',
    text: 'text-yellow-600 dark:text-yellow-400',
    bg: 'bg-yellow-500/10 border-yellow-500/20',
    label: 'Warning',
  },
  critical: {
    dot: 'bg-red-500 animate-pulse',
    text: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-500/10 border-red-500/20',
    label: 'Critical',
  },
} as const;

function formatFailureRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function formatLastSuccess(isoString: string | null): string {
  if (!isoString) return 'Never';
  const date = new Date(isoString);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${String(diffMins)}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${String(diffHours)}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${String(diffDays)}d ago`;
}

export function AgentHealthBadge({
  agentId,
  className,
}: AgentHealthBadgeProps): React.JSX.Element | null {
  const health = useQuery(agentHealthQuery(agentId));

  // Don't render anything while loading or if healthy (avoid noise)
  if (health.isLoading || health.error) return null;
  if (!health.data) return null;

  const { consecutiveFailures, failureRate24h, lastSuccessAt, status } = health.data;

  // Don't show badge for healthy agents — no noise
  if (status === 'healthy') return null;

  const style = STATUS_STYLES[status];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-medium cursor-default',
            style.bg,
            style.text,
            className,
          )}
          data-testid="agent-health-badge"
        >
          <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', style.dot)} />
          {consecutiveFailures >= 5
            ? `${String(consecutiveFailures)} failures`
            : `${String(consecutiveFailures)} failures`}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[240px]">
        <div className="space-y-1 text-xs">
          <div className="font-medium">{style.label}</div>
          <div>
            Consecutive failures: <span className="font-mono">{consecutiveFailures}</span>
          </div>
          <div>
            Failure rate (24h):{' '}
            <span className="font-mono">{formatFailureRate(failureRate24h)}</span>
          </div>
          <div>
            Last success: <span className="font-mono">{formatLastSuccess(lastSuccessAt)}</span>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
