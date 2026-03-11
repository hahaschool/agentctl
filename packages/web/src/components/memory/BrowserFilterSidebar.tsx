'use client';

import type { EntityType } from '@agentctl/shared';
import { SearchIcon, XIcon } from 'lucide-react';
import type React from 'react';
import { useCallback } from 'react';

import { cn } from '@/lib/utils';

import { Button } from '../ui/button';
import { Input } from '../ui/input';

const ENTITY_TYPES: readonly EntityType[] = [
  'code_artifact',
  'decision',
  'pattern',
  'error',
  'person',
  'concept',
  'preference',
] as const;

const SCOPE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: '', label: 'All scopes' },
  { value: 'global', label: 'Global' },
] as const;

export type BrowserFilters = {
  readonly q: string;
  readonly scope: string;
  readonly entityTypes: readonly EntityType[];
  readonly minConfidence: number;
};

export const INITIAL_FILTERS: BrowserFilters = {
  q: '',
  scope: '',
  entityTypes: [],
  minConfidence: 0,
};

export function BrowserFilterSidebar({
  filters,
  onFiltersChange,
  className,
}: {
  filters: BrowserFilters;
  onFiltersChange: (filters: BrowserFilters) => void;
  className?: string;
}): React.JSX.Element {
  const handleSearchChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onFiltersChange({ ...filters, q: event.target.value });
    },
    [filters, onFiltersChange],
  );

  const handleScopeChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      onFiltersChange({ ...filters, scope: event.target.value });
    },
    [filters, onFiltersChange],
  );

  const handleEntityTypeToggle = useCallback(
    (entityType: EntityType) => {
      const current = filters.entityTypes;
      const next = current.includes(entityType)
        ? current.filter((et) => et !== entityType)
        : [...current, entityType];
      onFiltersChange({ ...filters, entityTypes: next });
    },
    [filters, onFiltersChange],
  );

  const handleConfidenceChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onFiltersChange({ ...filters, minConfidence: Number(event.target.value) / 100 });
    },
    [filters, onFiltersChange],
  );

  const handleClearFilters = useCallback(() => {
    onFiltersChange(INITIAL_FILTERS);
  }, [onFiltersChange]);

  const hasActiveFilters =
    filters.scope !== '' || filters.entityTypes.length > 0 || filters.minConfidence > 0;

  return (
    <aside className={cn('space-y-5 border-r border-border p-4', className)}>
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Search
        </h3>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="Search facts..."
            value={filters.q}
            onChange={handleSearchChange}
            className="pl-9"
            aria-label="Search facts"
          />
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Scope
        </h3>
        <select
          aria-label="Scope filter"
          value={filters.scope}
          onChange={handleScopeChange}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring"
        >
          {SCOPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Entity Type
        </h3>
        <div className="space-y-1">
          {ENTITY_TYPES.map((entityType) => {
            const isChecked = filters.entityTypes.includes(entityType);
            return (
              <label
                key={entityType}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-accent/10"
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => handleEntityTypeToggle(entityType)}
                  className="size-3.5 rounded border-input accent-primary"
                />
                <span className="capitalize">{entityType.replace(/_/g, ' ')}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Min Confidence
        </h3>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(filters.minConfidence * 100)}
            onChange={handleConfidenceChange}
            className="h-2 w-full cursor-pointer accent-primary"
            aria-label="Minimum confidence"
          />
          <span className="min-w-[3ch] text-right text-xs tabular-nums text-muted-foreground">
            {Math.round(filters.minConfidence * 100)}%
          </span>
        </div>
      </div>

      {hasActiveFilters ? (
        <Button variant="ghost" size="sm" onClick={handleClearFilters} className="w-full gap-1.5">
          <XIcon className="size-3.5" />
          Clear filters
        </Button>
      ) : null}
    </aside>
  );
}
