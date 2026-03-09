import React, { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import type { Session } from '../lib/api';
import { formatCost, formatDuration } from '../lib/format-utils';
import { CopyableText } from './CopyableText';
import { LiveTimeAgo } from './LiveTimeAgo';
import { PathBadge } from './PathBadge';
import { StatusBadge } from './StatusBadge';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type SessionListItemProps = {
  session: Session;
  isSelected: boolean;
  isFocused: boolean;
  onSelect: (id: string) => void;
  isChecked: boolean;
  onToggleCheck: (id: string) => void;
  /** Called with the native click event so the parent can handle shift/cmd */
  onItemClick?: (id: string, e: React.MouseEvent) => void;
};

// ---------------------------------------------------------------------------
// LiveDuration (internal helper)
// ---------------------------------------------------------------------------

function LiveDuration({
  startedAt,
  endedAt,
}: {
  startedAt: string;
  endedAt?: string | null;
}): React.JSX.Element {
  const [, setTick] = useState(0);
  const isActive = !endedAt;

  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => setTick((t) => t + 1), 1_000);
    return () => clearInterval(timer);
  }, [isActive]);

  const formatted = formatDuration(startedAt, endedAt);

  return (
    <span
      className="text-[11px] text-muted-foreground"
      title={isActive ? 'Running' : 'Total duration'}
    >
      {isActive ? `Running for ${formatted}` : `Duration: ${formatted}`}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Long-press hook for mobile
// ---------------------------------------------------------------------------

const LONG_PRESS_MS = 500;

function useLongPress(callback: () => void): {
  onTouchStart: () => void;
  onTouchEnd: () => void;
  onTouchCancel: () => void;
} {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onTouchStart = useCallback(() => {
    firedRef.current = false;
    timerRef.current = setTimeout(() => {
      firedRef.current = true;
      callback();
    }, LONG_PRESS_MS);
  }, [callback]);

  const onTouchEnd = useCallback(() => {
    clear();
  }, [clear]);

  return { onTouchStart, onTouchEnd, onTouchCancel: onTouchEnd };
}

// ---------------------------------------------------------------------------
// SessionListItem
// ---------------------------------------------------------------------------

function SessionListItemBase({
  session: s,
  isSelected,
  isFocused,
  onSelect,
  isChecked,
  onToggleCheck,
  onItemClick,
}: SessionListItemProps): React.JSX.Element {
  const meta = s.metadata;
  const errorMsg = meta?.errorMessage;
  const costUsd = meta?.costUsd;
  const messageCount = meta?.messageCount;

  const handleToggle = useCallback(() => onToggleCheck(s.id), [onToggleCheck, s.id]);
  const longPress = useLongPress(handleToggle);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // Cmd/Ctrl+click toggles check without opening detail
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        onToggleCheck(s.id);
        return;
      }
      // Shift+click or other modifier clicks are handled by parent
      if (onItemClick && (e.shiftKey || e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onItemClick(s.id, e);
        return;
      }
      if (onItemClick && e.shiftKey) {
        e.preventDefault();
        onItemClick(s.id, e);
        return;
      }
      onSelect(s.id);
    },
    [s.id, onSelect, onToggleCheck, onItemClick],
  );

  return (
    <div
      role="option"
      id={`session-${s.id}`}
      tabIndex={isFocused ? 0 : -1}
      aria-selected={isSelected}
      className={cn(
        'group flex w-full text-left border-b border-border transition-all duration-200 hover:border-border/80',
        isSelected
          ? 'bg-accent/15'
          : isFocused
            ? 'bg-accent/10 ring-1 ring-inset ring-primary/40'
            : isChecked
              ? 'bg-primary/5'
              : 'bg-transparent hover:bg-accent/8',
        s.status === 'error'
          ? 'border-l-[3px] border-l-red-500'
          : s.status === 'starting'
            ? 'border-l-[3px] border-l-yellow-500'
            : s.status === 'active'
              ? 'border-l-[3px] border-l-green-500'
              : 'border-l-[3px] border-l-transparent',
      )}
      {...longPress}
    >
      {/* Checkbox — larger tap target on mobile */}
      <div className="flex items-start pt-4 pl-2.5 shrink-0">
        <input
          type="checkbox"
          checked={isChecked}
          onChange={handleToggle}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select session ${s.id.slice(0, 16)}`}
          className="w-4 h-4 cursor-pointer"
        />
      </div>
      {/* Session card content — uses div+role instead of <button> to avoid
         invalid nested buttons (CopyableText and PathBadge render <button>). */}
      {/* biome-ignore lint/a11y/useSemanticElements: contains nested interactive children */}
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(s.id);
          }
        }}
        className="flex-1 text-left px-2.5 pr-4 py-3.5 bg-transparent border-0 cursor-pointer min-w-0"
      >
        <div className="flex justify-between items-center mb-1.5">
          <CopyableText
            value={s.id}
            maxDisplay={16}
            className="font-mono text-xs font-medium text-foreground/90"
          />
          <span className="flex items-center gap-2">
            {s.status === 'active' && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
            )}
            {s.status === 'starting' && (
              <span className="relative flex h-2 w-2">
                <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-500" />
              </span>
            )}
            <StatusBadge status={s.status} />
          </span>
        </div>
        {/* Error message for failed sessions */}
        {s.status === 'error' && errorMsg && (
          <div className="text-[11px] text-red-600 dark:text-red-400 mb-1.5 line-clamp-1">
            {errorMsg}
          </div>
        )}
        <div className="text-xs text-muted-foreground flex gap-2 items-center">
          <span className="font-medium text-foreground/70">
            {s.agentName ? s.agentName : s.agentId.slice(0, 8)}
          </span>
          <span className="text-muted-foreground/50">|</span>
          <span>{s.machineId}</span>
          <span className="text-purple-600/70 dark:text-purple-400/70 text-[11px]">
            {s.model ? s.model.replace('claude-', '').replace(/-\d{8}$/, '') : 'default'}
          </span>
        </div>
        {s.projectPath && (
          <div className="mt-1">
            <PathBadge path={s.projectPath} className="text-[11px]" />
          </div>
        )}
        <div className="text-[11px] text-muted-foreground/70 mt-1 flex gap-2.5 items-center">
          <LiveTimeAgo date={s.startedAt} />
          <LiveDuration startedAt={s.startedAt} endedAt={s.endedAt} />
          {messageCount !== undefined && <span>{messageCount} msgs</span>}
          {costUsd !== undefined && <span className="tabular-nums">{formatCost(costUsd)}</span>}
        </div>
      </div>
    </div>
  );
}

export const SessionListItem = React.memo(SessionListItemBase);
