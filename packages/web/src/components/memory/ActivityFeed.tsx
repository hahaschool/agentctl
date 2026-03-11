'use client';

import type { MemoryFact } from '@agentctl/shared';
import type React from 'react';

import { cn } from '@/lib/utils';

import { EntityTypeBadge } from './EntityTypeBadge';
import { ScopeBadge } from './ScopeBadge';

type ActivityItem = {
  fact: MemoryFact;
};

type Props = {
  items: readonly ActivityItem[];
  isLoading?: boolean;
  className?: string;
};

function formatRelativeTime(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffMins = Math.floor(diffMs / 60_000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function ActivityRow({ fact }: { fact: MemoryFact }): React.JSX.Element {
  return (
    <li
      data-testid={`activity-row-${fact.id}`}
      className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
    >
      {/* Confidence dot */}
      <span
        aria-hidden="true"
        className={cn(
          'mt-1.5 h-2 w-2 shrink-0 rounded-full',
          fact.confidence >= 0.8
            ? 'bg-emerald-500'
            : fact.confidence >= 0.5
              ? 'bg-amber-500'
              : 'bg-red-500',
        )}
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm leading-5 text-foreground">{fact.content}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <EntityTypeBadge entityType={fact.entity_type} />
          <ScopeBadge scope={fact.scope} />
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {formatRelativeTime(fact.created_at)}
          </span>
        </div>
      </div>
    </li>
  );
}

function LoadingSkeleton(): React.JSX.Element {
  return (
    <ul data-testid="activity-feed-loading" className="space-y-0 divide-y divide-border/40">
      {Array.from({ length: 5 }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton list
        <li key={i} className="flex items-start gap-3 py-3 first:pt-0">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-muted" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ActivityFeed({ items, isLoading = false, className }: Props): React.JSX.Element {
  if (isLoading) {
    return (
      <div className={className}>
        <LoadingSkeleton />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div
        data-testid="activity-feed-empty"
        className={cn('py-8 text-center text-sm text-muted-foreground', className)}
      >
        No recent memory activity.
      </div>
    );
  }

  return (
    <ul data-testid="activity-feed" className={cn('divide-y divide-border/40', className)}>
      {items.map(({ fact }) => (
        <ActivityRow key={fact.id} fact={fact} />
      ))}
    </ul>
  );
}
