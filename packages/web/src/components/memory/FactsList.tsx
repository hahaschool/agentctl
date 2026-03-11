'use client';

import type { MemoryFact } from '@agentctl/shared';
import { Trash2Icon } from 'lucide-react';
import type React from 'react';
import { useCallback } from 'react';

import { cn } from '@/lib/utils';

import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import { ConfidenceBar } from './ConfidenceBar';
import { EntityTypeBadge } from './EntityTypeBadge';
import { ScopeBadge } from './ScopeBadge';

export function FactsList({
  facts,
  isLoading,
  selectedFactId,
  selectedIds,
  onSelectFact,
  onToggleSelection,
  onDeleteSelected,
  className,
}: {
  facts: readonly MemoryFact[];
  isLoading: boolean;
  selectedFactId: string | null;
  selectedIds: ReadonlySet<string>;
  onSelectFact: (fact: MemoryFact) => void;
  onToggleSelection: (factId: string, shiftKey: boolean) => void;
  onDeleteSelected: () => void;
  className?: string;
}): React.JSX.Element {
  if (isLoading) {
    return (
      <div className={cn('space-y-2 p-4', className)}>
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
    );
  }

  if (facts.length === 0) {
    return (
      <div className={cn('flex items-center justify-center p-12 text-muted-foreground', className)}>
        <p className="text-sm">No facts found matching your filters.</p>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col', className)}>
      {selectedIds.size > 0 ? (
        <div className="flex items-center gap-3 border-b border-border bg-accent/5 px-4 py-2">
          <span className="text-sm text-muted-foreground">{selectedIds.size} selected</span>
          <Button variant="destructive" size="xs" onClick={onDeleteSelected} className="gap-1">
            <Trash2Icon className="size-3" />
            Delete
          </Button>
        </div>
      ) : null}
      <div className="divide-y divide-border overflow-auto">
        {facts.map((fact) => (
          <FactRow
            key={fact.id}
            fact={fact}
            isSelected={selectedFactId === fact.id}
            isChecked={selectedIds.has(fact.id)}
            onSelect={onSelectFact}
            onToggleCheck={onToggleSelection}
          />
        ))}
      </div>
    </div>
  );
}

function FactRow({
  fact,
  isSelected,
  isChecked,
  onSelect,
  onToggleCheck,
}: {
  fact: MemoryFact;
  isSelected: boolean;
  isChecked: boolean;
  onSelect: (fact: MemoryFact) => void;
  onToggleCheck: (factId: string, shiftKey: boolean) => void;
}): React.JSX.Element {
  const handleCheckboxChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onToggleCheck(fact.id, event.nativeEvent instanceof MouseEvent && event.nativeEvent.shiftKey);
    },
    [fact.id, onToggleCheck],
  );

  const handleRowClick = useCallback(() => {
    onSelect(fact);
  }, [fact, onSelect]);

  return (
    <div
      className={cn(
        'flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-accent/5',
        isSelected && 'bg-accent/10 border-l-2 border-l-primary',
      )}
      data-selected={isSelected || undefined}
    >
      <input
        type="checkbox"
        checked={isChecked}
        onChange={handleCheckboxChange}
        className="mt-1 size-3.5 shrink-0 rounded border-input accent-primary"
        aria-label={`Select fact: ${fact.content.slice(0, 40)}`}
      />
      <button
        type="button"
        onClick={handleRowClick}
        className="min-w-0 flex-1 space-y-1.5 text-left"
        aria-label={`View fact: ${fact.content.slice(0, 60)}`}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <EntityTypeBadge entityType={fact.entity_type} />
          <ScopeBadge scope={fact.scope} />
        </div>
        <p className="text-sm leading-5 line-clamp-2">{fact.content}</p>
        <div className="flex items-center gap-4">
          <ConfidenceBar confidence={fact.confidence} className="max-w-32" />
          <span className="text-xs text-muted-foreground">
            {new Date(fact.created_at).toLocaleDateString()}
          </span>
        </div>
      </button>
    </div>
  );
}
