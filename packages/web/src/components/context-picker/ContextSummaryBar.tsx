'use client';

import React from 'react';
import { estimateTokenCost, formatTokens } from '@/lib/format-utils';
import { cn } from '@/lib/utils';

export type ContextSummaryBarProps = {
  selectedCount: number;
  estimatedTokens: number;
  hideToolResults: boolean;
  collapseThinking: boolean;
  onToggleHideToolResults: () => void;
  onToggleCollapseThinking: () => void;
};

export const ContextSummaryBar = React.memo(function ContextSummaryBar({
  selectedCount,
  estimatedTokens,
  hideToolResults,
  collapseThinking,
  onToggleHideToolResults,
  onToggleCollapseThinking,
}: ContextSummaryBarProps): React.ReactNode {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-muted/20">
      {/* Left: Stats */}
      <div className="text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">{selectedCount}</span> selected
        <span className="mx-1.5 text-border">|</span>
        <span className="font-medium text-foreground">{formatTokens(estimatedTokens)}</span> tokens
        <span className="mx-1.5 text-border">|</span>
        <span className="font-medium text-foreground">{`~${estimateTokenCost(estimatedTokens)}`}</span>{' '}
        est.
      </div>

      {/* Right: Toggle buttons */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onToggleHideToolResults}
          className={cn(
            'px-2 py-0.5 text-[10px] rounded-md cursor-pointer transition-colors border',
            hideToolResults
              ? 'bg-blue-500/20 text-blue-600 border-blue-500/30'
              : 'bg-muted text-muted-foreground border-border hover:text-foreground',
          )}
        >
          Hide tool results
        </button>
        <button
          type="button"
          onClick={onToggleCollapseThinking}
          className={cn(
            'px-2 py-0.5 text-[10px] rounded-md cursor-pointer transition-colors border',
            collapseThinking
              ? 'bg-blue-500/20 text-blue-600 border-blue-500/30'
              : 'bg-muted text-muted-foreground border-border hover:text-foreground',
          )}
        >
          Collapse thinking
        </button>
      </div>
    </div>
  );
});
