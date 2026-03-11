'use client';

import { AlertTriangle, Bell, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import type React from 'react';
import { useEffect, useId, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import type { Notification, NotificationType } from '../hooks/use-notifications';
import { timeAgo } from '../lib/format-utils';

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

export function NotificationBell({
  notifications,
  unreadCount,
  onMarkRead,
  onMarkAllRead,
  onClearAll,
}: NotificationBellProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentId = `notification-bell-popover-${useId().replaceAll(':', '')}`;

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
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={contentId}
          title="Notifications"
        >
          <Bell size={16} aria-hidden="true" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] leading-none font-bold text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
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
            'z-50 flex max-h-96 w-full max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-md border border-border bg-popover shadow-lg outline-none sm:w-80',
            'data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          )}
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-semibold text-foreground">Notifications</span>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={onMarkAllRead}
                  className="text-[11px] text-primary hover:underline"
                >
                  Mark all read
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  type="button"
                  onClick={onClearAll}
                  className="text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                No notifications
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={cn(
                    'flex items-start gap-2 border-b border-border/50 px-3 py-2 transition-colors hover:bg-accent/5',
                    !n.read && 'bg-accent/10',
                  )}
                >
                  {(() => {
                    const Icon = TYPE_ICONS[n.type];
                    return (
                      <Icon size={14} className={cn('mt-0.5 shrink-0', TYPE_COLORS[n.type])} aria-hidden="true" />
                    );
                  })()}
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'text-sm leading-snug',
                        !n.read ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {n.message}
                    </p>
                    <span className="text-[10px] text-muted-foreground">
                      {timeAgo(new Date(n.timestamp).toISOString())}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onMarkRead(n.id)}
                    className="shrink-0 rounded px-1 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label="Dismiss notification"
                    title={n.read ? 'Already read' : 'Mark as read'}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </div>
              ))
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
