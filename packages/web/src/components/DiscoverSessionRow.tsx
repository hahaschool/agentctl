'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import type { DiscoveredSession } from '../lib/api';
import { formatNumber, recencyColorClass } from '../lib/format-utils';
import { CopyableText } from './CopyableText';
import { HighlightText } from './HighlightText';
import { LiveTimeAgo } from './LiveTimeAgo';
import { SimpleTooltip } from './SimpleTooltip';

/** Compute a human-readable recency label directly from a date string. */
function recencyTitle(dateStr: string): string {
  if (!dateStr) return 'Older';
  const diff = Date.now() - new Date(dateStr).getTime();
  const oneHour = 60 * 60 * 1000;
  const oneDay = 24 * oneHour;
  if (diff < oneHour) return 'Active in last hour';
  if (diff < oneDay) return 'Active today';
  return 'Older';
}

function sanitizeSummary(summary: string): string {
  const trimmed = summary.trim();
  if (!trimmed) return '';
  if (typeof document === 'undefined') return trimmed;

  const template = document.createElement('template');
  template.innerHTML = trimmed;
  for (const node of template.content.querySelectorAll(
    'script,style,noscript,iframe,object,embed',
  )) {
    node.remove();
  }

  return (template.content.textContent ?? '').replace(/\s+/g, ' ').trim();
}

type DiscoverSessionRowProps = {
  session: DiscoveredSession;
  isFlat: boolean;
  isSelected: boolean;
  isResuming: boolean;
  isImported: boolean;
  isChecked: boolean;
  isImporting: boolean;
  search: string;
  resumePrompt: string;
  onResumePromptChange: (value: string) => void;
  onSelect: (sessionId: string) => void;
  onToggleCheck: (sessionId: string) => void;
  onImport: (session: DiscoveredSession) => void;
  onStartResume: (sessionId: string) => void;
  onSubmitResume: (session: DiscoveredSession) => void;
  onCancelResume: () => void;
};

