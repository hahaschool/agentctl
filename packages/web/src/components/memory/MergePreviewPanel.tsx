'use client';

import type { MemoryFact } from '@agentctl/shared';
import type React from 'react';
import { useEffect, useState } from 'react';

import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { ConfidenceBar } from './ConfidenceBar';
import { EntityTypeBadge } from './EntityTypeBadge';
import { ScopeBadge } from './ScopeBadge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MergePreviewMode = 'near-duplicate' | 'contradiction';

export type ContradictionChoice = 'keep-a' | 'keep-b' | 'keep-both';

type Props = {
  open: boolean;
  mode: MergePreviewMode;
  facts: readonly MemoryFact[];
  /** Called when user confirms the merge (near-duplicate: survivorId, contradiction: choice) */
  onConfirm: (survivorId: string) => void;
  /** Called for contradiction "Keep both" choice */
  onKeepBoth?: () => void;
  /** Called when user cancels */
  onCancel: () => void;
  isPending?: boolean;
};

// ---------------------------------------------------------------------------
// Side-by-side fact panel
// ---------------------------------------------------------------------------

function FactColumn({
  fact,
  label,
  selected,
  onSelect,
}: {
  fact: MemoryFact;
  label: string;
  selected: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        'flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors w-full cursor-pointer',
        selected
          ? 'border-primary bg-primary/5 ring-1 ring-primary'
          : 'border-border bg-muted/20 hover:border-primary/40 hover:bg-muted/40',
      ].join(' ')}
      aria-pressed={selected}
    >
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5 items-center">
        <EntityTypeBadge entityType={fact.entity_type} />
        <ScopeBadge scope={fact.scope} />
      </div>
      <p className="font-mono text-xs leading-5 text-foreground">{fact.content}</p>
      <ConfidenceBar confidence={fact.confidence} className="max-w-[180px]" />
      {fact.tags && fact.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-0.5">
          {fact.tags.map((tag) => (
            <Badge key={tag} variant="outline" className="text-[10px] px-1 py-0">
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Merge preview — shows combined tags for near-duplicate merge
// ---------------------------------------------------------------------------

function MergeTagPreview({
  factA,
  factB,
  survivorId,
}: {
  factA: MemoryFact;
  factB: MemoryFact;
  survivorId: string | null;
}): React.JSX.Element | null {
  if (!survivorId) return null;

  const survivor = factA.id === survivorId ? factA : factB;
  const deprecated = factA.id === survivorId ? factB : factA;
  const allTags = Array.from(new Set([...(survivor.tags ?? []), ...(deprecated.tags ?? [])]));

  return (
    <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-primary">
        Merge preview
      </p>
      <p className="text-xs text-foreground leading-5">
        <span className="font-medium">Winning content:</span> {survivor.content}
      </p>
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-0.5">
          <span className="text-[10px] text-muted-foreground mr-1">Combined tags:</span>
          {allTags.map((tag) => (
            <Badge key={tag} variant="outline" className="text-[10px] px-1 py-0">
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MergePreviewPanel — public component
// ---------------------------------------------------------------------------

export function MergePreviewPanel({
  open,
  mode,
  facts,
  onConfirm,
  onKeepBoth,
  onCancel,
  isPending = false,
}: Props): React.JSX.Element {
  const [factA, factB] = facts;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Reset selection when dialog re-opens with new facts
  useEffect(() => {
    if (open) {
      setSelectedId(null);
    }
  }, [open]);

  const handleConfirm = (): void => {
    if (!selectedId) return;
    onConfirm(selectedId);
  };

  const isNearDuplicate = mode === 'near-duplicate';
  const title = isNearDuplicate ? 'Merge near-duplicate facts' : 'Resolve contradiction';
  const instruction = isNearDuplicate
    ? 'Select which fact content to keep. Tags from both will be combined.'
    : 'Select which fact to keep, or keep both.';

  const handleOpenChange = (isOpen: boolean): void => {
    if (!isOpen) onCancel();
  };

  if (!factA || !factB) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Facts not yet loaded.</p>
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">{title}</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">{instruction}</p>

        {/* Side-by-side fact columns */}
        <div className="grid grid-cols-2 gap-3" data-testid="side-by-side-facts">
          <FactColumn
            fact={factA}
            label="Fact A"
            selected={selectedId === factA.id}
            onSelect={() => setSelectedId(factA.id)}
          />
          <FactColumn
            fact={factB}
            label="Fact B"
            selected={selectedId === factB.id}
            onSelect={() => setSelectedId(factB.id)}
          />
        </div>

        {/* Near-duplicate merge preview */}
        {isNearDuplicate && <MergeTagPreview factA={factA} factB={factB} survivorId={selectedId} />}

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {isNearDuplicate ? (
            <>
              <Button
                size="sm"
                variant="default"
                disabled={isPending || !selectedId}
                onClick={handleConfirm}
                aria-label="Confirm merge"
              >
                {isPending ? 'Merging…' : 'Confirm merge'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={onCancel}
                aria-label="Cancel merge"
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="default"
                disabled={isPending || selectedId !== factA.id}
                onClick={() => onConfirm(factA.id)}
                aria-label="Keep Fact A"
              >
                {isPending ? 'Applying…' : 'Keep A'}
              </Button>
              <Button
                size="sm"
                variant="default"
                disabled={isPending || selectedId !== factB.id}
                onClick={() => onConfirm(factB.id)}
                aria-label="Keep Fact B"
              >
                {isPending ? 'Applying…' : 'Keep B'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={onKeepBoth}
                aria-label="Keep both facts"
              >
                Keep both
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={isPending}
                onClick={onCancel}
                aria-label="Cancel contradiction resolution"
              >
                Cancel
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
