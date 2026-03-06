'use client';

import { AlertTriangle, Bell, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import type { Notification, NotificationType } from '../hooks/use-notifications';

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

function formatTimeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function NotificationBell({
  notifications,
  unreadCount,
  onMarkRead,
  onMarkAllRead,
  onClearAll,
}: NotificationBellProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const toggle = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        className={cn(
          'relative text-lg text-muted-foreground hover:text-foreground transition-colors duration-150 px-1.5 py-0.5 rounded-md hover:bg-muted',
          open && 'text-foreground bg-muted',
        )}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        title="Notifications"
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1 leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className={cn(
            'absolute bottom-full left-0 mb-2 w-80 max-h-96 bg-popover border border-border rounded-md shadow-lg flex flex-col z-50',
            // On mobile, position differently
            'md:left-0 md:bottom-full',
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
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

          {/* Notification list */}
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
                    'flex items-start gap-2 px-3 py-2 border-b border-border/50 hover:bg-accent/5 transition-colors',
                    !n.read && 'bg-accent/10',
                  )}
                >
                  {(() => {
                    const Icon = TYPE_ICONS[n.type];
                    return (
                      <Icon size={14} className={cn('mt-0.5 shrink-0', TYPE_COLORS[n.type])} />
                    );
                  })()}
                  <div className="flex-1 min-w-0">
                    <p
                      className={cn(
                        'text-sm leading-snug',
                        !n.read ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {n.message}
                    </p>
                    <span className="text-[10px] text-muted-foreground">
                      {formatTimeAgo(n.timestamp)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onMarkRead(n.id)}
                    className="shrink-0 text-muted-foreground hover:text-foreground text-xs px-1 py-0.5 rounded hover:bg-muted transition-colors"
                    aria-label="Dismiss notification"
                    title={n.read ? 'Already read' : 'Mark as read'}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
