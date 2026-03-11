'use client';

import type { EntityType, MemoryEdge, MemoryFact, MemoryScope } from '@agentctl/shared';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import type React from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';

import { BrowserDetailPanel } from '@/components/memory/BrowserDetailPanel';
import {
  BrowserFilterSidebar,
  type BrowserFilters,
} from '@/components/memory/BrowserFilterSidebar';
import { FactsList } from '@/components/memory/FactsList';
import {
  memoryFactQuery,
  memoryFactsQuery,
  useDeleteMemoryFact,
  useUpdateMemoryFact,
} from '@/lib/queries';

const PAGE_SIZE = 50;

function parseFiltersFromSearchParams(searchParams: URLSearchParams): BrowserFilters {
  const entityTypesRaw = searchParams.get('entityTypes');
  const entityTypes = entityTypesRaw
    ? (entityTypesRaw.split(',').filter(Boolean) as EntityType[])
    : [];
  const minConfidenceRaw = searchParams.get('minConfidence');
  const minConfidence = minConfidenceRaw ? Number(minConfidenceRaw) : 0;

  return {
    q: searchParams.get('q') ?? '',
    scope: searchParams.get('scope') ?? '',
    entityTypes,
    minConfidence: Number.isFinite(minConfidence) ? minConfidence : 0,
  };
}

function filtersToSearchParams(filters: BrowserFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.scope) params.set('scope', filters.scope);
  if (filters.entityTypes.length > 0) params.set('entityTypes', filters.entityTypes.join(','));
  if (filters.minConfidence > 0) params.set('minConfidence', String(filters.minConfidence));
  return params;
}

