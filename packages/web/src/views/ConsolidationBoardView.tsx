'use client';

import type {
  ConsolidationItem,
  ConsolidationItemType,
  ConsolidationSeverity,
  MemoryFact,
} from '@agentctl/shared';
import { useQuery } from '@tanstack/react-query';
import type React from 'react';
import { useCallback, useMemo, useState } from 'react';

import type { ConsolidationAction } from '@/components/memory/ConsolidationCard';
import { ConsolidationCard } from '@/components/memory/ConsolidationCard';
import { MissingEmbeddingAlert } from '@/components/memory/MissingEmbeddingAlert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { consolidationQuery, memoryFactsQuery, useResolveConsolidationItem } from '@/lib/queries';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CategoryFilter = 'all' | ConsolidationItemType;
type SeverityOrder = Record<ConsolidationSeverity, number>;

/** State for the "Edit before accept" dialog. */
type EditDialogState = {
  /** ID of the consolidation item being accepted. */
  itemId: string;
  /** Editable merged fact text. */
  content: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEVERITY_ORDER: SeverityOrder = { high: 0, medium: 1, low: 2 };

const CATEGORY_TABS: Array<{ id: CategoryFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'contradiction', label: 'Contradictions' },
  { id: 'near-duplicate', label: 'Near-Duplicates' },
  { id: 'stale', label: 'Stale Facts' },
  { id: 'orphan', label: 'Orphan Nodes' },
];

// ---------------------------------------------------------------------------
// Category tab button
// ---------------------------------------------------------------------------