export const DiscoverSessionRow = React.memo(function DiscoverSessionRow({
  session: s,
  isFlat,
  isSelected,
  isResuming,
  isImported,
  isChecked,
  isImporting,
  search,
  resumePrompt,
  onResumePromptChange,
  onSelect,
  onToggleCheck,
  onImport,
  onStartResume,
  onSubmitResume,
  onCancelResume,
}: DiscoverSessionRowProps): React.JSX.Element {
  const dotClass = recencyColorClass(s.lastActivity);
  const sanitizedSummary = sanitizeSummary(s.summary);
  const displaySummary = sanitizedSummary || 'Untitled';

  return (
    <div key={`${s.machineId}-${s.sessionId}`}>
      <div
        className={cn(
          'w-full flex items-center gap-3 border-b border-border transition-colors duration-100 text-left text-foreground font-[inherit]',
          'border-t-0 border-r-0',
          isFlat ? 'px-4 py-2 min-h-[44px]' : 'py-2 pr-4 pl-[44px] min-h-[44px]',
          isSelected
            ? 'bg-muted border-l-[3px] border-l-primary'
            : 'bg-background border-l-[3px] border-l-transparent hover:bg-accent/10',
        )}
      >
        {/* Selection checkbox */}
        <input
          type="checkbox"
          checked={isChecked}
          disabled={isImported}
          onChange={() => onToggleCheck(s.sessionId)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select session ${s.sessionId.slice(0, 8)}`}
          className={cn(
            'shrink-0 w-3.5 h-3.5 accent-primary cursor-pointer',
            isImported && 'opacity-30 cursor-not-allowed',
          )}
        />

        {/* Clickable session content */}
        <button
          type="button"
          onClick={() => onSelect(s.sessionId)}
          className="flex-1 flex items-center gap-3 min-w-0 cursor-pointer bg-transparent border-none p-0 text-left text-foreground font-[inherit]"
        >
          {/* Recency dot — wrapped in 44x44 touch target */}
          <span
            className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] shrink-0"
            title={recencyTitle(s.lastActivity)}
          >
            <span
              className={cn('w-[7px] h-[7px] rounded-full inline-block', dotClass)}
              aria-hidden="true"
            />
          </span>

          {/* Summary */}
          <SimpleTooltip content={displaySummary}>
            <span className="flex-1 text-[13px] font-medium text-foreground overflow-hidden text-ellipsis whitespace-nowrap min-w-0">
              <HighlightText text={displaySummary} highlight={search} />
            </span>
          </SimpleTooltip>
        </button>

        {/* Runtime badge */}
        {s.runtime ? (
          <span
            className={cn(
              'text-[10px] px-1.5 py-0.5 rounded shrink-0 whitespace-nowrap',
              s.runtime === 'codex'
                ? 'bg-green-500/10 text-green-400'
                : 'bg-blue-500/10 text-blue-400',
            )}
          >
            {s.runtime === 'claude-code' ? 'Claude' : 'Codex'}
          </span>
        ) : (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-700 text-neutral-400 shrink-0 whitespace-nowrap">
            Unknown
          </span>
        )}

        {/* Message count */}
        <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
          {formatNumber(s.messageCount)} msgs
        </span>

        {/* Branch badge */}
        {s.branch && (
          <SimpleTooltip content={`Branch: ${s.branch}`}>
            <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-mono text-green-500 bg-green-500/10 border border-green-500/20 px-1.5 py-px rounded-md whitespace-nowrap shrink-0 max-w-[140px] overflow-hidden text-ellipsis">
              <svg
                className="w-3 h-3 shrink-0"
                viewBox="0 0 16 16"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.5 2.5 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z" />
              </svg>
              {s.branch}
            </span>
          </SimpleTooltip>
        )}

        {/* Imported badge */}
        {isImported && (
          <span className="hidden sm:inline text-[10px] font-medium text-green-600 dark:text-green-400 bg-green-600/10 border border-green-600/20 px-1.5 py-px rounded-md whitespace-nowrap shrink-0">
            Imported
          </span>
        )}

        {/* Hostname */}
        <span className="hidden sm:inline text-[11px] font-mono text-muted-foreground bg-muted px-1.5 py-px rounded-md whitespace-nowrap shrink-0">
          {s.hostname}
        </span>

        {/* Last activity */}
        <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0 min-w-[60px] text-right">
          <LiveTimeAgo date={s.lastActivity} />
        </span>

        {/* Session ID (copyable) */}
        <span className="hidden md:inline">
          <CopyableText value={s.sessionId} />
        </span>

        {/* Import button */}
        {!isImported && !isResuming && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onImport(s);
            }}
            disabled={isImporting}
            aria-label={`Import session ${s.sessionId.slice(0, 8)}`}
            className={cn(
              'px-2.5 py-1 min-h-[32px] bg-muted text-muted-foreground border border-border rounded-md text-[11px] font-medium cursor-pointer whitespace-nowrap shrink-0 transition-colors hover:bg-muted/80 focus:ring-2 focus:ring-primary/20 focus:border-primary/40',
              isImporting && 'opacity-50 cursor-not-allowed',
            )}
          >
            {isImporting ? 'Importing...' : 'Import'}
          </button>
        )}

        {/* Resume button */}
        {!isResuming && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onStartResume(s.sessionId);
            }}
            aria-label={`Resume session ${s.sessionId.slice(0, 8)}`}
            className="px-2.5 py-1 bg-primary text-white rounded-md text-[11px] font-medium border-none cursor-pointer whitespace-nowrap shrink-0 transition-colors hover:bg-primary/90 focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
          >
            Resume
          </button>
        )}
      </div>

      {/* Inline resume input */}
      {isResuming && (
        <div
          className={cn(
            'flex gap-1.5 bg-card border-b border-border',
            isFlat ? 'px-4 py-1.5' : 'py-1.5 pr-4 pl-[44px]',
          )}
        >
          <input
            type="text"
            value={resumePrompt}
            onChange={(e) => onResumePromptChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSubmitResume(s);
              if (e.key === 'Escape') onCancelResume();
            }}
            placeholder="Enter prompt to resume..."
            aria-label="Prompt to resume session"
            className="flex-1 px-2.5 py-[5px] bg-background text-foreground border border-border rounded-md text-xs outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
          />
          <button
            type="button"
            onClick={() => onSubmitResume(s)}
            disabled={!resumePrompt.trim()}
            aria-label="Submit resume prompt"
            className={cn(
              'py-[5px] px-3 bg-primary text-white rounded-md text-xs border-none cursor-pointer transition-colors hover:bg-primary/90 focus:ring-2 focus:ring-primary/20 focus:border-primary/40',
              !resumePrompt.trim() && 'opacity-50',
            )}
          >
            Go
          </button>
          <button
            type="button"
            onClick={onCancelResume}
            aria-label="Cancel resume"
            className="py-[5px] px-2.5 bg-muted text-muted-foreground border border-border rounded-md text-xs cursor-pointer transition-colors hover:bg-muted/80 focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
});
