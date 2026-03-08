'use client';

import { cn } from '@/lib/utils';

export type ContextPickerToolbarProps = {
  totalMessages: number;
  selectedCount: number;
  estimatedTokens: number;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  filterType: string;
  onFilterChange: (type: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onInvert: () => void;
};

const FILTER_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'human', label: 'User' },
  { value: 'assistant', label: 'Assistant' },
  { value: 'tool_use', label: 'Tool Call' },
  { value: 'tool_result', label: 'Tool Result' },
  { value: 'thinking', label: 'Thinking' },
] as const;

function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  return `~${(tokens / 1000).toFixed(1)}k`;
}

function getTokenColorClass(tokens: number): string {
  if (tokens >= 100_000) return 'text-red-500';
  if (tokens >= 50_000) return 'text-yellow-500';
  return 'text-green-500';
}

export function ContextPickerToolbar({
  totalMessages,
  selectedCount,
  estimatedTokens,
  searchQuery,
  onSearchChange,
  filterType,
  onFilterChange,
  onSelectAll,
  onDeselectAll,
  onInvert,
}: ContextPickerToolbarProps): React.ReactNode {
  return (
    <div className="px-3 py-2 border-b border-border bg-muted/20 space-y-2">
      {/* Row 1: Search + Filter */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search messages..."
          aria-label="Search messages"
          className="flex-1 px-2.5 py-1.5 bg-muted text-foreground border border-border rounded-md text-xs outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-colors"
        />
        <select
          value={filterType}
          onChange={(e) => onFilterChange(e.target.value)}
          aria-label="Filter by type"
          className="px-2.5 py-1.5 bg-muted text-foreground border border-border rounded-md text-xs outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-colors"
        >
          {FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Row 2: Bulk action buttons */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onSelectAll}
          className="px-2 py-0.5 text-[10px] text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 border border-blue-300/50 dark:border-blue-800/50 rounded-md hover:bg-blue-100/50 dark:hover:bg-blue-900/30 cursor-pointer transition-colors"
        >
          Select All
        </button>
        <button
          type="button"
          onClick={onDeselectAll}
          className="px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground border border-border rounded-md hover:bg-muted cursor-pointer transition-colors"
        >
          Deselect All
        </button>
        <button
          type="button"
          onClick={onInvert}
          className="px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground border border-border rounded-md hover:bg-muted cursor-pointer transition-colors"
        >
          Invert
        </button>
      </div>

      {/* Row 3: Stats */}
      <div className="flex items-center text-[11px] text-muted-foreground">
        <span>{totalMessages} messages</span>
        <span className="mx-1.5 text-border">|</span>
        <span>{selectedCount} selected</span>
        <span className="mx-1.5 text-border">|</span>
        <span className={cn('font-medium', getTokenColorClass(estimatedTokens))}>
          {formatTokens(estimatedTokens)} tokens
        </span>
      </div>
    </div>
  );
}
