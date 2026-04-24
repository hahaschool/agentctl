'use client';

import type { ContextRef } from '@agentctl/shared';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Globe, Lock, Plus, Users } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';

import { Breadcrumb } from '@/components/Breadcrumb';
import { ConfirmButton } from '@/components/ConfirmButton';
import { EventComposer } from '@/components/collaboration/EventComposer';
import { EventFeed } from '@/components/collaboration/EventFeed';
import { SpaceMembersList } from '@/components/collaboration/SpaceMembersList';
import { ThreadList } from '@/components/collaboration/ThreadList';
import { ErrorBanner } from '@/components/ErrorBanner';
import { FetchingBar } from '@/components/FetchingBar';
import { LiveTimeAgo } from '@/components/LiveTimeAgo';
import { RefreshButton } from '@/components/RefreshButton';
import { useToast } from '@/components/Toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  spaceContextRefsQuery,
  spaceEventsQuery,
  spaceQuery,
  spaceSubscriptionsQuery,
  spaceThreadsQuery,
  useCreateContextRef,
  useCreateThread,
  useDeleteContextRef,
  useDeleteSpace,
  usePostEvent,
  useRemoveSpaceMember,
} from '@/lib/queries';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// SpaceTypeBadge
// ---------------------------------------------------------------------------

const SPACE_TYPE_STYLES: Record<string, string> = {
  collaboration: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30',
  solo: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30',
  'fleet-overview': 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
};

function SpaceTypeBadge({ type }: { type: string }): React.JSX.Element {
  return (
    <span
      className={cn(
        'text-[10px] font-mono px-1.5 py-0.5 rounded-sm border',
        SPACE_TYPE_STYLES[type] ?? 'bg-muted text-muted-foreground border-border',
      )}
    >
      {type}
    </span>
  );
}

// ---------------------------------------------------------------------------
// VisibilityBadge
// ---------------------------------------------------------------------------

function VisibilityBadge({ visibility }: { visibility: string }): React.JSX.Element {
  const Icon = visibility === 'public' ? Globe : visibility === 'team' ? Users : Lock;
  return (
    <span className="flex items-center gap-1 text-[10px] text-muted-foreground border border-border rounded-sm px-1.5 py-0.5">
      <Icon size={10} />
      {visibility}
    </span>
  );
}

// ---------------------------------------------------------------------------
// RefModeBadge — colour-coded mode pill
// ---------------------------------------------------------------------------

const MODE_STYLES: Record<string, string> = {
  reference: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30',
  copy: 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30',
  query: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30',
  subscription: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
};

function RefModeBadge({ mode }: { mode: string }): React.JSX.Element {
  return (
    <span
      className={cn(
        'text-[10px] font-mono px-1.5 py-0.5 rounded-sm border capitalize',
        MODE_STYLES[mode] ?? 'bg-muted text-muted-foreground border-border',
      )}
    >
      {mode}
    </span>
  );
}

// ---------------------------------------------------------------------------
// AddContextRefDialog
// ---------------------------------------------------------------------------

type AddContextRefDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaceId: string;
  threads: Array<{ id: string; title?: string | null }>;
};

const CONTEXT_REF_MODES = ['reference', 'copy', 'query', 'subscription'] as const;

