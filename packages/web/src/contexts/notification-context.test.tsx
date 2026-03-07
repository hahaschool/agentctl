import { act, cleanup, renderHook } from '@testing-library/react';
import type React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the underlying hook
// ---------------------------------------------------------------------------

const mockAddNotification = vi.fn();
const mockMarkRead = vi.fn();
const mockMarkAllRead = vi.fn();
const mockClearAll = vi.fn();

vi.mock('../hooks/use-notifications', () => ({
  useNotifications: () => ({
    notifications: [],
    unreadCount: 0,
    addNotification: mockAddNotification,
    markRead: mockMarkRead,
    markAllRead: mockMarkAllRead,
    clearAll: mockClearAll,
  }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { NotificationProvider, useNotificationContext } from './notification-context';

// ---------------------------------------------------------------------------
// Wrapper helper
// ---------------------------------------------------------------------------

function wrapper({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <NotificationProvider>{children}</NotificationProvider>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NotificationProvider + useNotificationContext', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('provides notification context values', () => {
    const { result } = renderHook(() => useNotificationContext(), { wrapper });
    expect(result.current.notifications).toEqual([]);
    expect(result.current.unreadCount).toBe(0);
  });

  it('exposes addNotification from the hook', () => {
    const { result } = renderHook(() => useNotificationContext(), { wrapper });
    act(() => {
      result.current.addNotification({ type: 'success', message: 'test' });
    });
    expect(mockAddNotification).toHaveBeenCalledWith({ type: 'success', message: 'test' });
  });

  it('exposes markRead from the hook', () => {
    const { result } = renderHook(() => useNotificationContext(), { wrapper });
    act(() => {
      result.current.markRead('abc');
    });
    expect(mockMarkRead).toHaveBeenCalledWith('abc');
  });

  it('exposes markAllRead from the hook', () => {
    const { result } = renderHook(() => useNotificationContext(), { wrapper });
    act(() => {
      result.current.markAllRead();
    });
    expect(mockMarkAllRead).toHaveBeenCalled();
  });

  it('exposes clearAll from the hook', () => {
    const { result } = renderHook(() => useNotificationContext(), { wrapper });
    act(() => {
      result.current.clearAll();
    });
    expect(mockClearAll).toHaveBeenCalled();
  });

  it('throws when used outside of NotificationProvider', () => {
    // Suppress React error boundary console output
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      renderHook(() => useNotificationContext());
    }).toThrow('useNotificationContext must be used within a NotificationProvider');

    spy.mockRestore();
  });

  it('renders children within the provider', () => {
    const { result } = renderHook(() => useNotificationContext(), { wrapper });
    // Context is available — proves children render under the provider
    expect(result.current).toBeDefined();
    expect(typeof result.current.addNotification).toBe('function');
    expect(typeof result.current.markRead).toBe('function');
    expect(typeof result.current.markAllRead).toBe('function');
    expect(typeof result.current.clearAll).toBe('function');
  });
});
