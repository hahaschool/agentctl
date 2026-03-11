'use client';

import type { MemoryEdge, MemoryFact } from '@agentctl/shared';
import type React from 'react';

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet';
import { ConfidenceBar } from './ConfidenceBar';
import { EntityTypeBadge } from './EntityTypeBadge';
import { ScopeBadge } from './ScopeBadge';

export function FactDetailPanel({
  fact,
  edges = [],
  open,
  onOpenChange,
}: {
  fact: MemoryFact | null;
  edges?: MemoryEdge[];
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
                <li>Session: {fact.source.session_id ?? 'n/a'}</li>
                <li>Agent: {fact.source.agent_id ?? 'n/a'}</li>
                <li>Machine: {fact.source.machine_id ?? 'n/a'}</li>
              </ul>
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
