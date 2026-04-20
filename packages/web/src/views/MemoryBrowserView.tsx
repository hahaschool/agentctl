'use client';

import type { EntityType, MemoryEdge, MemoryFact, MemoryScope } from '@agentctl/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type React from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';

import { BrowserDetailPanel } from '@/components/memory/BrowserDetailPanel';
import {
  BrowserFilterSidebar,
  type BrowserFilters,
} from '@/components/memory/BrowserFilterSidebar';
import { DrawerResultsSection } from '@/components/memory/DrawerResultsSection';
import { FactsList } from '@/components/memory/FactsList';
import type { FactMatchSourcePath } from '@/components/memory/MatchSourceBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  memoryFactQuery,
  memoryFactsQuery,
  useDeleteMemoryFact,
  useUpdateMemoryFact,
} from '@/lib/queries';

const PAGE_SIZE = 50;
const DELETE_PREVIEW_MAX_LENGTH = 120;

type PendingDelete =
  | { readonly kind: 'single'; readonly factId: string; readonly preview: string }
  | { readonly kind: 'bulk'; readonly factIds: ReadonlySet<string> };

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
    sessionId: searchParams.get('sessionId') ?? '',
    agentId: searchParams.get('agentId') ?? '',
    machineId: searchParams.get('machineId') ?? '',
  };
}

