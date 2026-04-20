import type { MemoryFact, MemorySearchResult } from '@agentctl/shared';
import type React from 'react';

import { cn } from '@/lib/utils';

import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { ConfidenceBar } from './ConfidenceBar';
import { EntityTypeBadge } from './EntityTypeBadge';
import { type FactMatchSourcePath, MatchSourceBadge } from './MatchSourceBadge';
import { ScopeBadge } from './ScopeBadge';

// `MemorySearchResult['source_path']` is the canonical union for the "why this
// matched" badge — keep this alias in sync with the control-plane envelope.
export type FactCardSourcePath = MemorySearchResult['source_path'];

export function FactCard({
  fact,
  selected = false,
  sourcePath,
  onSelect,
  className,
}: {
  fact: MemoryFact;
  selected?: boolean;
  sourcePath?: FactMatchSourcePath;
  onSelect?: (fact: MemoryFact) => void;
  className?: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onSelect?.(fact)}
      className={cn('block w-full text-left', className)}
      aria-pressed={selected}
    >
      <Card
        className={cn(
          'gap-4 rounded-lg border transition-colors hover:border-primary/40 hover:bg-accent/5',
          selected && 'border-primary/50 bg-accent/10',
        )}
      >
        <CardHeader className="gap-3 px-4 pt-4 pb-0">
          <div className="flex flex-wrap items-center gap-2">
            <EntityTypeBadge entityType={fact.entity_type} />
            <ScopeBadge scope={fact.scope} />
            {sourcePath ? <MatchSourceBadge sourcePath={sourcePath} /> : null}
          </div>
          <CardTitle className="text-sm leading-6">{fact.content}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 px-4 pb-4">
          <ConfidenceBar confidence={fact.confidence} />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Agent: {fact.source.agent_id ?? 'n/a'}</span>
            <span>Session: {fact.source.session_id ?? 'n/a'}</span>
            <span>Updated: {new Date(fact.accessed_at).toLocaleString()}</span>
          </div>
        </CardContent>
      </Card>
    </button>
  );
}
