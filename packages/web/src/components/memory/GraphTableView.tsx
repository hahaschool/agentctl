'use client';

import type {
  EntityType,
  MemoryEdge,
  MemoryFact,
  MemoryScope,
  RelationType,
} from '@agentctl/shared';
import { ArrowRightIcon, SearchIcon, XIcon } from 'lucide-react';
import type React from 'react';
import { useCallback, useMemo, useState } from 'react';

import { cn } from '@/lib/utils';

import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { ConfidenceBar } from './ConfidenceBar';
import { EntityTypeBadge } from './EntityTypeBadge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GraphTableFilters = {
  readonly q: string;
  readonly relationType: RelationType | '';
  readonly entityType: EntityType | '';
  readonly scope: string;
};

export const INITIAL_GRAPH_TABLE_FILTERS: GraphTableFilters = {
  q: '',
  relationType: '',
  entityType: '',
  scope: '',
};

const RELATION_TYPES: readonly RelationType[] = [
  'modifies',
  'depends_on',
  'caused_by',
  'resolves',
  'supersedes',
  'related_to',
  'summarizes',
];

const ENTITY_TYPES: readonly EntityType[] = [
  'code_artifact',
  'decision',
  'pattern',
  'error',
  'person',
  'concept',
  'preference',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nodeLabel(nodeId: string, nodesById: ReadonlyMap<string, MemoryFact>): string {
  const node = nodesById.get(nodeId);
  if (!node) {
    return nodeId.slice(0, 8);
  }
  const maxLen = 40;
  return node.content.length > maxLen ? `${node.content.slice(0, maxLen)}…` : node.content;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GraphTableView({
  nodes,
  edges,
  isLoading,
  selectedNodeId,
  onSelectNode,
  className,
}: {
  nodes: readonly MemoryFact[];
  edges: readonly MemoryEdge[];
  isLoading: boolean;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  className?: string;
}): React.JSX.Element {
  const [filters, setFilters] = useState<GraphTableFilters>(INITIAL_GRAPH_TABLE_FILTERS);

  const nodesById = useMemo<ReadonlyMap<string, MemoryFact>>(() => {
    return new Map(nodes.map((n) => [n.id, n]));
  }, [nodes]);

  const filteredEdges = useMemo(() => {
    return edges.filter((edge) => {
      if (filters.relationType && edge.relation !== filters.relationType) {
        return false;
      }

      const sourceNode = nodesById.get(edge.source_fact_id);
      const targetNode = nodesById.get(edge.target_fact_id);

      if (filters.entityType) {
        const matchesSource = sourceNode?.entity_type === filters.entityType;
        const matchesTarget = targetNode?.entity_type === filters.entityType;
        if (!matchesSource && !matchesTarget) {
          return false;
        }
      }

      if (filters.scope) {
        const matchesSource = sourceNode?.scope === (filters.scope as MemoryScope);
        const matchesTarget = targetNode?.scope === (filters.scope as MemoryScope);
        if (!matchesSource && !matchesTarget) {
          return false;
        }
      }

      if (filters.q.trim()) {
        const q = filters.q.trim().toLowerCase();
        const sourceContent = sourceNode?.content.toLowerCase() ?? '';
        const targetContent = targetNode?.content.toLowerCase() ?? '';
        if (!sourceContent.includes(q) && !targetContent.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [edges, filters, nodesById]);

  const hasActiveFilters =
    filters.relationType !== '' || filters.entityType !== '' || filters.scope !== '';

  const handleSearchChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setFilters((prev) => ({ ...prev, q: event.target.value }));
  }, []);

  const handleRelationTypeChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    setFilters((prev) => ({ ...prev, relationType: event.target.value as RelationType | '' }));
  }, []);

  const handleEntityTypeChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    setFilters((prev) => ({ ...prev, entityType: event.target.value as EntityType | '' }));
  }, []);

  const handleScopeChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    setFilters((prev) => ({ ...prev, scope: event.target.value }));
  }, []);

  const handleClearFilters = useCallback(() => {
    setFilters(INITIAL_GRAPH_TABLE_FILTERS);
  }, []);

  const handleRowClick = useCallback(
    (nodeId: string) => {
      onSelectNode(nodeId === selectedNodeId ? null : nodeId);
    },
    [onSelectNode, selectedNodeId],
  );

  if (isLoading) {
    return (
      <div
        className={cn('flex flex-1 items-center justify-center text-muted-foreground', className)}
      >
        <p className="text-sm">Loading graph data…</p>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <div className="relative min-w-[160px] flex-1">
          <SearchIcon
            className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            placeholder="Filter nodes…"
            value={filters.q}
            onChange={handleSearchChange}
            className="pl-9"
            aria-label="Filter graph nodes"
          />
        </div>

        <select
          aria-label="Relation type filter"
          value={filters.relationType}
          onChange={handleRelationTypeChange}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring"
        >
          <option value="">All relations</option>
          {RELATION_TYPES.map((rt) => (
            <option key={rt} value={rt}>
              {rt.replace(/_/g, ' ')}
            </option>
          ))}
        </select>

        <select
          aria-label="Entity type filter"
          value={filters.entityType}
          onChange={handleEntityTypeChange}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring"
        >
          <option value="">All entity types</option>
          {ENTITY_TYPES.map((et) => (
            <option key={et} value={et}>
              {et.replace(/_/g, ' ')}
            </option>
          ))}
        </select>

        <select
          aria-label="Scope filter"
          value={filters.scope}
          onChange={handleScopeChange}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring"
        >
          <option value="">All scopes</option>
          <option value="global">Global</option>
        </select>

        {hasActiveFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearFilters}
            className="shrink-0 gap-1.5"
          >
            <XIcon className="size-3.5" aria-hidden="true" />
            Clear
          </Button>
        ) : null}

        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {filteredEdges.length} edge{filteredEdges.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      {filteredEdges.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
          <p className="text-sm">No edges match the current filters.</p>
          {hasActiveFilters ? (
            <Button variant="ghost" size="sm" onClick={handleClearFilters}>
              Clear filters
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="overflow-auto">
          <table className="w-full text-sm" aria-label="Knowledge graph edges">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="w-8 px-2 py-2" scope="col">
                  <span className="sr-only">Arrow</span>
                </th>
                <th className="px-4 py-2 font-medium">Relation</th>
                <th className="w-8 px-2 py-2" scope="col">
                  <span className="sr-only">Arrow</span>
                </th>
                <th className="px-4 py-2 font-medium">Target</th>
                <th className="px-4 py-2 font-medium">Weight</th>
              </tr>
            </thead>
            <tbody>
              {filteredEdges.map((edge) => {
                const sourceNode = nodesById.get(edge.source_fact_id);
                const targetNode = nodesById.get(edge.target_fact_id);
                const isSourceSelected = selectedNodeId === edge.source_fact_id;
                const isTargetSelected = selectedNodeId === edge.target_fact_id;

                return (
                  <tr
                    key={edge.id}
                    className={cn(
                      'border-b border-border transition-colors',
                      (isSourceSelected || isTargetSelected) && 'bg-accent/10',
                    )}
                  >
                    {/* Source cell */}
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => handleRowClick(edge.source_fact_id)}
                        className={cn('text-left', isSourceSelected && 'text-primary')}
                        aria-label={`Select source node ${edge.source_fact_id.slice(0, 8)}`}
                      >
                        {sourceNode ? (
                          <div className="space-y-1">
                            <div className="max-w-[200px] truncate font-medium leading-snug">
                              {nodeLabel(edge.source_fact_id, nodesById)}
                            </div>
                            <EntityTypeBadge entityType={sourceNode.entity_type} />
                          </div>
                        ) : (
                          <span className="font-mono text-xs text-muted-foreground">
                            {edge.source_fact_id.slice(0, 8)}
                          </span>
                        )}
                      </button>
                    </td>

                    <td className="px-2 text-muted-foreground" aria-hidden="true">
                      <ArrowRightIcon className="size-3.5" />
                    </td>

                    {/* Relation cell */}
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-xs capitalize">
                        {edge.relation.replace(/_/g, ' ')}
                      </span>
                    </td>

                    <td className="px-2 text-muted-foreground" aria-hidden="true">
                      <ArrowRightIcon className="size-3.5" />
                    </td>

                    {/* Target cell */}
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => handleRowClick(edge.target_fact_id)}
                        className={cn('text-left', isTargetSelected && 'text-primary')}
                        aria-label={`Select target node ${edge.target_fact_id.slice(0, 8)}`}
                      >
                        {targetNode ? (
                          <div className="space-y-1">
                            <div className="max-w-[200px] truncate font-medium leading-snug">
                              {nodeLabel(edge.target_fact_id, nodesById)}
                            </div>
                            <EntityTypeBadge entityType={targetNode.entity_type} />
                          </div>
                        ) : (
                          <span className="font-mono text-xs text-muted-foreground">
                            {edge.target_fact_id.slice(0, 8)}
                          </span>
                        )}
                      </button>
                    </td>

                    {/* Weight cell */}
                    <td className="px-4 py-3">
                      <div className="w-24">
                        <ConfidenceBar confidence={edge.weight} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
