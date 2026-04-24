'use client';

import type { MemoryEdge, MemoryFact, MemoryFactSourcePreview } from '@agentctl/shared';
import type React from 'react';
import { useMemo, useState } from 'react';
import { truncate } from '@/lib/format-utils';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet';
import { ConfidenceBar } from './ConfidenceBar';
import { EntityTypeBadge } from './EntityTypeBadge';
import { ScopeBadge } from './ScopeBadge';

const MOBILE_SOURCE_PREVIEW_MAX_LENGTH = 120;

function normalizeSourcePreviewText(text: string | null): string {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim();
}

function SourcePreviewCard({ preview }: { preview: MemoryFactSourcePreview }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const quotePreview = useMemo(
    () => normalizeSourcePreviewText(preview.quote_preview),
    [preview.quote_preview],
  );
  const fullText =
    preview.status === 'archived'
      ? 'Archived drawer content unavailable.'
      : quotePreview || 'Preview unavailable.';
  const canExpand =
    preview.status === 'available' && fullText.length > MOBILE_SOURCE_PREVIEW_MAX_LENGTH;
  const displayText =
    canExpand && !expanded ? truncate(fullText, MOBILE_SOURCE_PREVIEW_MAX_LENGTH) : fullText;

  return (
    <li className="rounded-md border border-border px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span className="font-mono text-foreground break-all [overflow-wrap:anywhere]">
          {preview.drawer_topic}
        </span>
        <span className="font-mono">chunk {preview.drawer_chunk_index}</span>
        <span className="font-mono">{preview.drawer_source_type}</span>
        {preview.status === 'archived' ? (
          <span className="rounded border border-amber-500/40 px-1.5 py-0.5 font-mono uppercase tracking-wide text-amber-300">
            Archived
          </span>
        ) : null}
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-foreground [overflow-wrap:anywhere]">
        {displayText}
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-muted-foreground">
        <span>
          {preview.start_offset}-{preview.end_offset}
        </span>
        {canExpand ? (
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? 'Show less' : 'Show full snippet'}
          </button>
        ) : null}
      </div>
    </li>
  );
}

export function FactDetailPanel({
  fact,
  edges = [],
  sourcePreviews,
  open,
  onOpenChange,
}: {
  fact: MemoryFact | null;
  edges?: MemoryEdge[];
  sourcePreviews?: readonly MemoryFactSourcePreview[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Memory Fact</SheetTitle>
          <SheetDescription>
            {fact ? 'Inspect the selected memory fact and its relationships.' : 'No fact selected.'}
          </SheetDescription>
        </SheetHeader>
        {fact ? (
          <div className="space-y-6 px-4 pb-6 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <EntityTypeBadge entityType={fact.entity_type} />
              <ScopeBadge scope={fact.scope} />
            </div>
            <div className="space-y-2">
              <h3 className="font-medium">Content</h3>
              <p className="leading-6 text-foreground">{fact.content}</p>
            </div>
            <div className="space-y-2">
              <h3 className="font-medium">Confidence</h3>
              <ConfidenceBar confidence={fact.confidence} />
            </div>
            <div className="space-y-2">
              <h3 className="font-medium">Source</h3>
              <ul className="space-y-1 text-muted-foreground">
                <li className="break-all [overflow-wrap:anywhere]">
                  Session: {fact.source.session_id ?? 'n/a'}
                </li>
                <li className="break-all [overflow-wrap:anywhere]">
                  Agent: {fact.source.agent_id ?? 'n/a'}
                </li>
                <li className="break-all [overflow-wrap:anywhere]">
                  Machine: {fact.source.machine_id ?? 'n/a'}
                </li>
              </ul>
            </div>
            <div className="space-y-2">
              <h3 className="font-medium">Evidence ({sourcePreviews?.length ?? 0})</h3>
              {sourcePreviews && sourcePreviews.length > 0 ? (
                <ul className="space-y-2">
                  {sourcePreviews.map((preview) => (
                    <SourcePreviewCard
                      key={`${preview.drawer_id}:${preview.start_offset}:${preview.end_offset}`}
                      preview={preview}
                    />
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">No supporting drawer evidence.</p>
              )}
            </div>
            <div className="space-y-2">
              <h3 className="font-medium">Relationships</h3>
              {edges.length > 0 ? (
                <ul className="space-y-2">
                  {edges.map((edge) => (
                    <li key={edge.id} className="rounded-md border border-border px-3 py-2">
                      <div className="font-medium">{edge.relation.replace(/_/g, ' ')}</div>
                      <div className="text-xs text-muted-foreground">
                        {edge.source_fact_id} → {edge.target_fact_id}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">No relationships yet.</p>
              )}
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
