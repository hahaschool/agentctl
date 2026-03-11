'use client';

import type { EntityType, MemoryEdge, MemoryFact, MemoryScope } from '@agentctl/shared';
import { PencilIcon, Trash2Icon, XIcon } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { ConfidenceBar } from './ConfidenceBar';
import { EntityTypeBadge } from './EntityTypeBadge';
import { ScopeBadge } from './ScopeBadge';

export function BrowserDetailPanel({
  fact,
  edges,
  isLoading: _isLoading,
  onClose,
  onUpdate,
  onDelete,
  className,
}: {
  fact: MemoryFact | null;
  edges: readonly MemoryEdge[];
  isLoading: boolean;
  onClose: () => void;
  onUpdate: (
    id: string,
    patch: { content?: string; scope?: MemoryScope; entityType?: EntityType; confidence?: number },
  ) => void;
  onDelete: (id: string) => void;
  className?: string;
}): React.JSX.Element {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');

  // Reset editing state when fact changes
  useEffect(() => {
    setIsEditing(false);
    setEditContent(fact?.content ?? '');
  }, [fact?.content]);

  const handleStartEdit = useCallback(() => {
    setIsEditing(true);
    setEditContent(fact?.content ?? '');
  }, [fact?.content]);

  const handleSaveEdit = useCallback(() => {
    if (fact && editContent.trim() && editContent !== fact.content) {
      onUpdate(fact.id, { content: editContent.trim() });
    }
    setIsEditing(false);
  }, [fact, editContent, onUpdate]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditContent(fact?.content ?? '');
  }, [fact?.content]);

  const handleDelete = useCallback(() => {
    if (fact) {
      onDelete(fact.id);
    }
  }, [fact, onDelete]);

  if (!fact) {
    return (
      <aside
        className={cn(
          'flex items-center justify-center border-l border-border p-8 text-muted-foreground',
          className,
        )}
      >
        <p className="text-sm">Select a fact to view details.</p>
      </aside>
    );
  }

  return (
    <aside className={cn('flex flex-col overflow-auto border-l border-border', className)}>
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Fact Detail</h3>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-xs" onClick={handleStartEdit} aria-label="Edit fact">
            <PencilIcon className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={handleDelete} aria-label="Delete fact">
            <Trash2Icon className="size-3.5 text-destructive" />
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close detail panel">
            <XIcon className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex-1 space-y-5 p-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <EntityTypeBadge entityType={fact.entity_type} />
          <ScopeBadge scope={fact.scope} />
        </div>

        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Content
          </h4>
          {isEditing ? (
            <div className="space-y-2">
              <textarea
                value={editContent}
                onChange={(event) => setEditContent(event.target.value)}
                className="min-h-[100px] w-full rounded-md border border-input bg-background p-2 text-sm outline-none focus-visible:border-ring"
                aria-label="Edit fact content"
              />
              <div className="flex gap-2">
                <Button size="xs" onClick={handleSaveEdit}>
                  Save
                </Button>
                <Button variant="ghost" size="xs" onClick={handleCancelEdit}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <p className="leading-6 text-foreground">{fact.content}</p>
          )}
        </div>

        <Separator />

        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Confidence
          </h4>
          <ConfidenceBar confidence={fact.confidence} />
        </div>

        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Strength
          </h4>
          <ConfidenceBar confidence={fact.strength} />
        </div>

        <Separator />

        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Source
          </h4>
          <dl className="space-y-1 text-xs">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Session</dt>
              <dd className="font-mono">{fact.source.session_id ?? 'n/a'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Agent</dt>
              <dd className="font-mono">{fact.source.agent_id ?? 'n/a'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Machine</dt>
              <dd className="font-mono">{fact.source.machine_id ?? 'n/a'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Method</dt>
              <dd className="capitalize">{fact.source.extraction_method}</dd>
            </div>
          </dl>
        </div>

        <Separator />

        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Timestamps
          </h4>
          <dl className="space-y-1 text-xs">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Created</dt>
              <dd>{new Date(fact.created_at).toLocaleString()}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Last accessed</dt>
              <dd>{new Date(fact.accessed_at).toLocaleString()}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Valid from</dt>
              <dd>{new Date(fact.valid_from).toLocaleString()}</dd>
            </div>
            {fact.valid_until ? (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Valid until</dt>
                <dd>{new Date(fact.valid_until).toLocaleString()}</dd>
              </div>
            ) : null}
          </dl>
        </div>

        <Separator />

        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Relationships ({edges.length})
          </h4>
          {edges.length > 0 ? (
            <ul className="space-y-2">
              {edges.map((edge) => (
                <li key={edge.id} className="rounded-md border border-border px-3 py-2">
                  <div className="text-xs font-medium capitalize">
                    {edge.relation.replace(/_/g, ' ')}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <span className="font-mono">{edge.source_fact_id.slice(0, 8)}</span>
                    {' -> '}
                    <span className="font-mono">{edge.target_fact_id.slice(0, 8)}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">No relationships.</p>
          )}
        </div>

        <div className="pt-2 text-xs text-muted-foreground">
          <span className="font-mono">{fact.id}</span>
        </div>
      </div>
    </aside>
  );
}
