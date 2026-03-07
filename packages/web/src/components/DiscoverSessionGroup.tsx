'use client';

import type React from 'react';
import { cn } from '@/lib/utils';
import type { DiscoveredSession } from '../lib/api';
import { formatNumber, shortenPath } from '../lib/format-utils';
import type { GroupMode } from './DiscoverFilterBar';
import { DiscoverSessionRow } from './DiscoverSessionRow';
import { LiveTimeAgo } from './LiveTimeAgo';

export type SessionGroup = {
  projectPath: string;
  projectName: string;
  sessions: DiscoveredSession[];
  totalMessages: number;
  latestActivity: string;
};

type DiscoverSessionGroupProps = {
  group: SessionGroup;
  groupMode: GroupMode;
  isCollapsed: boolean;
  onToggleGroup: (path: string) => void;
  // Session row state
  selectedSessionId: string | null;
  resumingSessionId: string | null;
  resumePrompt: string;
  onResumePromptChange: (value: string) => void;
  importedSessionIds: Set<string>;
  selectedIds: Set<string>;
  importingSessionId: string | null;
  search: string;
  onSelectSession: (sessionId: string) => void;
  onToggleCheck: (sessionId: string) => void;
  onImport: (session: DiscoveredSession) => void;
  onStartResume: (sessionId: string) => void;
  onSubmitResume: (session: DiscoveredSession) => void;
  onCancelResume: () => void;
};

export function DiscoverSessionGroup({
  group,
  groupMode,
  isCollapsed,
  onToggleGroup,
  selectedSessionId,
  resumingSessionId,
  resumePrompt,
  onResumePromptChange,
  importedSessionIds,
  selectedIds,
  importingSessionId,
  search,
  onSelectSession,
  onToggleCheck,
  onImport,
  onStartResume,
  onSubmitResume,
  onCancelResume,
}: DiscoverSessionGroupProps): React.JSX.Element {
  const isFlat = group.projectPath === '__flat__';

  return (
    <div className="border border-border/50 rounded-lg overflow-hidden transition-colors hover:border-border">
      {/* Group header (hidden in flat mode) */}
      {!isFlat && (
        <button
          type="button"
          onClick={() => onToggleGroup(group.projectPath)}
          aria-expanded={!isCollapsed}
          className={cn(
            'w-full flex items-center gap-3 px-4 py-2.5 bg-card border-none cursor-pointer text-left text-foreground transition-colors hover:bg-accent/5 focus:ring-2 focus:ring-primary/20 focus:ring-inset',
            !isCollapsed && 'border-b border-border',
          )}
        >
          <span
            className={cn(
              'text-xs inline-block w-4 text-center shrink-0 transition-transform duration-150',
              isCollapsed && '-rotate-90',
            )}
          >
            {'\u25BC'}
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm leading-5">{group.projectName}</div>
            {groupMode === 'machine' ? (
              <div className="font-mono text-[11px] text-muted-foreground leading-4">
                {new Set(group.sessions.map((s) => s.projectPath)).size} project(s)
              </div>
            ) : (
              <span className="font-mono text-[11px] text-muted-foreground leading-4 overflow-hidden text-ellipsis whitespace-nowrap block">
                {shortenPath(group.projectPath)}
              </span>
            )}
          </div>
          <div className="flex gap-2.5 items-center shrink-0">
            <span className="text-[11px] text-muted-foreground whitespace-nowrap">
              last active: <LiveTimeAgo date={group.latestActivity} />
            </span>
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-md font-medium">
              {group.sessions.length} session
              {group.sessions.length !== 1 ? 's' : ''}
            </span>
            <span className="text-xs text-muted-foreground">
              {formatNumber(group.totalMessages)} msgs
            </span>
          </div>
        </button>
      )}

      {/* Session rows */}
      {(isFlat || !isCollapsed) && (
        <div>
          {group.sessions.map((s) => (
            <DiscoverSessionRow
              key={`${s.machineId}-${s.sessionId}`}
              session={s}
              isFlat={isFlat}
              isSelected={selectedSessionId === s.sessionId}
              isResuming={resumingSessionId === s.sessionId}
              isImported={importedSessionIds.has(s.sessionId)}
              isChecked={selectedIds.has(s.sessionId)}
              isImporting={importingSessionId === s.sessionId}
              search={search}
              resumePrompt={resumePrompt}
              onResumePromptChange={onResumePromptChange}
              onSelect={onSelectSession}
              onToggleCheck={onToggleCheck}
              onImport={onImport}
              onStartResume={onStartResume}
              onSubmitResume={onSubmitResume}
              onCancelResume={onCancelResume}
            />
          ))}
        </div>
      )}
    </div>
  );
}