function CategoryTab({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors',
        active
          ? 'border-b-2 border-primary font-medium text-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
      aria-pressed={active}
    >
      {children}
      {count > 0 ? (
        <span
          className={cn(
            'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] tabular-nums',
            active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Empty / loading states
// ---------------------------------------------------------------------------

function EmptyQueue(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-muted-foreground">
      <div className="rounded-lg border border-dashed border-border px-10 py-10 text-center">
        <p className="text-sm font-medium text-foreground">Queue is clear</p>
        <p className="mt-1 text-xs">No consolidation issues to review in this category.</p>
      </div>
    </div>
  );
}

function LoadingSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-4">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="rounded-lg border border-border bg-card p-4 space-y-3 animate-pulse"
        >
          <div className="flex gap-2">
            <div className="h-4 w-24 rounded bg-muted" />
            <div className="h-4 w-14 rounded bg-muted" />
          </div>
          <div className="h-3 w-3/4 rounded bg-muted" />
          <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
            <div className="h-3 w-1/3 rounded bg-muted" />
            <div className="h-3 w-full rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Counter row (summary stats)
// ---------------------------------------------------------------------------

function QueueStats({ items }: { items: readonly ConsolidationItem[] }): React.JSX.Element | null {
  const high = items.filter((i) => i.severity === 'high').length;
  const medium = items.filter((i) => i.severity === 'medium').length;
  const low = items.filter((i) => i.severity === 'low').length;

  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
      <span>
        <span className="font-medium text-foreground">{items.length}</span> pending
      </span>
      {high > 0 && (
        <span className="text-red-600 dark:text-red-400">
          <span className="font-medium">{high}</span> high
        </span>
      )}
      {medium > 0 && (
        <span className="text-amber-600 dark:text-amber-400">
          <span className="font-medium">{medium}</span> medium
        </span>
      )}
      {low > 0 && (
        <span>
          <span className="font-medium">{low}</span> low
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit-before-accept dialog
// ---------------------------------------------------------------------------

function EditResolutionDialog({
  open,
  content,
  isPending,
  onContentChange,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  content: string;
  isPending: boolean;
  onContentChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Resolution Before Accepting</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          <label htmlFor="merged-fact-content" className="text-sm font-medium text-foreground">
            Merged fact content
          </label>
          <textarea
            id="merged-fact-content"
            value={content}
            onChange={(e) => onContentChange(e.target.value)}
            className={cn(
              'w-full min-h-[120px] rounded-md border border-input bg-background px-3 py-2',
              'text-sm leading-5 text-foreground placeholder:text-muted-foreground',
              'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              'resize-y disabled:cursor-not-allowed disabled:opacity-50',
            )}
            placeholder="Enter the merged fact content…"
            disabled={isPending}
            aria-label="Merged fact content"
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="default"
            onClick={onConfirm}
            disabled={isPending || content.trim().length === 0}
            aria-label="Confirm accept"
          >
            {isPending ? 'Saving…' : 'Confirm Accept'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function ConsolidationBoardView(): React.JSX.Element {
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('all');
  const [editDialog, setEditDialog] = useState<EditDialogState | null>(null);

  const consolidationResult = useQuery(consolidationQuery({ status: 'pending', limit: 100 }));
  const allItems: readonly ConsolidationItem[] = consolidationResult.data?.items ?? [];

  // Collect all fact IDs referenced by loaded items
  const allFactIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of allItems) {
      for (const fid of item.factIds) {
        ids.add(fid);
      }
    }
    return ids;
  }, [allItems]);

  // Load facts referenced by consolidation items (use a broad query, then index by ID)
  const factsResult = useQuery({
    ...memoryFactsQuery({ limit: 500 }),
    enabled: allFactIds.size > 0,
  });
  const factsById = useMemo((): ReadonlyMap<string, MemoryFact> => {
    const map = new Map<string, MemoryFact>();
    for (const fact of factsResult.data?.facts ?? []) {
      map.set(fact.id, fact);
    }
    return map;
  }, [factsResult.data]);

  // Filtered + severity-sorted items
  const filteredItems = useMemo((): readonly ConsolidationItem[] => {
    const base =
      activeCategory === 'all' ? allItems : allItems.filter((i) => i.type === activeCategory);
    return [...base].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  }, [allItems, activeCategory]);

  // Category counts (only pending)
  const categoryCount = useCallback(
    (cat: CategoryFilter): number => {
      if (cat === 'all') return allItems.length;
      return allItems.filter((i) => i.type === cat).length;
    },
    [allItems],
  );

  const resolveItem = useResolveConsolidationItem();

  /**
   * Build the initial merged text to pre-populate the dialog.
   * For near-duplicate items, concatenate the content of the two facts
   * with a separator so the user can see and edit both.
   * For other types, default to the suggestion text.
   */
  const buildInitialContent = useCallback(
    (item: ConsolidationItem): string => {
      const facts = item.factIds
        .map((fid) => factsById.get(fid))
        .filter((f): f is MemoryFact => f !== undefined);

      if (item.type === 'near-duplicate' && facts.length >= 2) {
        return facts.map((f) => f.content).join('\n\n');
      }

      const firstFact = facts[0];
      return firstFact ? firstFact.content : item.suggestion;
    },
    [factsById],
  );

  const handleAction = useCallback(
    (id: string, action: ConsolidationAction) => {
      if (action === 'accept') {
        // Find the item to get its initial content for the dialog
        const item = allItems.find((i) => i.id === id);
        if (item) {
          setEditDialog({ itemId: id, content: buildInitialContent(item) });
          return;
        }
      }
      resolveItem.mutate({ id, action });
    },
    [resolveItem, allItems, buildInitialContent],
  );

  const handleEditConfirm = useCallback(() => {
    if (!editDialog) return;
    resolveItem.mutate(
      { id: editDialog.itemId, action: 'accept', customContent: editDialog.content },
      {
        onSettled: () => setEditDialog(null),
      },
    );
  }, [resolveItem, editDialog]);

  const handleEditCancel = useCallback(() => {
    setEditDialog(null);
  }, []);

  const handleEditContentChange = useCallback((value: string) => {
    setEditDialog((prev) => (prev ? { ...prev, content: value } : null));
  }, []);

  const isDialogPending = resolveItem.isPending && resolveItem.variables?.id === editDialog?.itemId;

  return (
    <div className="flex h-full flex-col">
      {/* Edit-before-accept dialog */}
      <EditResolutionDialog
        open={editDialog !== null}
        content={editDialog?.content ?? ''}
        isPending={isDialogPending}
        onContentChange={handleEditContentChange}
        onConfirm={handleEditConfirm}
        onCancel={handleEditCancel}
      />

      <div className="border-b border-border px-4 py-3">
        <MissingEmbeddingAlert />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2">
        {/* Category filter tabs */}
        <div className="flex items-end gap-0">
          {CATEGORY_TABS.map((tab) => (
            <CategoryTab
              key={tab.id}
              active={activeCategory === tab.id}
              count={categoryCount(tab.id)}
              onClick={() => setActiveCategory(tab.id)}
            >
              {tab.label}
            </CategoryTab>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <QueueStats items={filteredItems} />
          <Button
            size="xs"
            variant="outline"
            onClick={() => void consolidationResult.refetch()}
            disabled={consolidationResult.isFetching}
            aria-label="Refresh consolidation queue"
          >
            {consolidationResult.isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-4 py-4">
        {consolidationResult.isLoading ? (
          <LoadingSkeleton />
        ) : filteredItems.length === 0 ? (
          <EmptyQueue />
        ) : (
          <div className="mx-auto max-w-2xl space-y-4">
            {filteredItems.map((item) => (
              <ConsolidationCard
                key={item.id}
                item={item}
                facts={item.factIds
                  .map((fid) => factsById.get(fid))
                  .filter((f): f is MemoryFact => f !== undefined)}
                factsLoading={factsResult.isLoading}
                isPending={resolveItem.isPending && resolveItem.variables?.id === item.id}
                onAction={handleAction}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