export function MemoryBrowserView(): React.JSX.Element {
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState<BrowserFilters>(() =>
    parseFiltersFromSearchParams(searchParams),
  );
  const [selectedFactId, setSelectedFactId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const lastCheckedRef = useRef<string | null>(null);

  // Debounced search query
  const [debouncedQ, setDebouncedQ] = useState(filters.q);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleFiltersChange = useCallback(
    (nextFilters: BrowserFilters) => {
      setFilters(nextFilters);

      // Debounce search text, apply other filters immediately
      if (nextFilters.q !== filters.q) {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
        }
        debounceTimerRef.current = setTimeout(() => {
          setDebouncedQ(nextFilters.q);
        }, 300);
      }

      // Sync URL state
      const params = filtersToSearchParams(nextFilters);
      const newUrl = params.toString()
        ? `${window.location.pathname}?${params}`
        : window.location.pathname;
      window.history.replaceState(null, '', newUrl);
    },
    [filters.q],
  );

  // Build query params for the API
  const queryParams = useMemo(() => {
    const params: {
      q?: string;
      scope?: MemoryScope;
      entityType?: EntityType;
      minConfidence?: number;
      limit?: number;
      offset?: number;
    } = {
      limit: PAGE_SIZE,
      offset: 0,
    };

    if (debouncedQ.trim()) {
      params.q = debouncedQ.trim();
    }

    if (filters.scope) {
      params.scope = filters.scope as MemoryScope;
    }

    // API only supports a single entity type filter; if multiple are selected, use the first one
    // and filter client-side for the rest
    if (filters.entityTypes.length === 1) {
      params.entityType = filters.entityTypes[0];
    }

    if (filters.minConfidence > 0) {
      params.minConfidence = filters.minConfidence;
    }

    return params;
  }, [debouncedQ, filters.scope, filters.entityTypes, filters.minConfidence]);

  const factsQueryResult = useQuery(memoryFactsQuery(queryParams));
  const facts = factsQueryResult.data?.facts ?? [];

  // Client-side filter for multiple entity types (API supports only one)
  const filteredFacts = useMemo(() => {
    if (filters.entityTypes.length <= 1) {
      return facts;
    }
    return facts.filter((fact) => filters.entityTypes.includes(fact.entity_type));
  }, [facts, filters.entityTypes]);

  // Detail panel data
  const detailQueryResult = useQuery({
    ...memoryFactQuery(selectedFactId ?? ''),
    enabled: !!selectedFactId,
  });
  const selectedFact = detailQueryResult.data?.fact ?? null;
  const selectedEdges: readonly MemoryEdge[] = detailQueryResult.data?.edges ?? [];

  // Mutations
  const updateFact = useUpdateMemoryFact();
  const deleteFact = useDeleteMemoryFact();

  const handleSelectFact = useCallback((fact: MemoryFact) => {
    setSelectedFactId((prev) => (prev === fact.id ? null : fact.id));
  }, []);

  const handleToggleSelection = useCallback(
    (factId: string, shiftKey: boolean) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);

        if (shiftKey && lastCheckedRef.current) {
          // Range select
          const lastIndex = filteredFacts.findIndex((f) => f.id === lastCheckedRef.current);
          const currentIndex = filteredFacts.findIndex((f) => f.id === factId);
          if (lastIndex >= 0 && currentIndex >= 0) {
            const start = Math.min(lastIndex, currentIndex);
            const end = Math.max(lastIndex, currentIndex);
            for (let i = start; i <= end; i++) {
              next.add(filteredFacts[i].id);
            }
          }
        } else if (next.has(factId)) {
          next.delete(factId);
        } else {
          next.add(factId);
        }

        lastCheckedRef.current = factId;
        return next;
      });
    },
    [filteredFacts],
  );

  const handleDeleteSelected = useCallback(() => {
    for (const id of selectedIds) {
      deleteFact.mutate(id);
    }
    setSelectedIds(new Set());
    if (selectedFactId && selectedIds.has(selectedFactId)) {
      setSelectedFactId(null);
    }
  }, [selectedIds, deleteFact, selectedFactId]);

  const handleUpdateFact = useCallback(
    (
      id: string,
      patch: {
        content?: string;
        scope?: MemoryScope;
        entityType?: EntityType;
        confidence?: number;
      },
    ) => {
      updateFact.mutate({ id, ...patch });
    },
    [updateFact],
  );

  const handleDeleteFact = useCallback(
    (id: string) => {
      deleteFact.mutate(id);
      if (selectedFactId === id) {
        setSelectedFactId(null);
      }
    },
    [deleteFact, selectedFactId],
  );

  const handleCloseDetail = useCallback(() => {
    setSelectedFactId(null);
  }, []);

  return (
    <div className="flex h-full">
      {/* Filter Sidebar */}
      <BrowserFilterSidebar
        filters={filters}
        onFiltersChange={handleFiltersChange}
        className="hidden w-56 shrink-0 lg:block"
      />

      {/* Results List */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <div className="text-sm text-muted-foreground">
            {factsQueryResult.isLoading ? (
              'Loading...'
            ) : (
              <>
                {filteredFacts.length} fact{filteredFacts.length !== 1 ? 's' : ''}
                {debouncedQ ? ` matching "${debouncedQ}"` : ''}
              </>
            )}
          </div>
        </div>
        <FactsList
          facts={filteredFacts}
          isLoading={factsQueryResult.isLoading}
          selectedFactId={selectedFactId}
          selectedIds={selectedIds}
          onSelectFact={handleSelectFact}
          onToggleSelection={handleToggleSelection}
          onDeleteSelected={handleDeleteSelected}
          className="flex-1 overflow-auto"
        />
      </div>

      {/* Detail Panel */}
      {selectedFactId ? (
        <BrowserDetailPanel
          fact={selectedFact}
          edges={selectedEdges as MemoryEdge[]}
          isLoading={detailQueryResult.isLoading}
          onClose={handleCloseDetail}
          onUpdate={handleUpdateFact}
          onDelete={handleDeleteFact}
          className="hidden w-80 shrink-0 xl:flex"
        />
      ) : null}
    </div>
  );
}
