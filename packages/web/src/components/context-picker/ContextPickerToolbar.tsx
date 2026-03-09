'use client';

import React from 'react';
import { formatTokens } from '@/lib/format-utils';
import { cn } from '@/lib/utils';

export type ContextPickerToolbarProps = {
  totalMessages: number;
  selectedCount: number;
  estimatedTokens: number;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  memoryQuery?: string;
  onMemoryQueryChange?: (query: string) => void;
  filterType: string;
  onFilterChange: (type: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onInvert: () => void;
  // Smart select callbacks
  onSelectKeyDecisions?: () => void;
  onSelectByTopic?: (topic: string) => void;
};

const FILTER_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'human', label: 'User' },
  { value: 'assistant', label: 'Assistant' },
  { value: 'tool_use', label: 'Tool Call' },
  { value: 'tool_result', label: 'Tool Result' },
  { value: 'thinking', label: 'Thinking' },
] as const;

function getTokenColorClass(tokens: number): string {
  if (tokens >= 100_000) return 'text-red-500';
  if (tokens >= 50_000) return 'text-yellow-500';
  return 'text-green-500';
}

const TopicInput = React.memo(function TopicInput({
  onSubmit,
}: {
  onSubmit: (topic: string) => void;
}): React.ReactNode {
  const [showInput, setShowInput] = React.useState(false);
  const [value, setValue] = React.useState('');

  return showInput ? (
    <input
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && value.trim()) {
          onSubmit(value.trim());
          setValue('');
          setShowInput(false);
        }
        if (e.key === 'Escape') {
          setValue('');
          setShowInput(false);
        }
      }}
      onBlur={() => {
        if (!value.trim()) setShowInput(false);
      }}
      placeholder="e.g., authentication"
      aria-label="Topic to search for"
      className="px-2 py-0.5 text-xs border border-purple-300/50 dark:border-purple-800/50 rounded-md bg-purple-500/5 text-foreground outline-none focus:ring-1 focus:ring-purple-500/30 w-36"
    />
  ) : (
    <button
      type="button"
      onClick={() => setShowInput(true)}
      aria-label="Select messages by topic"
      className="px-2 py-0.5 text-[10px] text-purple-600 dark:text-purple-400 border border-purple-300/50 dark:border-purple-800/50 rounded-md hover:bg-purple-100/50 dark:hover:bg-purple-900/30 cursor-pointer transition-colors"
    >
      By Topic
    </button>
  );
});

export const ContextPickerToolbar = React.memo(function ContextPickerToolbar({
  totalMessages,
  selectedCount,
  estimatedTokens,
  searchQuery,
  onSearchChange,
  memoryQuery,
  onMemoryQueryChange,
  filterType,
  onFilterChange,
  onSelectAll,
  onDeselectAll,
  onInvert,
  onSelectKeyDecisions,
  onSelectByTopic,
}: ContextPickerToolbarProps): React.ReactNode {
  return (
    <div className="px-3 py-2 border-b border-border bg-muted/20 space-y-2">
      {/* Row 1: Message search + filter */}
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

      {/* Row 2: Memory search */}
      {onMemoryQueryChange && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={memoryQuery ?? ''}
            onChange={(e) => onMemoryQueryChange(e.target.value)}
            placeholder="Search memories..."
            aria-label="Search memories"
            className="flex-1 px-2.5 py-1.5 bg-purple-500/5 text-foreground border border-purple-300/30 rounded-md text-xs outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500/40 transition-colors"
          />
        </div>
      )}

      {/* Row 3: Bulk action buttons */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onSelectAll}
          aria-label="Select all messages"
          className="px-2 py-0.5 text-[10px] text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 border border-blue-300/50 dark:border-blue-800/50 rounded-md hover:bg-blue-100/50 dark:hover:bg-blue-900/30 cursor-pointer transition-colors"
        >
          Select All
        </button>
        <button
          type="button"
          onClick={onDeselectAll}
          aria-label="Deselect all messages"
          className="px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground border border-border rounded-md hover:bg-muted cursor-pointer transition-colors"
        >
          Deselect All
        </button>
        <button
          type="button"
          onClick={onInvert}
          aria-label="Invert message selection"
          className="px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground border border-border rounded-md hover:bg-muted cursor-pointer transition-colors"
        >
          Invert
        </button>
      </div>

      {/* Row 4: Smart select tools */}
      {(onSelectKeyDecisions || onSelectByTopic) && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-muted-foreground mr-0.5">Smart:</span>
          {onSelectKeyDecisions && (
            <button
              type="button"
              onClick={onSelectKeyDecisions}
              aria-label="Auto-select key decisions"
              className="px-2 py-0.5 text-[10px] text-purple-600 dark:text-purple-400 border border-purple-300/50 dark:border-purple-800/50 rounded-md hover:bg-purple-100/50 dark:hover:bg-purple-900/30 cursor-pointer transition-colors"
            >
              Key Decisions
            </button>
          )}
          {onSelectByTopic && <TopicInput onSubmit={onSelectByTopic} />}
        </div>
      )}

      {/* Row 5: Stats */}
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
});
