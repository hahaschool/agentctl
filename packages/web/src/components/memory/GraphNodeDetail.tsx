'use client';

import type { MemoryEdge, MemoryFact } from '@agentctl/shared';
import { XIcon } from 'lucide-react';
import type React from 'react';

import type { FactTimelineResponse } from '@/lib/api';
import { cn } from '@/lib/utils';

import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { ConfidenceBar } from './ConfidenceBar';
import { EntityTypeBadge } from './EntityTypeBadge';
import { ScopeBadge } from './ScopeBadge';

function formatRelation(relation: string): string {
  return relation.replace(/_/g, ' ');
}

function formatTimelineDate(value: string | null): string {
  return value ? value.slice(0, 10) : 'open';
}

export function GraphNodeDetail({
  node,
  edges,
  isLoading,
  timeline,
  isTimelineLoading,
  onClose,
  onSelectNode,
  className,
}: {
  node: MemoryFact | null;
  edges: readonly MemoryEdge[];
  isLoading: boolean;
  timeline: FactTimelineResponse | null;
  isTimelineLoading: boolean;
  onClose: () => void;
  onSelectNode: (nodeId: string) => void;
  className?: string;
}): React.JSX.Element {
  if (!node) {
    return (
      <aside
        className={cn(
          'flex items-center justify-center border-l border-border p-8 text-muted-foreground',
          className,
        )}
      >
        <p className="text-center text-sm">
          Click a row to inspect the node and its relationships.
        </p>
      </aside>
    );
  }

  const outgoing = edges.filter((e) => e.source_fact_id === node.id);
  const incoming = edges.filter((e) => e.target_fact_id === node.id);

  return (
    <aside className={cn('flex flex-col overflow-auto border-l border-border', className)}>
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Node Detail</h3>
        <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close node detail">
          <XIcon className="size-3.5" aria-hidden="true" />
        </Button>
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      ) : (
        <div className="flex-1 space-y-5 overflow-auto p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <EntityTypeBadge entityType={node.entity_type} />
            <ScopeBadge scope={node.scope} />
          </div>

          <div className="space-y-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Content
            </h4>
            <p className="leading-6 text-foreground">{node.content}</p>
          </div>

          <Separator />

          <div className="space-y-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Confidence
            </h4>
            <ConfidenceBar confidence={node.confidence} />
          </div>

          <div className="space-y-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Strength
            </h4>
            <ConfidenceBar confidence={node.strength} />
          </div>

          <Separator />

          <div className="space-y-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Outgoing ({outgoing.length})
            </h4>
            {outgoing.length > 0 ? (
              <ul className="space-y-1.5">
                {outgoing.map((edge) => (
                  <li key={edge.id} className="rounded-md border border-border px-3 py-2">
                    <div className="text-xs font-medium capitalize">
                      {formatRelation(edge.relation)}
                    </div>
                    <button
                      type="button"
                      onClick={() => onSelectNode(edge.target_fact_id)}
                      className="font-mono text-xs text-primary underline-offset-2 hover:underline"
                      aria-label={`Navigate to target node ${edge.target_fact_id.slice(0, 8)}`}
                    >
                      {edge.target_fact_id.slice(0, 8)}…
                    </button>
                    <span className="ml-2 text-xs text-muted-foreground">
                      w={edge.weight.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">No outgoing edges.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Incoming ({incoming.length})
            </h4>
            {incoming.length > 0 ? (
              <ul className="space-y-1.5">
                {incoming.map((edge) => (
                  <li key={edge.id} className="rounded-md border border-border px-3 py-2">
                    <div className="text-xs font-medium capitalize">
                      {formatRelation(edge.relation)}
                    </div>
                    <button
                      type="button"
                      onClick={() => onSelectNode(edge.source_fact_id)}
                      className="font-mono text-xs text-primary underline-offset-2 hover:underline"
                      aria-label={`Navigate to source node ${edge.source_fact_id.slice(0, 8)}`}
                    >
                      {edge.source_fact_id.slice(0, 8)}…
                    </button>
                    <span className="ml-2 text-xs text-muted-foreground">
                      w={edge.weight.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">No incoming edges.</p>
            )}
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Timeline
              </h4>
              {timeline?.next_cursor ? (
                <span className="rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  More
                </span>
              ) : null}
            </div>

            {isTimelineLoading ? (
              <p className="text-xs text-muted-foreground">Loading timeline...</p>
            ) : timeline && timeline.events.length > 0 ? (
              <ol className="space-y-1.5">
                {timeline.events.map((event) => (
                  <li key={event.edge_id} className="rounded-md border border-border px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="capitalize">{event.direction}</span>
                      <span>{formatTimelineDate(event.effective_from)}</span>
                      <span>to</span>
                      <span>{formatTimelineDate(event.effective_until)}</span>
                    </div>
                    <div className="mt-1 text-xs font-medium capitalize">
                      {formatRelation(event.relation)}
                    </div>
                    <button
                      type="button"
                      onClick={() => onSelectNode(event.other_fact_id)}
                      className="mt-1 block max-w-full truncate text-left text-xs text-primary underline-offset-2 hover:underline"
                      aria-label={`Navigate to timeline node ${event.other_fact_id.slice(0, 8)}`}
                    >
                      {event.other_fact_preview}
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-xs text-muted-foreground">No timeline events.</p>
            )}

            {timeline && timeline.limitations.length > 0 ? (
              <p className="text-[11px] leading-4 text-muted-foreground">
                {timeline.limitations[0]}
              </p>
            ) : null}
          </div>

          <Separator />

          <div className="space-y-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Source
            </h4>
            <dl className="space-y-1 text-xs">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Session</dt>
                <dd className="font-mono">{node.source.session_id ?? 'n/a'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Agent</dt>
                <dd className="font-mono">{node.source.agent_id ?? 'n/a'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Method</dt>
                <dd className="capitalize">{node.source.extraction_method}</dd>
              </div>
            </dl>
          </div>

          <div className="pt-2 text-xs text-muted-foreground">
            <span className="font-mono">{node.id}</span>
          </div>
        </div>
      )}
    </aside>
  );
}
