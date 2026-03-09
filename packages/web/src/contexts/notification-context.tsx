'use client';

import type React from 'react';
import { createContext, useContext } from 'react';
import type { Notification } from '../hooks/use-notifications';
import { useNotifications } from '../hooks/use-notifications';

type NotificationContextValue = {
  notifications: Notification[];
  unreadCount: number;
  addNotification: (n: Omit<Notification, 'id' | 'timestamp' | 'read'>) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clearAll: () => void;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const value = useNotifications();
  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotificationContext(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error('useNotificationContext must be used within a NotificationProvider');
  }
  return ctx;
}
