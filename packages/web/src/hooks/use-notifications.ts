'use client';

import { useCallback, useState } from 'react';

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

export type Notification = {
  id: string;
  type: NotificationType;
  message: string;
  sessionId?: string;
  timestamp: number;
  read: boolean;
};

type UseNotificationsResult = {
  notifications: Notification[];
  unreadCount: number;
  addNotification: (n: Omit<Notification, 'id' | 'timestamp' | 'read'>) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clearAll: () => void;
};

const MAX_NOTIFICATIONS = 50;

let nextId = 0;

export function useNotifications(): UseNotificationsResult {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const addNotification = useCallback((n: Omit<Notification, 'id' | 'timestamp' | 'read'>) => {
    const entry: Notification = {
      ...n,
      id: `notif-${++nextId}-${Date.now()}`,
      timestamp: Date.now(),
      read: false,
    };
    setNotifications((prev) => {
      const next = [entry, ...prev];
      if (next.length > MAX_NOTIFICATIONS) {
        return next.slice(0, MAX_NOTIFICATIONS);
      }
      return next;
    });
  }, []);

  const markRead = useCallback((id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return { notifications, unreadCount, addNotification, markRead, markAllRead, clearAll };
}
