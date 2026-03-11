'use client';

import type { MemoryFact } from '@agentctl/shared';
import { useQuery } from '@tanstack/react-query';
import type React from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { memoryFactsQuery } from '@/lib/queries';
import { ConfidenceBar } from './ConfidenceBar';
import { EntityTypeBadge } from './EntityTypeBadge';

// ---------------------------------------------------------------------------
// SessionMemoryTab — memory facts associated with a session
// ---------------------------------------------------------------------------

type Props = {
  sessionId: string;
};

export function SessionMemoryTab({ sessionId }: Props): React.JSX.Element {
  const { data, isLoading, error } = useQuery(memoryFactsQuery({ sessionId }));
  const facts = data?.facts ?? [];

  if (isLoading) {
    return (
      <div className="space-y-3" data-testid="session-memory-loading">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={`sk-${String(i)}`} className="h-20 rounded-lg" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-red-600 dark:text-red-400" data-testid="session-memory-error">
        Failed to load memory facts: {error.message}
      </div>
    );
  }

  if (facts.length === 0) {
    return (
      <div
        className="text-sm text-muted-foreground py-4 text-center"
        data-testid="session-memory-empty"
      >
        No memory facts recorded for this session yet.
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="session-memory-facts">
      {facts.map((fact) => (
        <FactRow key={fact.id} fact={fact} />
      ))}
    </div>
  );
}

function FactRow({ fact }: { fact: MemoryFact }): React.JSX.Element {
  return (
    <div className="rounded-md border border-border/50 bg-card/50 px-3 py-2 space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <EntityTypeBadge entityType={fact.entity_type} className="text-[10px] py-0" />
        <span className="text-[10px] font-mono text-muted-foreground">{fact.scope}</span>
      </div>
      <p className="text-xs text-foreground leading-4 line-clamp-3">{fact.content}</p>
      <ConfidenceBar confidence={fact.confidence} className="mt-1" />
    </div>
  );
}
