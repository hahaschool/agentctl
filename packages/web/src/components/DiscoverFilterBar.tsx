'use client';

import type React from 'react';

type MinMessages = 0 | 1 | 5 | 10 | 50;
type SortOption = 'recent' | 'messages' | 'project';
type GroupMode = 'project' | 'machine' | 'flat';

const MIN_MESSAGE_OPTIONS: { label: string; value: MinMessages }[] = [
  { label: 'All', value: 0 },
  { label: '1+', value: 1 },
  { label: '5+', value: 5 },
  { label: '10+', value: 10 },
  { label: '50+', value: 50 },
];

const SORT_OPTIONS: { label: string; value: SortOption }[] = [
  { label: '\u2193 Recent activity', value: 'recent' },
  { label: '\u2193 Most messages', value: 'messages' },
  { label: '\u2191 Project name', value: 'project' },
];

export type { MinMessages, SortOption, GroupMode };

type DiscoverFilterBarProps = {
  searchRef: React.RefObject<HTMLInputElement | null>;
  search: string;
  onSearchChange: (value: string) => void;
  minMessages: MinMessages;
  onMinMessagesChange: (value: MinMessages) => void;
  sort: SortOption;
  onSortChange: (value: SortOption) => void;
  hostnames: string[];
  machineFilter: string;
  onMachineFilterChange: (value: string) => void;
  groupMode: GroupMode;
  onGroupModeChange: (value: GroupMode) => void;
  allExpanded: boolean;
  onToggleAll: () => void;
};

export function DiscoverFilterBar({
  searchRef,
  search,
  onSearchChange,
  minMessages,
  onMinMessagesChange,
  sort,
  onSortChange,
  hostnames,
  machineFilter,
  onMachineFilterChange,
  groupMode,
  onGroupModeChange,
  allExpanded,
  onToggleAll,
}: DiscoverFilterBarProps): React.JSX.Element {
  return (
    <div className="flex gap-3 items-center flex-wrap px-4 py-3 bg-card border border-border/50 rounded-lg mb-4">
      <div className="relative flex-1 min-w-[140px]">
        <input
          ref={searchRef}
          id="discover-search"
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search sessions..."
          aria-label="Search sessions"
          className="w-full px-2.5 py-1.5 pr-10 bg-background text-foreground border border-border rounded-md text-[13px] outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
        />
        {!search && (
          <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 px-1 py-px text-[9px] font-mono text-muted-foreground/40 bg-muted border border-border/50 rounded pointer-events-none">
            /
          </kbd>
        )}
      </div>
      <label htmlFor="discover-min-msgs" className="flex items-center gap-1.5 text-[13px]">
        <span className="text-muted-foreground">Min msgs:</span>
        <select
          id="discover-min-msgs"
          value={minMessages}
          onChange={(e) => onMinMessagesChange(Number(e.target.value) as MinMessages)}
          aria-label="Minimum message count"
          className="px-2 py-[5px] bg-background text-foreground border border-border rounded-md text-[13px] focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
        >
          {MIN_MESSAGE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor="discover-sort" className="flex items-center gap-1.5 text-[13px]">
        <span className="text-muted-foreground">Sort:</span>
        <select
          id="discover-sort"
          value={sort}
          onChange={(e) => onSortChange(e.target.value as SortOption)}
          aria-label="Sort order"
          className="px-2 py-[5px] bg-background text-foreground border border-border rounded-md text-[13px] focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
      {/* Machine filter */}
      {hostnames.length > 1 && (
        <label htmlFor="discover-machine" className="flex items-center gap-1.5 text-[13px]">
          <span className="text-muted-foreground">Machine:</span>
          <select
            id="discover-machine"
            value={machineFilter}
            onChange={(e) => onMachineFilterChange(e.target.value)}
            className="px-2 py-[5px] bg-background text-foreground border border-border rounded-md text-[13px] focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
          >
            <option value="all">All ({hostnames.length})</option>
            {hostnames.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </label>
      )}
      {/* Group by toggle */}
      <label htmlFor="discover-group" className="flex items-center gap-1.5 text-[13px]">
        <span className="text-muted-foreground">Group:</span>
        <select
          id="discover-group"
          value={groupMode}
          onChange={(e) => onGroupModeChange(e.target.value as GroupMode)}
          aria-label="Group by"
          className="px-2 py-[5px] bg-background text-foreground border border-border rounded-md text-[13px] focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
        >
          <option value="project">By Project</option>
          <option value="machine">By Machine</option>
          <option value="flat">Flat List</option>
        </select>
      </label>
      {groupMode !== 'flat' && (
        <button
          type="button"
          onClick={onToggleAll}
          aria-label={allExpanded ? 'Collapse all groups' : 'Expand all groups'}
          className="py-[5px] px-3 bg-muted text-muted-foreground border border-border rounded-md text-xs cursor-pointer whitespace-nowrap transition-colors hover:bg-muted/80 focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
        >
          {allExpanded ? 'Collapse All' : 'Expand All'}
        </button>
      )}
    </div>
  );
}
