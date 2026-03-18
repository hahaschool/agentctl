'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Globe, Lock, Users } from 'lucide-react';
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
import { Skeleton } from '@/components/ui/skeleton';
import {
  spaceContextRefsQuery,
  spaceEventsQuery,
  spaceQuery,
  spaceSubscriptionsQuery,
  spaceThreadsQuery,
  useCreateThread,
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
            <span>{(contextRefs.data ?? []).length} refs</span>
            <span>{(subscriptions.data ?? []).length} subscriptions</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="rounded-md border border-border/60 p-2.5">
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Context Refs
            </div>
            {contextRefs.isLoading ? (
              <p className="text-xs text-muted-foreground">Loading refs...</p>
            ) : contextRefs.error ? (
              <p className="text-xs text-destructive">Failed to load refs.</p>
            ) : (contextRefs.data ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">No context refs for this space.</p>
            ) : (
              <div className="space-y-2">
                {(contextRefs.data ?? []).slice(0, 5).map((ref) => (
                  <div key={ref.id} className="rounded border border-border/40 px-2 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-mono text-muted-foreground">
                        {ref.sourceSpaceId.slice(0, 8)} → {ref.targetThreadId.slice(0, 8)}
                      </span>
                      <Badge variant="outline" className="capitalize text-[10px] px-1.5 py-0">
                        {ref.mode}
                      </Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1">
                      Created <LiveTimeAgo date={ref.createdAt} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

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
