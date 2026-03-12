'use client';

import type { Thread } from '@agentctl/shared';
import { Hash, MessageCircle, Plus } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Thread type icon
// ---------------------------------------------------------------------------

const THREAD_TYPE_ICONS: Record<
  string,
  React.ComponentType<{ size?: number; className?: string }>
> = {
  discussion: Hash,
  execution: MessageCircle,
  review: MessageCircle,
  approval: MessageCircle,
};

// ---------------------------------------------------------------------------
// ThreadList
// ---------------------------------------------------------------------------

export type ThreadListProps = {
  threads: Thread[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onCreateThread: (title: string, type: string) => void;
  isCreating?: boolean;
};

export function ThreadList({
  threads,
  activeThreadId,
  onSelectThread,
  onCreateThread,
  isCreating,
}: ThreadListProps): React.JSX.Element {
  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  const handleCreate = (): void => {
    const title = newTitle.trim();
    if (!title) return;
    onCreateThread(title, 'discussion');
    setNewTitle('');
    setShowNew(false);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Threads
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setShowNew(!showNew)}
          aria-label="New thread"
        >
          <Plus size={14} />
        </Button>
      </div>

      {showNew && (
        <div className="px-3 py-2 border-b border-border">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate();
              if (e.key === 'Escape') {
                setShowNew(false);
                setNewTitle('');
              }
            }}
            placeholder="Thread title..."
            className="w-full px-2 py-1.5 bg-muted text-foreground border border-border rounded-md text-xs outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
          />
          <div className="flex gap-1.5 mt-1.5">
            <Button size="xs" onClick={handleCreate} disabled={!newTitle.trim() || isCreating}>
              {isCreating ? 'Creating...' : 'Create'}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                setShowNew(false);
                setNewTitle('');
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {threads.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            No threads yet. Create one to start collaborating.
          </div>
        ) : (
          threads.map((thread) => {
            const Icon = THREAD_TYPE_ICONS[thread.type] ?? Hash;
            const isActive = thread.id === activeThreadId;
            return (
              <button
                key={thread.id}
                type="button"
                onClick={() => onSelectThread(thread.id)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors cursor-pointer',
                  'hover:bg-accent/5 border-l-2',
                  isActive
                    ? 'bg-accent/10 text-foreground font-medium border-l-primary'
                    : 'text-muted-foreground border-l-transparent',
                )}
              >
                <Icon size={14} className="shrink-0" />
                <span className="truncate text-xs">
                  {thread.title ?? `Thread ${thread.id.slice(0, 8)}`}
                </span>
                <span className="ml-auto text-[10px] font-mono text-muted-foreground/60">
                  {thread.type}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
