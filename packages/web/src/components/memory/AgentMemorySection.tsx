'use client';

import type { MemoryFact } from '@agentctl/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type React from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { memoryFactsQuery } from '@/lib/queries';
import { ConfidenceBar } from './ConfidenceBar';
import { EntityTypeBadge } from './EntityTypeBadge';

// ---------------------------------------------------------------------------
// AgentMemorySection — memory usage summary for an agent detail view
// ---------------------------------------------------------------------------

type Props = {
  agentId: string;
};

type ScopeEntry = { scope: string; count: number };

function buildScopeDistribution(facts: MemoryFact[]): ScopeEntry[] {
  const counts: Record<string, number> = {};
  for (const f of facts) {
    counts[f.scope] = (counts[f.scope] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([scope, count]) => ({ scope, count }))
    .sort((a, b) => b.count - a.count);
}

function buildTopFacts(facts: MemoryFact[]): MemoryFact[] {
  return [...facts].sort((a, b) => b.strength - a.strength).slice(0, 5);
}

export function AgentMemorySection({ agentId }: Props): React.JSX.Element {
  const { data, isLoading, error } = useQuery(memoryFactsQuery({ agentId }));
  const facts = data?.facts ?? [];

  if (isLoading) {
    return (
      <div className="space-y-3" data-testid="agent-memory-loading">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-24 rounded-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="text-sm text-red-600 dark:text-red-400"
        data-testid="agent-memory-error"
      >
        Failed to load memory: {error.message}
      </div>
    );
  }

  const scopeDistribution = buildScopeDistribution(facts);
  const topFacts = buildTopFacts(facts);
  const maxScopeCount = scopeDistribution[0]?.count ?? 1;

  return (
    <div className="space-y-5" data-testid="agent-memory-section">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-foreground">
          Memory{' '}
          <span className="font-normal text-muted-foreground">
            ({facts.length} fact{facts.length !== 1 ? 's' : ''})
          </span>
        </h3>
        <Link
          href={`/memory/browser?agentId=${encodeURIComponent(agentId)}`}
          className="text-xs text-primary hover:underline no-underline"
        >
          Browse all
        </Link>
      </div>

      {facts.length === 0 ? (
        <div className="text-sm text-muted-foreground py-2">
          No facts recorded for this agent yet.
        </div>
      ) : (
        <>
          {/* Scope distribution */}
          {scopeDistribution.length > 0 && (
            <div data-testid="agent-memory-scope-distribution">
              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Scope Distribution
              </div>
              <div className="space-y-1.5">
                {scopeDistribution.map(({ scope, count }) => (
                  <div key={scope} className="flex items-center gap-2">
                    <span className="text-[11px] font-mono text-muted-foreground w-32 truncate shrink-0">
                      {scope}
                    </span>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary/60 rounded-full transition-[width]"
                        style={{ width: `${Math.round((count / maxScopeCount) * 100)}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-muted-foreground tabular-nums w-6 text-right">
                      {count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top facts */}
          {topFacts.length > 0 && (
            <div data-testid="agent-memory-top-facts">
              <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Top Facts
              </div>
              <div className="space-y-2">
                {topFacts.map((fact) => (
                  <AgentFactRow key={fact.id} fact={fact} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AgentFactRow({ fact }: { fact: MemoryFact }): React.JSX.Element {
  return (
    <div
      className={cn(
        'rounded-md border border-border/50 bg-card/50 px-3 py-2 space-y-1.5',
        'transition-colors hover:border-border/80',
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <EntityTypeBadge entityType={fact.entity_type} className="text-[10px] py-0" />
        {fact.strength > 0 && (
          <span className="text-[10px] text-muted-foreground">
            strength {Math.round(fact.strength * 100)}%
          </span>
        )}
      </div>
      <p className="text-xs text-foreground leading-4 line-clamp-2">{fact.content}</p>
      <ConfidenceBar confidence={fact.confidence} className="mt-1" />
    </div>
  );
}