function AddContextRefDialog({
  open,
  onOpenChange,
  spaceId,
  threads,
}: AddContextRefDialogProps): React.JSX.Element {
  const toast = useToast();
  const createContextRef = useCreateContextRef();

  const [sourceSpaceId, setSourceSpaceId] = useState('');
  const [targetThreadId, setTargetThreadId] = useState('');
  const [mode, setMode] = useState<string>('reference');

  const handleSubmit = useCallback(
    (e: React.FormEvent): void => {
      e.preventDefault();

      const trimmedSource = sourceSpaceId.trim();
      if (!trimmedSource) {
        toast.error('Source space ID is required');
        return;
      }
      if (!targetThreadId) {
        toast.error('Target thread is required');
        return;
      }

      createContextRef.mutate(
        {
          spaceId,
          sourceSpaceId: trimmedSource,
          targetThreadId,
          mode,
          createdBy: 'local',
        },
        {
          onSuccess: () => {
            toast.success('Context ref created');
            setSourceSpaceId('');
            setTargetThreadId('');
            setMode('reference');
            onOpenChange(false);
          },
          onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
        },
      );
    },
    [spaceId, sourceSpaceId, targetThreadId, mode, createContextRef, toast, onOpenChange],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">Add Context Ref</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Source Space ID</Label>
            <Input
              value={sourceSpaceId}
              onChange={(e) => setSourceSpaceId(e.target.value)}
              placeholder="uuid of the source space"
              className="font-mono text-xs h-8"
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Target Thread</Label>
            <Select value={targetThreadId} onValueChange={setTargetThreadId}>
              <SelectTrigger size="sm" className="w-full text-xs">
                <SelectValue placeholder="Select a thread…" />
              </SelectTrigger>
              <SelectContent>
                {threads.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    No threads in this space
                  </div>
                ) : (
                  threads.map((t) => (
                    <SelectItem key={t.id} value={t.id} className="text-xs font-mono">
                      {t.title ?? t.id.slice(0, 12)}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Mode</Label>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger size="sm" className="w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONTEXT_REF_MODES.map((m) => (
                  <SelectItem key={m} value={m} className="text-xs capitalize">
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter showCloseButton>
            <Button
              type="submit"
              size="sm"
              disabled={createContextRef.isPending}
              className="bg-blue-500 hover:bg-blue-600 text-white text-xs"
            >
              {createContextRef.isPending ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// ContextRefRow
// ---------------------------------------------------------------------------

type ContextRefRowProps = {
  ref_: ContextRef;
  spaceId: string;
};

function ContextRefRow({ ref_, spaceId }: ContextRefRowProps): React.JSX.Element {
  const toast = useToast();
  const deleteContextRef = useDeleteContextRef();

  const handleDelete = useCallback((): void => {
    deleteContextRef.mutate(
      { spaceId, refId: ref_.id },
      {
        onSuccess: () => toast.success('Context ref removed'),
        onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
      },
    );
  }, [spaceId, ref_.id, deleteContextRef, toast]);

  return (
    <div className="flex items-center gap-2 rounded border border-border/40 px-2 py-1.5 group">
      {/* Mode badge */}
      <RefModeBadge mode={ref_.mode} />

      {/* Source → target */}
      <span className="flex-1 min-w-0 font-mono text-[11px] text-muted-foreground truncate">
        {ref_.sourceSpaceId.slice(0, 8)} → {ref_.targetThreadId.slice(0, 8)}
      </span>

      {/* Timestamp */}
      <span className="text-[11px] text-muted-foreground shrink-0">
        <LiveTimeAgo date={ref_.createdAt} />
      </span>

      {/* Delete */}
      <ConfirmButton
        label="×"
        confirmLabel="rm?"
        onConfirm={handleDelete}
        disabled={deleteContextRef.isPending}
        className="shrink-0 px-1.5 py-0.5 text-[11px] rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
        confirmClassName="shrink-0 px-1.5 py-0.5 text-[11px] rounded text-destructive bg-destructive/10 animate-pulse font-mono"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ContextRefsPanel — replaces the old minimal preview
// ---------------------------------------------------------------------------

type ContextRefsPanelProps = {
  spaceId: string;
  refs: ContextRef[];
  isLoading: boolean;
  hasError: boolean;
  threads: Array<{ id: string; title?: string | null }>;
};

function ContextRefsPanel({
  spaceId,
  refs,
  isLoading,
  hasError,
  threads,
}: ContextRefsPanelProps): React.JSX.Element {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="rounded-md border border-border/60 p-2.5 flex flex-col gap-2">
      {/* Panel header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
            Context Refs
          </span>
          {refs.length > 0 && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {refs.length}
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setAddOpen(true)}
          className="h-6 px-2 text-[11px] text-blue-500 hover:text-blue-400 hover:bg-blue-500/10"
        >
          <Plus size={11} className="mr-1" />
          Add
        </Button>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-1.5">
          <Skeleton className="h-7 rounded" />
          <Skeleton className="h-7 rounded" />
        </div>
      ) : hasError ? (
        <p className="text-xs text-destructive">Failed to load refs.</p>
      ) : refs.length === 0 ? (
        <p className="text-xs text-muted-foreground">No context refs — add one to bridge spaces.</p>
      ) : (
        <div className="max-h-[180px] overflow-y-auto space-y-1.5 pr-0.5">
          {refs.map((ref) => (
            <ContextRefRow key={ref.id} ref_={ref} spaceId={spaceId} />
          ))}
        </div>
      )}

      <AddContextRefDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        spaceId={spaceId}
        threads={threads}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// SpaceDetailPage
// ---------------------------------------------------------------------------

export default function SpaceDetailPage(): React.JSX.Element {
  const params = useParams<{ id: string }>();
  const spaceId = params.id;
  const router = useRouter();
  const toast = useToast();

  const space = useQuery(spaceQuery(spaceId));
  const threads = useQuery(spaceThreadsQuery(spaceId));
  const contextRefs = useQuery(spaceContextRefsQuery(spaceId));
  const subscriptions = useQuery(spaceSubscriptionsQuery(spaceId));

  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [showMembers, setShowMembers] = useState(false);

  const createThread = useCreateThread();
  const deleteSpace = useDeleteSpace();
  const removeMember = useRemoveSpaceMember();
  const postEvent = usePostEvent();

  // Auto-select first thread
  useEffect(() => {
    const firstThread = threads.data?.[0];
    if (!activeThreadId && firstThread) {
      setActiveThreadId(firstThread.id);
    }
  }, [activeThreadId, threads.data]);

  const events = useQuery(spaceEventsQuery(spaceId, activeThreadId ?? ''));

  // Handlers
  const handleCreateThread = useCallback(
    (title: string, type: string): void => {
      createThread.mutate(
        { spaceId, title, type: type as 'discussion' },
        {
          onSuccess: (newThread) => {
            setActiveThreadId(newThread.id);
            toast.success(`Thread "${title}" created`);
          },
          onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
        },
      );
    },
    [spaceId, createThread, toast],
  );

  const handleDeleteSpace = useCallback((): void => {
    deleteSpace.mutate(spaceId, {
      onSuccess: () => {
        toast.success('Space deleted');
        router.push('/spaces');
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
    });
  }, [spaceId, deleteSpace, toast, router]);

  const handleRemoveMember = useCallback(
    (memberId: string): void => {
      removeMember.mutate(
        { spaceId, memberId },
        {
          onSuccess: () => toast.success('Member removed'),
          onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
        },
      );
    },
    [spaceId, removeMember, toast],
  );

  const handleSendMessage = useCallback(
    (text: string): void => {
      if (!activeThreadId) return;
      postEvent.mutate(
        {
          spaceId,
          threadId: activeThreadId,
          type: 'message',
          senderType: 'human',
          senderId: 'user',
          payload: { text },
        },
        {
          onError: (err) => toast.error(err instanceof Error ? err.message : String(err)),
        },
      );
    },
    [spaceId, activeThreadId, postEvent, toast],
  );

  // Loading
  if (space.isLoading) {
    return (
      <div className="p-4 md:p-6 max-w-[1200px]">
        <Skeleton className="h-4 w-32 mb-4" />
        <Skeleton className="h-8 w-64 mb-6" />
        <div className="grid grid-cols-[240px_1fr] gap-4 h-[600px]">
          <Skeleton className="rounded-lg" />
          <Skeleton className="rounded-lg" />
        </div>
      </div>
    );
  }

  // Error
  if (space.error) {
    return (
      <div className="p-4 md:p-6 max-w-[1200px]">
        <Breadcrumb items={[{ label: 'Spaces', href: '/spaces' }, { label: 'Error' }]} />
        <ErrorBanner
          message={`Failed to load space: ${space.error.message}`}
          onRetry={() => void space.refetch()}
          className="mt-6"
        />
      </div>
    );
  }

  const data = space.data;
  if (!data) {
    return (
      <div className="p-4 md:p-6 max-w-[1200px]">
        <Breadcrumb items={[{ label: 'Spaces', href: '/spaces' }, { label: 'Not Found' }]} />
        <div className="mt-6 text-center text-muted-foreground text-sm py-12">Space not found.</div>
      </div>
    );
  }

  const members = data.members ?? [];

  return (
    <div className="relative p-4 md:p-6 max-w-[1200px] animate-page-enter h-[calc(100vh-48px)] md:h-screen flex flex-col">
      <FetchingBar
        isFetching={
          (space.isFetching ||
            threads.isFetching ||
            contextRefs.isFetching ||
            subscriptions.isFetching) &&
          !space.isLoading
        }
      />
      <Breadcrumb items={[{ label: 'Spaces', href: '/spaces' }, { label: data.name }]} />

      {/* Header */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h1 className="text-[22px] font-semibold tracking-tight">{data.name}</h1>
        <SpaceTypeBadge type={data.type} />
        <VisibilityBadge visibility={data.visibility} />
        <Badge variant="outline" className="text-[10px]">
          <Users size={10} className="mr-1" />
          {members.length} member{members.length !== 1 ? 's' : ''}
        </Badge>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowMembers(!showMembers)}>
            <Users size={14} />
            Members
            <ChevronRight
              size={12}
              className={cn('transition-transform', showMembers ? 'rotate-90' : '')}
            />
          </Button>
          <RefreshButton
            onClick={() => {
              void space.refetch();
              void threads.refetch();
              void events.refetch();
              void contextRefs.refetch();
              void subscriptions.refetch();
            }}
            isFetching={
              space.isFetching ||
              threads.isFetching ||
              events.isFetching ||
              contextRefs.isFetching ||
              subscriptions.isFetching
            }
          />
          <ConfirmButton
            label="Delete"
            confirmLabel="Confirm Delete"
            onConfirm={handleDeleteSpace}
            disabled={deleteSpace.isPending}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-muted text-destructive border border-destructive/30 cursor-pointer hover:bg-destructive/10"
            confirmClassName="px-3 py-1.5 text-xs font-medium rounded-md bg-destructive text-destructive-foreground cursor-pointer animate-pulse"
          />
        </div>
      </div>

      {data.description && <p className="text-xs text-muted-foreground mb-4">{data.description}</p>}

      {/* Bridges section */}
      <div className="mb-4 rounded-lg border border-border bg-card p-3">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Bridges</h2>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{(subscriptions.data ?? []).length} subscriptions</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {/* Context Refs — expanded panel */}
          <ContextRefsPanel
            spaceId={spaceId}
            refs={contextRefs.data ?? []}
            isLoading={contextRefs.isLoading}
            hasError={!!contextRefs.error}
            threads={threads.data ?? []}
          />

          <div className="rounded-md border border-border/60 p-2.5">
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Subscriptions
            </div>
            {subscriptions.isLoading ? (
              <p className="text-xs text-muted-foreground">Loading subscriptions...</p>
            ) : subscriptions.error ? (
              <p className="text-xs text-destructive">Failed to load subscriptions.</p>
            ) : (subscriptions.data ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">No subscriptions for this space.</p>
            ) : (
              <div className="space-y-2">
                {(subscriptions.data ?? []).slice(0, 5).map((subscription) => (
                  <div
                    key={subscription.id}
                    className="rounded border border-border/40 px-2 py-1.5 text-[11px]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-muted-foreground">
                        from {subscription.sourceSpaceId.slice(0, 8)}
                      </span>
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[10px] px-1.5 py-0',
                          subscription.active
                            ? 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400'
                            : 'border-border text-muted-foreground',
                        )}
                      >
                        {subscription.active ? 'Active' : 'Paused'}
                      </Badge>
                    </div>
                    <div className="text-muted-foreground mt-1">
                      by {subscription.createdBy} · <LiveTimeAgo date={subscription.createdAt} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main layout: thread sidebar + event feed + optional members panel */}
      <div className="flex-1 flex gap-0 border border-border rounded-lg overflow-hidden min-h-0">
        {/* Thread sidebar */}
        <div className="w-[200px] lg:w-[240px] border-r border-border shrink-0 flex flex-col bg-card">
          <ThreadList
            threads={threads.data ?? []}
            activeThreadId={activeThreadId}
            onSelectThread={setActiveThreadId}
            onCreateThread={handleCreateThread}
            isCreating={createThread.isPending}
          />
        </div>

        {/* Event feed + composer */}
        <div className="flex-1 flex flex-col min-w-0 bg-background">
          {activeThreadId ? (
            <>
              <EventFeed events={events.data ?? []} isLoading={events.isLoading} />
              <EventComposer onSend={handleSendMessage} disabled={postEvent.isPending} />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
              Select or create a thread to begin.
            </div>
          )}
        </div>

        {/* Members panel (collapsible) */}
        {showMembers && (
          <div className="w-[220px] border-l border-border shrink-0 bg-card flex flex-col">
            <div className="px-3 py-2 border-b border-border">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Members
              </span>
            </div>
            <div className="flex-1 overflow-y-auto">
              <SpaceMembersList
                members={members}
                onRemove={handleRemoveMember}
                isRemoving={removeMember.isPending}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
