'use client';

import type {
  ConsolidationItem,
  ConsolidationItemType,
  ConsolidationSeverity,
  MemoryFact,
} from '@agentctl/shared';
import type React from 'react';

import { cn } from '@/lib/utils';

import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader } from '../ui/card';
import { ConfidenceBar } from './ConfidenceBar';
import { EntityTypeBadge } from './EntityTypeBadge';
import { ScopeBadge } from './ScopeBadge';

// ---------------------------------------------------------------------------
// Issue type metadata
// ---------------------------------------------------------------------------

type IssueTypeMeta = {
  readonly label: string;
  readonly icon: string;
  readonly colorClasses: string;
};

const ISSUE_TYPE_META: Record<ConsolidationItemType, IssueTypeMeta> = {
  contradiction: {
    label: 'Contradiction',
    icon: '⚡',
    colorClasses: 'border-red-500/40 bg-red-500/5',
  },
  'near-duplicate': {
    label: 'Near-Duplicate',
    icon: '⊙',
    colorClasses: 'border-amber-500/40 bg-amber-500/5',
  },
  stale: {
    label: 'Stale Fact',
    icon: '⏱',
    colorClasses: 'border-slate-500/40 bg-slate-500/5',
  },
  orphan: {
    label: 'Orphan Node',
    icon: '◎',
    colorClasses: 'border-blue-500/40 bg-blue-500/5',
  },
};

// ---------------------------------------------------------------------------
// Severity badge
// ---------------------------------------------------------------------------

const SEVERITY_BADGE_CLASSES: Record<ConsolidationSeverity, string> = {
  high: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300',
  medium: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  low: 'border-slate-500/40 bg-slate-500/10 text-slate-600 dark:text-slate-400',
};

function SeverityBadge({ severity }: { severity: ConsolidationSeverity }): React.JSX.Element {
  return (
    <Badge
      variant="outline"
      className={cn('capitalize tracking-wide', SEVERITY_BADGE_CLASSES[severity])}
    >
      {severity}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Compact fact snippet shown inside a consolidation card
// ---------------------------------------------------------------------------

function FactSnippet({ fact }: { fact: MemoryFact }): React.JSX.Element {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2 space-y-1.5">
      <div className="flex flex-wrap gap-1.5 items-center">
        <EntityTypeBadge entityType={fact.entity_type} />
        <ScopeBadge scope={fact.scope} />
      </div>
      <p className="text-xs leading-5 text-foreground">{fact.content}</p>
      <ConfidenceBar confidence={fact.confidence} className="max-w-[200px]" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline loading skeleton for facts
// ---------------------------------------------------------------------------

function FactSkeleton(): React.JSX.Element {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2 space-y-2 animate-pulse">
      <div className="h-4 w-1/3 rounded bg-muted" />
      <div className="h-3 w-full rounded bg-muted" />
      <div className="h-2 w-1/4 rounded bg-muted" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action buttons row
// ---------------------------------------------------------------------------

type ConsolidationAction = 'accept' | 'edit' | 'skip' | 'delete';

function ActionButtons({
  itemId,
  isPending,
  onAction,
}: {
  itemId: string;
  isPending: boolean;
  onAction: (id: string, action: ConsolidationAction) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <Button
        size="xs"
        variant="default"
        disabled={isPending}
        onClick={() => onAction(itemId, 'accept')}
        aria-label="Accept suggestion"
      >
        Accept
      </Button>
      <Button
        size="xs"
        variant="outline"
        disabled={isPending}
        onClick={() => onAction(itemId, 'edit')}
        aria-label="Edit suggestion"
      >
        Edit
      </Button>
      <Button
        size="xs"
        variant="ghost"
        disabled={isPending}
        onClick={() => onAction(itemId, 'skip')}
        aria-label="Skip"
      >
        Skip
      </Button>
      <Button
        size="xs"
        variant="ghost"
        disabled={isPending}
        onClick={() => onAction(itemId, 'delete')}
        aria-label="Delete"
        className="text-destructive hover:text-destructive hover:bg-destructive/10"
      >
        Delete
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConsolidationCard — public component
// ---------------------------------------------------------------------------

export type { ConsolidationAction };

export function ConsolidationCard({
  item,
  facts,
  factsLoading = false,
  isPending = false,
  onAction,
  className,
}: {
  item: ConsolidationItem;
  /** Resolved fact objects for item.factIds (may be a subset if some are still loading). */
  facts: readonly MemoryFact[];
  factsLoading?: boolean;
  isPending?: boolean;
  onAction: (id: string, action: ConsolidationAction) => void;
  className?: string;
}): React.JSX.Element {
  const meta = ISSUE_TYPE_META[item.type];

  return (
    <Card className={cn('gap-0 rounded-lg border transition-colors', meta.colorClasses, className)}>
      <CardHeader className="px-4 pt-4 pb-3 gap-2">
        {/* Header row: icon + label + severity */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm" aria-hidden="true">
            {meta.icon}
          </span>
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {meta.label}
          </span>
          <SeverityBadge severity={item.severity} />
        </div>

        {/* Reason */}
        <p className="text-sm leading-5 text-foreground">{item.reason}</p>
      </CardHeader>

      <CardContent className="px-4 pb-4 space-y-3">
        {/* Affected facts */}
        <div className="space-y-2">
          {factsLoading
            ? item.factIds.map((fid) => <FactSkeleton key={fid} />)
            : facts.map((fact) => <FactSnippet key={fact.id} fact={fact} />)}
        </div>

        {/* AI suggestion */}
        <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
          <p className="text-xs font-medium text-primary mb-0.5">Suggested action</p>
          <p className="text-xs leading-5 text-foreground">{item.suggestion}</p>
        </div>

        {/* Action buttons */}
        <ActionButtons itemId={item.id} isPending={isPending} onAction={onAction} />
      </CardContent>
    </Card>
  );
}
