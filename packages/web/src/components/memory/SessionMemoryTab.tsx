'use client';

import type { MemoryFact } from '@agentctl/shared';
import { useQuery } from '@tanstack/react-query';
import type React from 'react';
import { useMemo, useState } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { memoryFactQuery, memoryFactsQuery } from '@/lib/queries';
import { ConfidenceBar } from './ConfidenceBar';
import { EntityTypeBadge } from './EntityTypeBadge';
import { FactDetailPanel } from './FactDetailPanel';

// ---------------------------------------------------------------------------
// SessionMemoryTab — memory facts associated with a session
// ---------------------------------------------------------------------------

type Props = {
  sessionId: string;
};

export function SessionMemoryTab({ sessionId }: Props): React.JSX.Element {
  const [selectedFactId, setSelectedFactId] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery(memoryFactsQuery({ sessionId }));
  const facts = data?.facts ?? [];
  const selectedFactFallback = useMemo(
    () => facts.find((fact) => fact.id === selectedFactId) ?? null,
    [facts, selectedFactId],
  );
  const detailQuery = useQuery({
    ...memoryFactQuery(selectedFactId ?? ''),
    enabled: !!selectedFactId,
  });
  const selectedFact = detailQuery.data?.fact ?? selectedFactFallback;
  const selectedEdges = detailQuery.data?.edges ?? [];
  const selectedSourcePreviews = detailQuery.data?.sourcePreviews;

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
    <>
      <div className="space-y-2" data-testid="session-memory-facts">
        {facts.map((fact) => (
          <FactRow
            key={fact.id}
            fact={fact}
            selected={fact.id === selectedFactId}
            onSelect={() => setSelectedFactId(fact.id)}
          />
        ))}
      </div>
      <FactDetailPanel
        fact={selectedFact}
        edges={selectedEdges}
        sourcePreviews={selectedSourcePreviews}
        open={selectedFactId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedFactId(null);
          }
        }}
      />
    </>
  );
}

function FactRow({
  fact,
  selected,
  onSelect,
}: {
  fact: MemoryFact;
  selected: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full rounded-md border border-border/50 bg-card/50 px-3 py-2 text-left transition-colors hover:border-border/80 hover:bg-card data-[selected=true]:border-primary/60 data-[selected=true]:bg-accent/10"
      data-selected={selected || undefined}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <EntityTypeBadge entityType={fact.entity_type} className="text-[10px] py-0" />
        <span className="text-[10px] font-mono text-muted-foreground">{fact.scope}</span>
      </div>
      <p className="text-xs text-foreground leading-4 line-clamp-3">{fact.content}</p>
      <ConfidenceBar confidence={fact.confidence} className="mt-1" />
    </button>
  );
}