function filtersToSearchParams(filters: BrowserFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.scope) params.set('scope', filters.scope);
  if (filters.entityTypes.length > 0) params.set('entityTypes', filters.entityTypes.join(','));
  if (filters.minConfidence > 0) params.set('minConfidence', String(filters.minConfidence));
  if (filters.sessionId) params.set('sessionId', filters.sessionId);
  if (filters.agentId) params.set('agentId', filters.agentId);
  if (filters.machineId) params.set('machineId', filters.machineId);
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
      sessionId?: string;
      agentId?: string;
      machineId?: string;
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

    const sessionId = filters.sessionId.trim();
    const agentId = filters.agentId.trim();
    const machineId = filters.machineId.trim();

    if (sessionId) {
      params.sessionId = sessionId;
    }

    if (agentId) {
      params.agentId = agentId;
    }

    if (machineId) {
      params.machineId = machineId;
    }

    return params;
  }, [
    debouncedQ,
    filters.scope,
    filters.entityTypes,
    filters.minConfidence,
    filters.sessionId,
    filters.agentId,
    filters.machineId,
  ]);

  const factsQueryResult = useQuery(memoryFactsQuery(queryParams));
  const facts = factsQueryResult.data?.facts ?? [];
  // Build a lookup from the optional `results` enrichment so `FactsList` can
  // render match-type badges. When the CP omits `results` (ILIKE / empty-q
  // branch), the map stays undefined and rendering behaves exactly as before.
  // See docs/plans/2026-04-15-mempalace-inspired-memory-evolution-plan.md
  // Phase 7 Step 1/5.
  const sourcePathByFactId = useMemo<ReadonlyMap<string, FactMatchSourcePath> | undefined>(() => {
    const results = factsQueryResult.data?.results;
    if (!results || results.length === 0) return undefined;
    const map = new Map<string, FactMatchSourcePath>();
    for (const entry of results) {
      map.set(entry.fact.id, entry.source_path);
    }
    return map;
  }, [factsQueryResult.data?.results]);
  // Drawer-layer fusion results (MEMORY_DRAWER_FUSION=true + embedding client).
  // Usually absent; render only when the CP emits a non-empty array so the
  // existing browser layout stays identical in the common case.
  const drawerResults = factsQueryResult.data?.drawerResults;
  const hasActiveFilters =
    debouncedQ.trim().length > 0 ||
    filters.scope.length > 0 ||
    filters.entityTypes.length > 0 ||
    filters.minConfidence > 0 ||
    filters.sessionId.trim().length > 0 ||
    filters.agentId.trim().length > 0 ||
    filters.machineId.trim().length > 0;
  const showZeroFactsGuidance =
    !factsQueryResult.isLoading && !hasActiveFilters && facts.length === 0;

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

  // Delete confirmation state
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

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
              const fact = filteredFacts[i];
              if (fact) next.add(fact.id);
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
    if (selectedIds.size === 0) return;
    setPendingDelete({ kind: 'bulk', factIds: selectedIds });
  }, [selectedIds]);

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
      const fact = filteredFacts.find((f) => f.id === id);
      const preview = fact
        ? fact.content.length > DELETE_PREVIEW_MAX_LENGTH
          ? `${fact.content.slice(0, DELETE_PREVIEW_MAX_LENGTH)}...`
          : fact.content
        : id;
      setPendingDelete({ kind: 'single', factId: id, preview });
    },
    [filteredFacts],
  );

  const confirmDelete = useCallback(() => {
    if (!pendingDelete) return;

    if (pendingDelete.kind === 'single') {
      deleteFact.mutate(pendingDelete.factId);
      if (selectedFactId === pendingDelete.factId) {
        setSelectedFactId(null);
      }
    } else {
      for (const id of pendingDelete.factIds) {
        deleteFact.mutate(id);
      }
      setSelectedIds(new Set());
      if (selectedFactId && pendingDelete.factIds.has(selectedFactId)) {
        setSelectedFactId(null);
      }
    }

    setPendingDelete(null);
  }, [pendingDelete, deleteFact, selectedFactId]);

  const cancelDelete = useCallback(() => {
    setPendingDelete(null);
  }, []);

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
              <Skeleton className="h-4 w-28" data-testid="memory-browser-count-skeleton" />
            ) : (
              <>
                {filteredFacts.length} fact{filteredFacts.length !== 1 ? 's' : ''}
                {debouncedQ ? ` matching "${debouncedQ}"` : ''}
                {filteredFacts.length === 0 && !showZeroFactsGuidance && (
                  <>
                    {' · '}
                    <Link
                      href="/memory/import"
                      className="text-primary hover:underline underline-offset-2"
                    >
                      Import data from claude-mem
                    </Link>
                  </>
                )}
              </>
            )}
          </div>
        </div>
        {showZeroFactsGuidance && (
          <div className="border-b border-border px-4 py-3">
            <Card className="border-border/60">
              <CardContent className="space-y-3 p-4">
                <p className="text-sm text-muted-foreground">
                  Memory stores facts about your projects. Import from claude-mem or create facts
                  manually.
                </p>
                <Button asChild size="sm">
                  <Link href="/memory/import">Import from claude-mem</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
        <FactsList
          facts={filteredFacts}
          isLoading={factsQueryResult.isLoading}
          selectedFactId={selectedFactId}
          selectedIds={selectedIds}
          onSelectFact={handleSelectFact}
          onToggleSelection={handleToggleSelection}
          onDeleteSelected={handleDeleteSelected}
          sourcePathByFactId={sourcePathByFactId}
          className="flex-1 overflow-auto"
        />
        {drawerResults && drawerResults.length > 0 ? (
          <DrawerResultsSection drawerResults={drawerResults} />
        ) : null}
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

      {/* Delete Confirmation Dialog */}
      {pendingDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="memory-delete-title"
          data-testid="memory-delete-confirm"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="w-full max-w-sm rounded-md border border-border bg-card shadow-xl p-5">
            <h2 id="memory-delete-title" className="text-sm font-semibold text-foreground">
              {pendingDelete.kind === 'single'
                ? 'Delete this fact?'
                : `Delete ${pendingDelete.factIds.size} facts?`}
            </h2>
            <p className="mt-2 text-xs text-muted-foreground">
              {pendingDelete.kind === 'single'
                ? 'This will permanently remove the fact from memory.'
                : 'This will permanently remove the selected facts from memory.'}
            </p>
            {pendingDelete.kind === 'single' && (
              <p
                className="mt-1.5 text-[11px] font-mono text-foreground break-all line-clamp-3"
                data-testid="memory-delete-preview"
              >
                {pendingDelete.preview}
              </p>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={cancelDelete}
                disabled={deleteFact.isPending}
                data-testid="memory-delete-cancel"
                className="px-3 py-1.5 rounded-md border border-border bg-muted text-xs text-foreground hover:bg-accent/10 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleteFact.isPending}
                data-testid="memory-delete-confirm-btn"
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
              >
                {deleteFact.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
