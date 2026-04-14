'use client';

import type { EntityType } from '@agentctl/shared';
import { SearchIcon, XIcon } from 'lucide-react';
import type React from 'react';
import { useCallback } from 'react';

import { cn } from '@/lib/utils';

import { Badge } from '../ui/badge';
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
  readonly sessionId: string;
  readonly agentId: string;
  readonly machineId: string;
};

export const INITIAL_FILTERS: BrowserFilters = {
  q: '',
  scope: '',
  entityTypes: [],
  minConfidence: 0,
  sessionId: '',
  agentId: '',
  machineId: '',
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

  const handleSessionIdChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onFiltersChange({ ...filters, sessionId: event.target.value });
    },
    [filters, onFiltersChange],
  );

  const handleAgentIdChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onFiltersChange({ ...filters, agentId: event.target.value });
    },
    [filters, onFiltersChange],
  );

  const handleMachineIdChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onFiltersChange({ ...filters, machineId: event.target.value });
    },
    [filters, onFiltersChange],
  );

  const handleClearFilters = useCallback(() => {
    onFiltersChange(INITIAL_FILTERS);
  }, [onFiltersChange]);

  const hasActiveFilters =
    filters.q !== '' ||
    filters.scope !== '' ||
    filters.entityTypes.length > 0 ||
    filters.minConfidence > 0 ||
    filters.sessionId !== '' ||
    filters.agentId !== '' ||
    filters.machineId !== '';

  return (
    <aside className={cn('space-y-5 border-r border-border p-4', className)}>
      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Search
        </h3>
        <div className="relative">
          <SearchIcon
            className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground"
            aria-hidden="true"
          />
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
        <div className="flex flex-wrap gap-2">
          {ENTITY_TYPES.map((entityType) => {
            const isChecked = filters.entityTypes.includes(entityType);
            const label = entityType.replace(/_/g, ' ');
            return (
              <Badge
                key={entityType}
                asChild
                variant={isChecked ? 'default' : 'outline'}
                className={cn(
                  'px-0 py-0',
                  !isChecked &&
                    'border-border/70 bg-background/50 text-muted-foreground hover:bg-accent/10 hover:text-foreground',
                )}
              >
                <button
                  type="button"
                  onClick={() => handleEntityTypeToggle(entityType)}
                  aria-pressed={isChecked}
                  aria-label={`Toggle entity type: ${label}`}
                  className="cursor-pointer rounded-full px-2 py-0.5 capitalize"
                >
                  {label}
                </button>
              </Badge>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Min Confidence
          </h3>
          <Badge variant="outline" className="text-[11px] tabular-nums">
            {Math.round(filters.minConfidence * 100)}%
          </Badge>
        </div>
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
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Provenance
        </h3>
        <Input
          value={filters.sessionId}
          onChange={handleSessionIdChange}
          placeholder="Session ID"
          aria-label="Session ID filter"
        />
        <Input
          value={filters.agentId}
          onChange={handleAgentIdChange}
          placeholder="Agent ID"
          aria-label="Agent ID filter"
        />
        <Input
          value={filters.machineId}
          onChange={handleMachineIdChange}
          placeholder="Machine ID"
          aria-label="Machine ID filter"
        />
      </div>

      {hasActiveFilters ? (
        <Button variant="ghost" size="sm" onClick={handleClearFilters} className="w-full gap-1.5">
          <XIcon className="size-3.5" aria-hidden="true" />
          Clear filters
        </Button>
      ) : null}
    </aside>
  );
}
