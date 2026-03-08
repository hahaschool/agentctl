'use client';

import React from 'react';
import type { SessionContentMessage } from '@/lib/api';
import { truncate } from '@/lib/format-utils';
import { getMessageStyle } from '@/lib/message-styles';
import { cn } from '@/lib/utils';

export type ContextMessageRowProps = {
  message: SessionContentMessage;
  index: number;
  checked: boolean;
  onToggle: (index: number) => void;
  onForkHere: (index: number) => void;
  onShiftClick: (index: number) => void;
  style?: React.CSSProperties;
};

function formatTime(timestamp: string): string {
  const d = new Date(timestamp);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function getContentPreview(message: SessionContentMessage): string {
  if (message.type === 'thinking') {
    return `[Thinking: ${message.content.length} chars]`;
  }
  return truncate(message.content, 120);
}

export const ContextMessageRow = React.memo(function ContextMessageRow({
  message,
  index,
  checked,
  onToggle,
  onForkHere,
  onShiftClick,
  style,
}: ContextMessageRowProps): React.ReactNode {
  const msgStyle = getMessageStyle(message.type);

  const handleCheckboxClick = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      onShiftClick(index);
    } else {
      onToggle(index);
    }
  };

  const handleForkHere = (e: React.MouseEvent) => {
    e.stopPropagation();
    onForkHere(index);
  };

  return (
    <div
      className={cn(
        'group flex items-start gap-2.5 px-2.5 py-2 rounded-md transition-colors border-l-2',
        checked
          ? 'bg-muted/50 border-l-blue-500'
          : 'border-l-transparent opacity-50 hover:bg-muted/30',
      )}
      style={style}
      data-testid={`context-row-${String(index)}`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={() => {}}
        onClick={handleCheckboxClick}
        className="mt-0.5 accent-blue-500 shrink-0 cursor-pointer"
        aria-label={`Select message ${String(index + 1)}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={cn('text-[10px] font-medium', msgStyle.textClass)}>
            {msgStyle.label}
          </span>
          {message.toolName && (
            <span className="text-[10px] text-muted-foreground font-mono">{message.toolName}</span>
          )}
          {message.timestamp && (
            <span className="text-[10px] text-muted-foreground/60 ml-auto shrink-0">
              {formatTime(message.timestamp)}
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed break-words">
          {getContentPreview(message)}
        </p>
      </div>
      <button
        type="button"
        onClick={handleForkHere}
        className="hidden group-hover:inline-flex items-center px-1.5 py-0.5 text-[10px] text-blue-600 dark:text-blue-400 border border-blue-300/50 dark:border-blue-800/50 rounded-md hover:bg-blue-100/50 dark:hover:bg-blue-900/30 cursor-pointer transition-colors shrink-0"
        aria-label={`Fork at message ${String(index + 1)}`}
      >
        Fork here
      </button>
    </div>
  );
});
