'use client';

import {
  ChevronDown,
  ChevronRight,
  FileEdit,
  FilePlus,
  FileText,
  FolderSearch,
  Search,
  Terminal,
  Users,
  Wrench,
} from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/utils';

const TOOL_ICONS: Record<string, React.ComponentType<{ size: number; className?: string }>> = {
  Bash: Terminal,
  Read: FileText,
  Edit: FileEdit,
  Write: FilePlus,
  Grep: Search,
  Glob: FolderSearch,
  Agent: Users,
  WebSearch: Search,
  WebFetch: Search,
  NotebookEdit: FileEdit,
  TaskCreate: FileText,
  TaskUpdate: FileText,
  TaskOutput: FileText,
};

const MAX_PREVIEW_LINES = 20;

type ToolUseBlockProps = {
  toolName?: string;
  content: string;
  isResult?: boolean;
  isError?: boolean;
  timestamp?: string;
};

export function ToolUseBlock({
  toolName,
  content,
  isResult,
  isError,
  timestamp,
}: ToolUseBlockProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const Icon = (toolName ? TOOL_ICONS[toolName] : undefined) ?? Wrench;
  const label = isResult ? 'Result' : (toolName ?? 'Tool');

  const lines = content.split('\n');
  const isLong = lines.length > MAX_PREVIEW_LINES;
  const displayContent =
    isLong && !expanded ? lines.slice(0, MAX_PREVIEW_LINES).join('\n') : content;

  const borderColor = isError
    ? 'border-l-red-500/60'
    : isResult
      ? 'border-l-neutral-500/40'
      : 'border-l-yellow-500/60';

  const bgColor = isError
    ? 'bg-red-500/[0.04]'
    : isResult
      ? 'bg-neutral-500/[0.03]'
      : 'bg-yellow-500/[0.04]';

  const textColor = isError
    ? 'text-red-600 dark:text-red-400'
    : isResult
      ? 'text-neutral-500 dark:text-neutral-400'
      : 'text-yellow-600 dark:text-yellow-400';

  if (!expanded && !isResult) {
    // Collapsed tool_use: single line preview
    const firstLine = content.split('\n')[0]?.slice(0, 150) ?? '';
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-1.5 rounded-md cursor-pointer text-left font-[inherit] border-none border-l-2',
          borderColor,
          bgColor,
        )}
      >
        <ChevronRight size={12} className={cn(textColor, 'shrink-0')} aria-hidden="true" />
        <Icon size={12} className={cn(textColor, 'shrink-0')} aria-hidden="true" />
        <span className={cn('text-[10px] font-semibold shrink-0', textColor)}>{label}</span>
        <span className="text-[11px] text-muted-foreground font-mono truncate">{firstLine}</span>
        {timestamp && (
          <span className="text-[9px] text-muted-foreground ml-auto shrink-0">{timestamp}</span>
        )}
      </button>
    );
  }

  return (
    <div className={cn('px-3 py-2 rounded-md border-l-2', borderColor, bgColor)}>
      <div className="flex justify-between items-center mb-1">
        <span className={cn('text-[11px] font-semibold flex items-center gap-1.5', textColor)}>
          {!isResult && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="bg-transparent border-none p-0 cursor-pointer"
              aria-label={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? (
                <ChevronDown size={12} className={textColor} />
              ) : (
                <ChevronRight size={12} className={textColor} />
              )}
            </button>
          )}
          <Icon size={12} aria-hidden="true" />
          {label}
        </span>
        <div className="flex gap-2 items-center">
          {timestamp && <span className="text-[9px] text-muted-foreground">{timestamp}</span>}
          {!isResult && expanded && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="text-[10px] text-primary bg-transparent border-none p-0 cursor-pointer"
            >
              collapse
            </button>
          )}
        </div>
      </div>
      <div
        className={cn(
          'text-[11px] text-foreground/80 whitespace-pre-wrap font-mono leading-relaxed overflow-auto',
          isResult && !expanded ? 'max-h-[150px]' : expanded ? 'max-h-[500px]' : 'max-h-[150px]',
        )}
      >
        {displayContent}
      </div>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-[10px] text-primary bg-transparent border-none p-0 cursor-pointer font-medium"
        >
          {expanded ? 'Show less' : `Show all (${lines.length} lines)`}
        </button>
      )}
    </div>
  );
}
