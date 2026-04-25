'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import type React from 'react';
import { useCallback, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import type { FactTimelineEvent } from '@/lib/api/memory';
import { formatDate, formatDateTime } from '@/lib/format-utils';
import { factTimelineQuery } from '@/lib/queries';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

type DirectionBadgeProps = { direction: 'incoming' | 'outgoing' };

function DirectionBadge({ direction }: DirectionBadgeProps): React.JSX.Element {
  return (
    <Badge
      variant="outline"
      className={
        direction === 'incoming'
          ? 'border-blue-500/40 text-blue-400'
          : 'border-emerald-500/40 text-emerald-400'
      }
    >
      {direction}
    </Badge>
  );
}

type TimeRangeProps = { from: string; until: string | null };

function TimeRange({ from, until }: TimeRangeProps): React.JSX.Element {
  return (
    <span className="tabular-nums text-xs text-muted-foreground">
      {formatDateTime(from)}
      {until ? ` → ${formatDateTime(until)}` : ' → still active'}
    </span>
  );
}

type EventRowProps = { event: FactTimelineEvent };

function EventRow({ event }: EventRowProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-card/50 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <DirectionBadge direction={event.direction} />
        <span className="font-mono text-xs text-primary">{event.relation}</span>
        <span className="text-xs text-muted-foreground">→</span>
        <span
          className="max-w-xs truncate text-sm text-foreground"
          title={event.other_fact_preview}
        >
          {event.other_fact_preview}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3 pl-0">
        <span className="font-mono text-xs text-muted-foreground" title="Other fact ID">
          {event.other_fact_id}
        </span>
        <TimeRange from={event.effective_from} until={event.effective_until} />
      </div>
    </div>
  );
}

function LoadingSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-3">
      <Skeleton className="h-24 w-full rounded-lg" />
      <Skeleton className="h-14 w-full rounded-lg" />
      <Skeleton className="h-14 w-full rounded-lg" />
      <Skeleton className="h-14 w-full rounded-lg" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function MemoryTimelineView(): React.JSX.Element {
  const searchParams = useSearchParams();

  const [entityId, setEntityId] = useState<string>(searchParams.get('entity') ?? '');
  const [asOf, setAsOf] = useState<string>(searchParams.get('as_of') ?? '');
  const [committedEntity, setCommittedEntity] = useState<string>(searchParams.get('entity') ?? '');
  const [committedAsOf, setCommittedAsOf] = useState<string>(searchParams.get('as_of') ?? '');
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  const query = useQuery(
    factTimelineQuery({
      entity: committedEntity,
      asOf: committedAsOf || undefined,
      limit: 20,
      cursor,
    }),
  );

  const handleSearch = useCallback(() => {
    setCursor(undefined);
    setCommittedEntity(entityId.trim());
    setCommittedAsOf(asOf.trim());
  }, [entityId, asOf]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleSearch();
    },
    [handleSearch],
  );

  const handleLoadMore = useCallback(() => {
    if (query.data?.next_cursor) {
      setCursor(query.data.next_cursor);
    }
  }, [query.data?.next_cursor]);

  const timeline = query.data;
  const isLoading = query.isLoading;
  const isError = query.isError;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border bg-card/30 px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight">Memory Timeline</h1>
        <p className="text-sm text-muted-foreground">
          Inspect the temporal edge history of a memory fact.
        </p>
      </div>

      {/* Controls */}
      <div className="border-b border-border bg-card/20 px-6 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="timeline-entity-input" className="text-xs text-muted-foreground">
              Fact ID
            </Label>
            <Input
              id="timeline-entity-input"
              aria-label="Fact ID"
              placeholder="e.g. fact-abc123"
              className="h-8 w-72 font-mono text-sm"
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="timeline-as-of-input" className="text-xs text-muted-foreground">
              As of (ISO datetime, optional)
            </Label>
            <Input
              id="timeline-as-of-input"
              aria-label="As of datetime"
              placeholder="e.g. 2026-04-01T00:00:00Z"
              className="h-8 w-56 font-mono text-sm"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>
          <Button
            size="sm"
            onClick={handleSearch}
            disabled={!entityId.trim()}
            aria-label="Load timeline"
          >
            Load
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {/* Empty state */}
        {!committedEntity && (
          <div
            className="flex h-48 flex-col items-center justify-center gap-2 text-center text-muted-foreground"
            data-testid="timeline-empty"
          >
            <span className="text-sm">Enter a fact ID above to load its timeline.</span>
          </div>
        )}

        {/* Loading */}
        {committedEntity && isLoading && <LoadingSkeleton />}

        {/* Error */}
        {committedEntity && isError && (
          <div
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            data-testid="timeline-error"
            role="alert"
          >
            Failed to load timeline. The fact ID may not exist or be unreachable.
          </div>
        )}

        {/* Results */}
        {timeline && (
          <div className="space-y-4" data-testid="timeline-results">
            {/* Limitations warning */}
            {timeline.limitations.length > 0 && (
              <div
                className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-2 text-xs text-yellow-400"
                data-testid="timeline-limitations"
                role="note"
              >
                <span className="font-medium">Limitations: </span>
                {timeline.limitations.join(' · ')}
              </div>
            )}

            {/* Entity card */}
            <Card data-testid="timeline-entity-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Fact</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="text-foreground">{timeline.entity.content_preview}</p>
                <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    <span className="font-medium text-foreground/70">ID: </span>
                    <span className="font-mono">{timeline.entity.resolved_fact_id}</span>
                  </span>
                  {timeline.entity.confidence !== null && (
                    <span>
                      <span className="font-medium text-foreground/70">Confidence: </span>
                      {Math.round(timeline.entity.confidence * 100)}%
                    </span>
                  )}
                  {timeline.entity.active_at_as_of !== null && (
                    <span>
                      <span className="font-medium text-foreground/70">Active as of: </span>
                      {timeline.entity.active_at_as_of ? 'yes' : 'no'}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/70">Valid: </span>
                  <TimeRange
                    from={timeline.entity.valid_from}
                    until={timeline.entity.valid_until}
                  />
                </div>
                {timeline.as_of && (
                  <div className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/70">Snapshot as of: </span>
                    {formatDate(timeline.as_of)}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Events */}
            <div className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Edge events ({timeline.events.length})
              </h2>

              {timeline.events.length === 0 && (
                <div
                  className="rounded-lg border border-border px-4 py-6 text-center text-sm text-muted-foreground"
                  data-testid="timeline-no-events"
                >
                  No edge events found for this fact.
                </div>
              )}

              {timeline.events.map((event) => (
                <EventRow key={event.edge_id} event={event} />
              ))}
            </div>

            {/* Pagination */}
            {timeline.next_cursor && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLoadMore}
                  disabled={isLoading}
                  data-testid="timeline-load-more"
                >
                  Load more
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
