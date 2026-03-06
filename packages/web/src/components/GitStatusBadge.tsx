'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { cn } from '@/lib/utils';
import type { GitWorktreeEntry } from '../lib/api';
import { gitStatusQuery } from '../lib/queries';

type GitStatusBadgeProps = {
  machineId: string;
  projectPath: string;
  className?: string;
};

export function GitStatusBadge({
  machineId,
  projectPath,
  className,
}: GitStatusBadgeProps): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const { data: gitStatus, isLoading, isError } = useQuery(gitStatusQuery(machineId, projectPath));

  if (isLoading) {
    return (
      <span className={cn('inline-flex items-center gap-1 text-[11px] text-muted-foreground', className)}>
        <span className="animate-pulse">git: loading...</span>
      </span>
    );
  }

  if (isError || !gitStatus) {
    return null;
  }

  const { branch, status, isWorktree, lastCommit, worktrees } = gitStatus;
  const statusParts: string[] = [];

  if (status.staged > 0) statusParts.push(`${status.staged} staged`);
  if (status.modified > 0) statusParts.push(`${status.modified} modified`);
  if (status.untracked > 0) statusParts.push(`${status.untracked} untracked`);
  const statusSummary = statusParts.length > 0 ? statusParts.join(', ') : 'clean';

  const upDown: string[] = [];
  if (status.ahead > 0) upDown.push(`\u2191${status.ahead}`);
  if (status.behind > 0) upDown.push(`\u2193${status.behind}`);
  const upDownStr = upDown.length > 0 ? upDown.join(' ') : null;

  return (
    <div className={cn('text-[11px]', className)}>
      {/* Compact inline summary */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Branch name */}
        <span className="inline-flex items-center gap-1 font-mono bg-muted px-1.5 py-0.5 rounded-sm border border-border">
          <span className="text-muted-foreground">branch:</span>
          <span className="text-foreground font-medium">{branch}</span>
        </span>

        {/* Clean/dirty indicator */}
        <span className="inline-flex items-center gap-1">
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full shrink-0',
              status.clean ? 'bg-green-500' : 'bg-yellow-500',
            )}
          />
          <span className={cn(status.clean ? 'text-green-600 dark:text-green-400' : 'text-yellow-600 dark:text-yellow-400')}>
            {statusSummary}
          </span>
        </span>

        {/* Ahead/behind */}
        {upDownStr && (
          <span className="font-mono text-blue-600 dark:text-blue-400">{upDownStr}</span>
        )}

        {/* Worktree badge */}
        {isWorktree && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-purple-500/10 text-purple-600 dark:text-purple-400 rounded-sm border border-purple-500/20 text-[10px]">
            worktree
          </span>
        )}

        {/* Last commit */}
        {lastCommit && (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <span className="font-mono text-foreground/70">{lastCommit.hash}</span>
            <span className="truncate max-w-[200px]" title={lastCommit.message}>
              {lastCommit.message}
            </span>
          </span>
        )}

        {/* Expand worktrees toggle */}
        {worktrees.length > 1 && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            aria-label={expanded ? 'Hide worktrees' : `Show ${worktrees.length} worktrees`}
            className="text-muted-foreground hover:text-foreground cursor-pointer bg-transparent border-none p-0 underline"
          >
            {expanded ? 'hide' : `${worktrees.length} worktrees`}
          </button>
        )}
      </div>

      {/* Expanded worktree list */}
      {expanded && worktrees.length > 0 && (
        <div className="mt-1.5 ml-2 space-y-0.5">
          {worktrees.map((wt) => (
            <WorktreeRow key={wt.path} worktree={wt} currentBranch={branch} />
          ))}
        </div>
      )}
    </div>
  );
}

function WorktreeRow({
  worktree,
  currentBranch,
}: {
  worktree: GitWorktreeEntry;
  currentBranch: string;
}): React.JSX.Element {
  const isCurrent = worktree.branch === currentBranch;

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-2 py-1 rounded-sm text-[10px]',
        isCurrent ? 'bg-accent/50 border border-border' : 'text-muted-foreground',
      )}
    >
      {isCurrent && (
        <span className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />
      )}
      <span className="font-mono">{worktree.branch ?? '(detached)'}</span>
      {worktree.isMain && (
        <span className="text-[9px] px-1 py-0 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-sm border border-blue-500/20">
          main
        </span>
      )}
      <span className="text-muted-foreground/60 truncate" title={worktree.path}>
        {shortenWorktreePath(worktree.path)}
      </span>
    </div>
  );
}

function shortenWorktreePath(path: string): string {
  const parts = path.split('/');
  if (parts.length <= 3) return path;
  return `.../${parts.slice(-2).join('/')}`;
}
