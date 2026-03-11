'use client';

import type {
  ConsolidationItem,
  ConsolidationItemType,
  ConsolidationSeverity,
  MemoryFact,
} from '@agentctl/shared';
import { useQuery } from '@tanstack/react-query';
import type React from 'react';
import { useCallback, useMemo, useState } from 'react';

import type { ConsolidationAction } from '@/components/memory/ConsolidationCard';
import { ConsolidationCard } from '@/components/memory/ConsolidationCard';
import { Button } from '@/components/ui/button';
import { consolidationQuery, memoryFactsQuery, useResolveConsolidationItem } from '@/lib/queries';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CategoryFilter = 'all' | ConsolidationItemType;
type SeverityOrder = Record<ConsolidationSeverity, number>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: SeverityOrder = { high: 0, medium: 1, low: 2 };

const CATEGORY_TABS: Array<{ id: CategoryFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'contradiction', label: 'Contradictions' },
  { id: 'near-duplicate', label: 'Near-Duplicates' },
  { id: 'stale', label: 'Stale Facts' },
  { id: 'orphan', label: 'Orphan Nodes' },
];

// ---------------------------------------------------------------------------
// Category tab button
// ---------------------------------------------------------------------------

function CategoryTab({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors',
        active
          ? 'border-b-2 border-primary font-medium text-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
      aria-pressed={active}
    >
      {children}
      {count > 0 ? (
        <span
          className={cn(
            'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] tabular-nums',
            active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Empty / loading states
// ---------------------------------------------------------------------------

function EmptyQueue(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
      <div className="rounded-lg border border-dashed border-border px-10 py-10 text-center">
        <p className="text-sm font-medium text-foreground">Queue is clear</p>
        <p className="mt-1 text-xs">No consolidation issues to review in this category.</p>
      </div>
    </div>
  );
}

function LoadingSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-4">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="rounded-lg border border-border bg-card p-4 space-y-3 animate-pulse"
        >
          <div className="flex gap-2">
            <div className="h-4 w-24 rounded bg-muted" />
            <div className="h-4 w-14 rounded bg-muted" />
          </div>
          <div className="h-3 w-3/4 rounded bg-muted" />
          <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
            <div className="h-3 w-1/3 rounded bg-muted" />
            <div className="h-3 w-full rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Counter row (summary stats)
// ---------------------------------------------------------------------------

function QueueStats({ items }: { items: readonly ConsolidationItem[] }): React.JSX.Element | null {
  const high = items.filter((i) => i.severity === 'high').length;
  const medium = items.filter((i) => i.severity === 'medium').length;
  const low = items.filter((i) => i.severity === 'low').length;

  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
      <span>
        <span className="font-medium text-foreground">{items.length}</span> pending
      </span>
      {high > 0 && (
        <span className="text-red-600 dark:text-red-400">
          <span className="font-medium">{high}</span> high
        </span>
      )}
      {medium > 0 && (
        <span className="text-amber-600 dark:text-amber-400">
          <span className="font-medium">{medium}</span> medium
        </span>
      )}
      {low > 0 && (
        <span>
          <span className="font-medium">{low}</span> low
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function ConsolidationBoardView(): React.JSX.Element {
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('all');

  const consolidationResult = useQuery(consolidationQuery({ status: 'pending', limit: 100 }));
  const allItems: readonly ConsolidationItem[] = consolidationResult.data?.items ?? [];

  // Collect all fact IDs referenced by loaded items
  const allFactIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of allItems) {
      for (const fid of item.factIds) {
        ids.add(fid);
      }
    }
    return ids;
  }, [allItems]);

  // Load facts referenced by consolidation items (use a broad query, then index by ID)
  const factsResult = useQuery({
    ...memoryFactsQuery({ limit: 500 }),
    enabled: allFactIds.size > 0,
  });
  const factsById = useMemo((): ReadonlyMap<string, MemoryFact> => {
    const map = new Map<string, MemoryFact>();
    for (const fact of factsResult.data?.facts ?? []) {
      map.set(fact.id, fact);
    }
    return map;
  }, [factsResult.data]);

  // Filtered + severity-sorted items
  const filteredItems = useMemo((): readonly ConsolidationItem[] => {
    const base =
      activeCategory === 'all' ? allItems : allItems.filter((i) => i.type === activeCategory);
    return [...base].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  }, [allItems, activeCategory]);

  // Category counts (only pending)
  const categoryCount = useCallback(
    (cat: CategoryFilter): number => {
      if (cat === 'all') return allItems.length;
      return allItems.filter((i) => i.type === cat).length;
    },
    [allItems],
  );

  const resolveItem = useResolveConsolidationItem();

  const handleAction = useCallback(
    (id: string, action: ConsolidationAction) => {
      if (action === 'edit') {
        // Edit opens an inline flow — not yet implemented; skip for now
        return;
      }
      resolveItem.mutate({ id, action });
    },
    [resolveItem],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2">
        {/* Category filter tabs */}
        <div className="flex items-end gap-0">
          {CATEGORY_TABS.map((tab) => (
            <CategoryTab
              key={tab.id}
              active={activeCategory === tab.id}
              count={categoryCount(tab.id)}
              onClick={() => setActiveCategory(tab.id)}
            >
              {tab.label}
            </CategoryTab>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <QueueStats items={filteredItems} />
          <Button
            size="xs"
            variant="outline"
            onClick={() => void consolidationResult.refetch()}
            disabled={consolidationResult.isFetching}
            aria-label="Refresh consolidation queue"
          >
            {consolidationResult.isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-4 py-4">
        {consolidationResult.isLoading ? (
          <LoadingSkeleton />
        ) : filteredItems.length === 0 ? (
          <EmptyQueue />
        ) : (
          <div className="mx-auto max-w-2xl space-y-4">
            {filteredItems.map((item) => (
              <ConsolidationCard
                key={item.id}
                item={item}
                facts={item.factIds
                  .map((fid) => factsById.get(fid))
                  .filter((f): f is MemoryFact => f !== undefined)}
                factsLoading={factsResult.isLoading}
                isPending={resolveItem.isPending && resolveItem.variables?.id === item.id}
                onAction={handleAction}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
