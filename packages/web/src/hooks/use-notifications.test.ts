import { act, renderHook } from '@testing-library/react';

import { useNotifications } from './use-notifications';

describe('useNotifications', () => {
  it('starts with empty notifications and zero unread', () => {
    const { result } = renderHook(() => useNotifications());
    expect(result.current.notifications).toEqual([]);
    expect(result.current.unreadCount).toBe(0);
  });

  it('adds a notification with auto-generated id, timestamp, and read=false', () => {
    const { result } = renderHook(() => useNotifications());

    act(() => {
      result.current.addNotification({ type: 'info', message: 'Hello' });
    });

    expect(result.current.notifications).toHaveLength(1);
    const n = result.current.notifications[0];
    expect(n?.message).toBe('Hello');
    expect(n?.type).toBe('info');
    expect(n?.read).toBe(false);
    expect(n?.id).toMatch(/^notif-/);
    expect(n?.timestamp).toBeGreaterThan(0);
  });

  it('increments unreadCount when notifications are added', () => {
    const { result } = renderHook(() => useNotifications());

    act(() => {
      result.current.addNotification({ type: 'success', message: 'A' });
      result.current.addNotification({ type: 'error', message: 'B' });
    });

    expect(result.current.unreadCount).toBe(2);
  });

  it('prepends new notifications (newest first)', () => {
    const { result } = renderHook(() => useNotifications());

    act(() => {
      result.current.addNotification({ type: 'info', message: 'First' });
    });
    act(() => {
      result.current.addNotification({ type: 'info', message: 'Second' });
    });

    expect(result.current.notifications[0]?.message).toBe('Second');
    expect(result.current.notifications[1]?.message).toBe('First');
  });

  it('includes optional sessionId', () => {
    const { result } = renderHook(() => useNotifications());

    act(() => {
      result.current.addNotification({
        type: 'warning',
        message: 'Session ended',
        sessionId: 'ses-123',
      });
    });

    expect(result.current.notifications[0]?.sessionId).toBe('ses-123');
  });

  it('markRead marks a single notification as read', () => {
    const { result } = renderHook(() => useNotifications());

    act(() => {
      result.current.addNotification({ type: 'info', message: 'A' });
      result.current.addNotification({ type: 'info', message: 'B' });
    });

    const idToMark = result.current.notifications[0]?.id ?? '';

    act(() => {
      result.current.markRead(idToMark);
    });

    expect(result.current.notifications.find((n) => n.id === idToMark)?.read).toBe(true);
    expect(result.current.unreadCount).toBe(1);
  });

  it('markAllRead marks all notifications as read', () => {
    const { result } = renderHook(() => useNotifications());

    act(() => {
      result.current.addNotification({ type: 'info', message: 'A' });
      result.current.addNotification({ type: 'error', message: 'B' });
      result.current.addNotification({ type: 'success', message: 'C' });
    });

    act(() => {
      result.current.markAllRead();
    });

    expect(result.current.unreadCount).toBe(0);
    expect(result.current.notifications.every((n) => n.read)).toBe(true);
  });

  it('clearAll removes all notifications', () => {
    const { result } = renderHook(() => useNotifications());

    act(() => {
      result.current.addNotification({ type: 'info', message: 'A' });
      result.current.addNotification({ type: 'info', message: 'B' });
    });

    act(() => {
      result.current.clearAll();
    });

    expect(result.current.notifications).toEqual([]);
    expect(result.current.unreadCount).toBe(0);
  });

  it('caps notifications at 50 (MAX_NOTIFICATIONS)', () => {
    const { result } = renderHook(() => useNotifications());

    act(() => {
      for (let i = 0; i < 55; i++) {
        result.current.addNotification({ type: 'info', message: `Msg ${String(i)}` });
      }
    });

    expect(result.current.notifications.length).toBeLessThanOrEqual(50);
  });

  it('markRead with non-existent id does not throw', () => {
    const { result } = renderHook(() => useNotifications());

    act(() => {
      result.current.addNotification({ type: 'info', message: 'A' });
    });

    expect(() => {
      act(() => {
        result.current.markRead('non-existent-id');
      });
    }).not.toThrow();

    expect(result.current.unreadCount).toBe(1);
  });
});
