'use client';

import type { EntityType, MemoryEdge, MemoryFact, MemoryScope } from '@agentctl/shared';
import { useQuery } from '@tanstack/react-query';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { GraphNodeDetail } from '@/components/memory/GraphNodeDetail';
import { GraphTableView } from '@/components/memory/GraphTableView';
import { Skeleton } from '@/components/ui/skeleton';
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
// SVG Knowledge Graph
// ---------------------------------------------------------------------------

const ENTITY_COLORS: Record<EntityType, string> = {
  code_artifact: '#3b82f6', // blue
  decision: '#f59e0b', // amber
  pattern: '#8b5cf6', // violet
  error: '#ef4444', // red
  person: '#22c55e', // green
  concept: '#06b6d4', // cyan
  preference: '#f97316', // orange
  skill: '#a855f7', // purple
  experience: '#14b8a6', // teal
  principle: '#eab308', // yellow
  question: '#64748b', // slate
};

const NODE_RADIUS = 20;
const LABEL_OFFSET = 28;

type GraphNode = {
  readonly id: string;
  readonly label: string;
  readonly entityType: EntityType;
  x: number;
  y: number;
  vx: number;
  vy: number;
};

type GraphEdge = {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly relation: string;
};

function useForceLayout(
  nodes: readonly MemoryFact[],
  edges: readonly MemoryEdge[],
  width: number,
  height: number,
): { layoutNodes: readonly GraphNode[]; layoutEdges: readonly GraphEdge[] } {
  // biome-ignore lint/correctness/useExhaustiveDependencies: nodes.length is intentional — avoids recomputing on unrelated referential identity changes to the array
  const layoutNodes = useMemo<GraphNode[]>(() => {
    const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
    return nodes.map((n, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const spacing = Math.min(width, height) / (cols + 1);
      return {
        id: n.id,
        label: n.content.slice(0, 20) + (n.content.length > 20 ? '…' : ''),
        entityType: n.entity_type,
        x: spacing * (col + 1) + (Math.random() - 0.5) * 20,
        y: spacing * (row + 1) + (Math.random() - 0.5) * 20,
        vx: 0,
        vy: 0,
      };
    });
  }, [nodes.length, width, height]);

  const layoutEdges = useMemo<GraphEdge[]>(
    () =>
      edges.map((e) => ({
        id: e.id,
        sourceId: e.source_fact_id,
        targetId: e.target_fact_id,
        relation: e.relation,
      })),
    [edges],
  );

  // Simple force simulation via requestAnimationFrame
  useEffect(() => {
    if (layoutNodes.length === 0 || width === 0 || height === 0) return;

    const nodeMap = new Map<string, GraphNode>(layoutNodes.map((n) => [n.id, n]));
    let animFrame: number;
    let iteration = 0;
    const MAX_ITERATIONS = 120;

    function simulate() {
      if (iteration >= MAX_ITERATIONS) return;
      iteration++;

      // Reset forces
      for (const n of layoutNodes) {
        n.vx = 0;
        n.vy = 0;
      }

      // Repulsion between all node pairs
      for (let i = 0; i < layoutNodes.length; i++) {
        for (let j = i + 1; j < layoutNodes.length; j++) {
          const a = layoutNodes[i];
          const b = layoutNodes[j];
          if (!a || !b) continue;
          const dx = b.x - a.x || 0.01;
          const dy = b.y - a.y || 0.01;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const force = 3000 / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }

      // Attraction along edges
      for (const e of layoutEdges) {
        const src = nodeMap.get(e.sourceId);
        const tgt = nodeMap.get(e.targetId);
        if (!src || !tgt) continue;
        const dx = tgt.x - src.x;
        const dy = tgt.y - src.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const ideal = 120;
        const force = (dist - ideal) * 0.05;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        src.vx += fx;
        src.vy += fy;
        tgt.vx -= fx;
        tgt.vy -= fy;
      }

      // Center gravity
      const cx = width / 2;
      const cy = height / 2;
      for (const n of layoutNodes) {
        n.vx += (cx - n.x) * 0.01;
        n.vy += (cy - n.y) * 0.01;
      }

      // Apply velocity + clamp to bounds
      const padding = NODE_RADIUS + 10;
      for (const n of layoutNodes) {
        n.x = Math.max(padding, Math.min(width - padding, n.x + n.vx));
        n.y = Math.max(padding, Math.min(height - padding, n.y + n.vy));
      }

      animFrame = requestAnimationFrame(simulate);
    }

    animFrame = requestAnimationFrame(simulate);
    return () => cancelAnimationFrame(animFrame);
  }, [layoutNodes, layoutEdges, width, height]);

  return { layoutNodes, layoutEdges };
}

type SvgGraphProps = {
  readonly nodes: readonly MemoryFact[];
  readonly edges: readonly MemoryEdge[];
  readonly selectedNodeId: string | null;
  readonly onSelectNode: (id: string | null) => void;
};

function SvgGraph({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
}: SvgGraphProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const { layoutNodes, layoutEdges } = useForceLayout(
    nodes,
    edges,
    dimensions.width,
    dimensions.height,
  );

  // Tick state to trigger re-renders during simulation
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (layoutNodes.length === 0) return;
    let frame: number;
    let count = 0;
    function loop() {
      count++;
      setTick((t) => t + 1);
      if (count < 120) frame = requestAnimationFrame(loop);
    }
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
    // tick is intentionally excluded — we just want a 120-frame animation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutNodes]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick drives nodeMap refresh so mutated positions are reflected; layoutNodes is mutated in-place by the simulation
  const nodeMap = useMemo(() => new Map(layoutNodes.map((n) => [n.id, n])), [layoutNodes, tick]);

  if (nodes.length === 0) {
    return (
      <div
        ref={containerRef}
        className="flex flex-1 items-center justify-center text-xs text-muted-foreground"
      >
        No entities to display. Adjust filters or add memory facts.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative flex-1 overflow-hidden">
      <svg
        width={dimensions.width}
        height={dimensions.height}
        className="absolute inset-0"
        aria-label="Knowledge graph visualization"
      >
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#4b5563" />
          </marker>
        </defs>

        {/* Edges */}
        <g>
          {layoutEdges.map((e) => {
            const src = nodeMap.get(e.sourceId);
            const tgt = nodeMap.get(e.targetId);
            if (!src || !tgt) return null;

            // Shorten line so it doesn't overlap the node circles
            const dx = tgt.x - src.x;
            const dy = tgt.y - src.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const ux = dx / dist;
            const uy = dy / dist;
            const x1 = src.x + ux * NODE_RADIUS;
            const y1 = src.y + uy * NODE_RADIUS;
            const x2 = tgt.x - ux * (NODE_RADIUS + 8);
            const y2 = tgt.y - uy * (NODE_RADIUS + 8);

            return (
              <g key={e.id}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="#374151"
                  strokeWidth={1.5}
                  markerEnd="url(#arrowhead)"
                />
                {dist > 60 ? (
                  <text
                    x={(x1 + x2) / 2}
                    y={(y1 + y2) / 2 - 4}
                    textAnchor="middle"
                    fontSize={9}
                    fill="#6b7280"
                    className="pointer-events-none select-none"
                  >
                    {e.relation.replace(/_/g, ' ')}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>

        {/* Nodes */}
        <g>
          {layoutNodes.map((n) => {
            const color = ENTITY_COLORS[n.entityType] ?? '#64748b';
            const isSelected = n.id === selectedNodeId;

            return (
              // biome-ignore lint/a11y/useSemanticElements: SVG <g> cannot be replaced with <button>; click handler provides interactivity
              <g
                key={n.id}
                transform={`translate(${n.x},${n.y})`}
                onClick={() => onSelectNode(isSelected ? null : n.id)}
                className="cursor-pointer"
                role="button"
                tabIndex={0}
                aria-label={`Node: ${n.label}`}
                aria-pressed={isSelected}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectNode(isSelected ? null : n.id);
                  }
                }}
              >
                {/* Glow ring for selected */}
                {isSelected ? (
                  <circle
                    r={NODE_RADIUS + 5}
                    fill="none"
                    stroke={color}
                    strokeWidth={2}
                    opacity={0.4}
                  />
                ) : null}
                <circle
                  r={NODE_RADIUS}
                  fill={color}
                  fillOpacity={0.15}
                  stroke={color}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                />
                <text
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={9}
                  fill={color}
                  className="pointer-events-none select-none font-mono"
                >
                  {n.entityType.slice(0, 3).toUpperCase()}
                </text>
                <text
                  textAnchor="middle"
                  y={LABEL_OFFSET}
                  fontSize={10}
                  fill="#d1d5db"
                  className="pointer-events-none select-none"
                >
                  {n.label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {/* Legend */}
      <div className="absolute bottom-3 left-3 flex flex-col gap-1 rounded-md border border-border bg-background/80 px-3 py-2 backdrop-blur-sm">
        <p className="mb-1 text-xs font-medium text-muted-foreground">Entity types</p>
        {(Object.entries(ENTITY_COLORS) as [EntityType, string][]).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full border"
              style={{ background: color, borderColor: color }}
            />
            <span className="text-xs text-muted-foreground">{type.replace(/_/g, ' ')}</span>
          </div>
        ))}
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
        Object.entries(graphQueryParams).filter(([, v]) => v !== undefined),
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
            <Skeleton className="h-4 w-24" data-testid="knowledge-graph-count-skeleton" />
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
          <SvgGraph
            nodes={nodes}
            edges={edges}
            selectedNodeId={selectedNodeId}
            onSelectNode={handleSelectNode}
          />
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
