'use client';

import type { EntityType, MemoryEdge, MemoryFact, MemoryScope } from '@agentctl/shared';
import { useQuery } from '@tanstack/react-query';
import type React from 'react';
import { useCallback, useState } from 'react';

import { GraphNodeDetail } from '@/components/memory/GraphNodeDetail';
import { GraphTableView } from '@/components/memory/GraphTableView';
import { memoryFactQuery, memoryGraphQuery } from '@/lib/queries';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ViewMode = 'table' | 'graph';

type GraphFilters = {
  readonly scope: MemoryScope | '';
  readonly entityType: EntityType | '';
  readonly limit: number;
};

const INITIAL_FILTERS: GraphFilters = {
  scope: '',
  entityType: '',
  limit: 200,
};

// ---------------------------------------------------------------------------
// Graph placeholder
// ---------------------------------------------------------------------------

function GraphPlaceholder(): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
      <div className="rounded-lg border border-dashed border-border px-8 py-12 text-center">
        <p className="text-sm font-medium">Interactive Graph View</p>
        <p className="mt-1 max-w-xs text-xs">
          Install{' '}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
            react-force-graph-2d
          </code>{' '}
          to enable the force-directed graph visualization. Switch to{' '}
          <span className="font-medium text-foreground">Table</span> to browse relationships now.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// View switcher tab
// ---------------------------------------------------------------------------

function ViewTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-3 py-1.5 text-sm transition-colors',
        active
          ? 'border-b-2 border-primary font-medium text-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function KnowledgeGraphView(): React.JSX.Element {
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [filters, setFilters] = useState<GraphFilters>(INITIAL_FILTERS);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const graphQueryParams = {
    scope: filters.scope as MemoryScope | undefined,
    entityType: filters.entityType as EntityType | undefined,
    limit: filters.limit,
  };

  const graphQuery = useQuery(
    memoryGraphQuery(
      Object.fromEntries(
        Object.entries(graphQueryParams).filter(([, v]) => v !== '' && v !== undefined),
      ) as Parameters<typeof memoryGraphQuery>[0],
    ),
  );

  const nodes: readonly MemoryFact[] = graphQuery.data?.nodes ?? [];
  const edges: readonly MemoryEdge[] = graphQuery.data?.edges ?? [];

  const nodeDetailQuery = useQuery({
    ...memoryFactQuery(selectedNodeId ?? ''),
    enabled: !!selectedNodeId,
  });

  const selectedNode = nodeDetailQuery.data?.fact ?? null;
  const selectedNodeEdges: readonly MemoryEdge[] = nodeDetailQuery.data?.edges ?? [];

  const handleSwitchToTable = useCallback(() => setViewMode('table'), []);
  const handleSwitchToGraph = useCallback(() => setViewMode('graph'), []);

  const handleSelectNode = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const handleLimitChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    setFilters((prev) => ({ ...prev, limit: Number(event.target.value) }));
  }, []);

  const handleScopeChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    setFilters((prev) => ({ ...prev, scope: event.target.value as MemoryScope | '' }));
  }, []);

  const handleEntityTypeChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    setFilters((prev) => ({ ...prev, entityType: event.target.value as EntityType | '' }));
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Header toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2">
        {/* View mode tabs */}
        <div className="flex items-end gap-0.5">
          <ViewTab active={viewMode === 'table'} onClick={handleSwitchToTable}>
            Table
          </ViewTab>
          <ViewTab active={viewMode === 'graph'} onClick={handleSwitchToGraph}>
            Graph
          </ViewTab>
        </div>

        <div className="ml-2 h-5 w-px bg-border" />

        {/* Global graph filters */}
        <select
          aria-label="Scope filter"
          value={filters.scope}
          onChange={handleScopeChange}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs shadow-xs outline-none focus-visible:border-ring"
        >
          <option value="">All scopes</option>
          <option value="global">Global</option>
        </select>

        <select
          aria-label="Entity type filter"
          value={filters.entityType}
          onChange={handleEntityTypeChange}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs shadow-xs outline-none focus-visible:border-ring"
        >
          <option value="">All entity types</option>
          <option value="code_artifact">Code artifact</option>
          <option value="decision">Decision</option>
          <option value="pattern">Pattern</option>
          <option value="error">Error</option>
          <option value="person">Person</option>
          <option value="concept">Concept</option>
          <option value="preference">Preference</option>
        </select>

        <select
          aria-label="Node limit"
          value={filters.limit}
          onChange={handleLimitChange}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs shadow-xs outline-none focus-visible:border-ring"
        >
          <option value={50}>50 nodes</option>
          <option value={100}>100 nodes</option>
          <option value={200}>200 nodes</option>
          <option value={500}>500 nodes</option>
        </select>

        <span className="ml-auto text-xs text-muted-foreground">
          {graphQuery.isLoading ? (
            'Loading…'
          ) : (
            <>
              {nodes.length} node{nodes.length !== 1 ? 's' : ''}, {edges.length} edge
              {edges.length !== 1 ? 's' : ''}
            </>
          )}
        </span>
      </div>

      {/* Content area */}
      <div className="flex min-h-0 flex-1">
        {viewMode === 'table' ? (
          <GraphTableView
            nodes={nodes}
            edges={edges}
            isLoading={graphQuery.isLoading}
            selectedNodeId={selectedNodeId}
            onSelectNode={handleSelectNode}
            className="flex-1 overflow-auto"
          />
        ) : (
          <GraphPlaceholder />
        )}

        {selectedNodeId ? (
          <GraphNodeDetail
            node={selectedNode}
            edges={selectedNodeEdges as MemoryEdge[]}
            isLoading={nodeDetailQuery.isLoading}
            onClose={handleCloseDetail}
            onSelectNode={(nodeId) => handleSelectNode(nodeId)}
            className="hidden w-80 shrink-0 xl:flex"
          />
        ) : null}
      </div>
    </div>
  );
}
