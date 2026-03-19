'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Bell, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Popover as PopoverPrimitive } from 'radix-ui';
import type React from 'react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { Notification, NotificationType } from '../hooks/use-notifications';
import { api, type PermissionDecision, type PermissionRequest } from '../lib/api';
import { timeAgo } from '../lib/format-utils';
import { pendingPermissionRequestsQuery } from '../lib/queries';

type NotificationBellProps = {
  notifications: Notification[];
  unreadCount: number;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onClearAll: () => void;
};

const TYPE_ICONS: Record<NotificationType, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const TYPE_COLORS: Record<NotificationType, string> = {
  success: 'text-green-500',
  error: 'text-red-500',
  warning: 'text-yellow-500',
  info: 'text-blue-500',
};

function formatRemaining(ms: number): string {
  if (ms <= 0) return 'expired';
  const totalSeconds = Math.floor(ms / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${String(hours)}h ${String(minutes)}m`;
  return `${String(minutes)}m ${String(seconds)}s`;
}

function remainingBadgeClass(ms: number): string {
  if (ms > 120_000) return 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200';
  if (ms > 30_000) return 'border-yellow-400/40 bg-yellow-500/15 text-yellow-100';
  return 'border-red-400/40 bg-red-500/15 text-red-100';
}

function agentLabel(request: PermissionRequest): string {
  const named = request.agentName?.trim();
  if (named) return named;
  return `Agent ${request.agentId.slice(0, 8)}`;
}

export function NotificationBell({
  notifications,
  unreadCount,
  onMarkRead,
  onMarkAllRead,
  onClearAll,
}: NotificationBellProps): React.JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [resolvingById, setResolvingById] = useState<Record<string, PermissionDecision>>({});
  const contentRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentId = `notification-bell-popover-${useId().replaceAll(':', '')}`;

  const pendingRequestsQuery = useQuery(pendingPermissionRequestsQuery());
  const pendingRequests = pendingRequestsQuery.data ?? [];
  const pendingCount = pendingRequests.length;
  const badgeCount = pendingCount > 0 ? pendingCount : unreadCount;

  useEffect(() => {
    if (!open || pendingCount === 0) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [open, pendingCount]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (!target) return;
      if (contentRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  const handleResolve = useCallback(
    async (
      event: React.MouseEvent<HTMLButtonElement>,
      id: string,
      decision: PermissionDecision,
      allowForSession?: boolean,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      if (resolvingById[id]) return;

      setResolvingById((prev) => ({ ...prev, [id]: decision }));
      try {
        await api.resolvePermissionRequest(id, decision, { allowForSession });
        await pendingRequestsQuery.refetch();
      } finally {
        setResolvingById((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    },
    [pendingRequestsQuery, resolvingById],
  );

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          ref={triggerRef}
          type="button"
          className={cn(
            'relative rounded-md px-1.5 py-0.5 text-lg text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground',
            open && 'bg-muted text-foreground',
          )}
          aria-label={`Notifications${badgeCount > 0 ? ` (${badgeCount})` : ''}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={contentId}
          title="Notifications"
        >
          <Bell size={16} aria-hidden="true" />
          {badgeCount > 0 && (
            <Badge className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] leading-none font-bold text-white">
              {badgeCount > 99 ? '99+' : badgeCount}
            </Badge>
          )}
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          ref={contentRef}
          id={contentId}
          role="dialog"
          aria-label="Notifications"
          side="top"
          align="start"
          sideOffset={8}
          onPointerDownOutside={() => setOpen(false)}
          onEscapeKeyDown={() => setOpen(false)}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const firstFocusable = contentRef.current?.querySelector<HTMLElement>('button');
            firstFocusable?.focus();
          }}
          className={cn(
            'z-50 flex max-h-[28rem] w-full max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-md border border-border bg-popover shadow-lg outline-none sm:w-[28rem]',
            'data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          )}
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-semibold text-foreground">Notifications</span>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <Button type="button" variant="link" size="xs" onClick={onMarkAllRead}>
                  Mark all read
                </Button>
              )}
              {notifications.length > 0 && (
                <Button type="button" variant="ghost" size="xs" onClick={onClearAll}>
                  Clear
                </Button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-2">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Pending Approvals
              </span>
              <Badge variant="outline" className="text-[10px]">
                {pendingCount}
              </Badge>
            </div>

            {pendingRequestsQuery.isLoading ? (
              <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                Loading pending approvals...
              </div>
            ) : pendingRequests.length === 0 ? (
              <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                No pending approvals
              </div>
            ) : (
              <div className="space-y-2">
                {pendingRequests.map((request) => {
                  const remainingMs = new Date(request.timeoutAt).getTime() - nowMs;
                  const resolvingDecision = resolvingById[request.id];
                  return (
                    <Card
                      key={request.id}
                      className="gap-2 border-yellow-500/20 bg-yellow-500/5 py-2 shadow-none"
                    >
                      <CardContent className="space-y-2 px-3">
                        <button
                          type="button"
                          className="w-full cursor-pointer rounded-sm text-left transition-colors hover:bg-accent/20"
                          onClick={() => {
                            setOpen(false);
                            router.push(`/agents/${encodeURIComponent(request.agentId)}`);
                          }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-foreground">
                              {agentLabel(request)}
                            </p>
                            <Badge
                              variant="outline"
                              className={cn(
                                'font-mono text-[10px]',
                                remainingBadgeClass(remainingMs),
                              )}
                            >
                              {formatRemaining(remainingMs)}
                            </Badge>
                          </div>
                          <p className="mt-1 text-[11px] font-mono text-foreground/90">
                            {request.toolName}
                          </p>
                        </button>
                        {request.toolInput && (
                          <pre className="max-h-40 overflow-auto rounded border border-border/40 bg-muted/50 px-2 py-1.5 text-[10px] font-mono text-foreground/80 whitespace-pre-wrap break-all leading-relaxed">
                            {typeof request.toolInput === 'string'
                              ? request.toolInput
                              : JSON.stringify(request.toolInput, null, 2).slice(0, 800)}
                          </pre>
                        )}
                        {request.description && (
                          <p className="text-[10px] text-muted-foreground">{request.description}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            size="xs"
                            className="bg-emerald-600 text-white hover:bg-emerald-500"
                            disabled={Boolean(resolvingDecision)}
                            onClick={(event) => void handleResolve(event, request.id, 'approved')}
                          >
                            {resolvingDecision === 'approved' ? 'Approving…' : 'Allow once'}
                          </Button>
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            className="border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
                            disabled={Boolean(resolvingDecision)}
                            onClick={(event) =>
                              void handleResolve(event, request.id, 'approved', true)
                            }
                          >
                            Allow for session
                          </Button>
                          <Button
                            type="button"
                            size="xs"
                            variant="destructive"
                            disabled={Boolean(resolvingDecision)}
                            onClick={(event) => void handleResolve(event, request.id, 'denied')}
                          >
                            Deny
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}

            {notifications.length > 0 && <div className="my-3 h-px bg-border/70" />}

            {notifications.length === 0 ? (
              <div className="px-1 py-3 text-center text-sm text-muted-foreground">
                No notifications
              </div>
            ) : (
              notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={cn(
                    'flex items-start gap-2 border-b border-border/50 px-1 py-2 transition-colors hover:bg-accent/5',
                    !notification.read && 'bg-accent/10',
                  )}
                >
                  {(() => {
                    const Icon = TYPE_ICONS[notification.type];
                    return (
                      <Icon
                        size={14}
                        className={cn('mt-0.5 shrink-0', TYPE_COLORS[notification.type])}
                        aria-hidden="true"
                      />
                    );
                  })()}
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'text-sm leading-snug',
                        !notification.read ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {notification.message}
                    </p>
                    <span className="text-[10px] text-muted-foreground">
                      {timeAgo(new Date(notification.timestamp).toISOString())}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => onMarkRead(notification.id)}
                    className="shrink-0"
                    aria-label="Dismiss notification"
                    title={notification.read ? 'Already read' : 'Mark as read'}
                  >
                    <X size={12} aria-hidden="true" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
