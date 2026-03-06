import { fireEvent, render, screen } from '@testing-library/react';

import type { Notification } from '../hooks/use-notifications';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Bell: (props: Record<string, unknown>) => <svg data-testid="icon-bell" {...props} />,
  CheckCircle2: (props: Record<string, unknown>) => <svg data-testid="icon-check" {...props} />,
  XCircle: (props: Record<string, unknown>) => <svg data-testid="icon-xcircle" {...props} />,
  AlertTriangle: (props: Record<string, unknown>) => <svg data-testid="icon-alert" {...props} />,
  Info: (props: Record<string, unknown>) => <svg data-testid="icon-info" {...props} />,
  X: (props: Record<string, unknown>) => <svg data-testid="icon-x" {...props} />,
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { NotificationBell } from './NotificationBell';

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'n-1',
    type: 'info',
    message: 'Test notification',
    timestamp: Date.now() - 30_000,
    read: false,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('NotificationBell', () => {
  const defaultProps = {
    notifications: [] as Notification[],
    unreadCount: 0,
    onMarkRead: vi.fn(),
    onMarkAllRead: vi.fn(),
    onClearAll: vi.fn(),
  };

  describe('bell icon and badge', () => {
    it('renders the bell icon', () => {
      render(<NotificationBell {...defaultProps} />);
      expect(screen.getByTestId('icon-bell')).toBeDefined();
    });

    it('does not show unread badge when unreadCount is 0', () => {
      render(<NotificationBell {...defaultProps} unreadCount={0} />);
      const button = screen.getByRole('button', { name: /Notifications/ });
      // No badge span with a number
      expect(button.querySelector('span')).toBeNull();
    });

    it('shows unread badge with correct count', () => {
      render(<NotificationBell {...defaultProps} unreadCount={5} />);
      expect(screen.getByText('5')).toBeDefined();
    });

    it('caps badge at 99+', () => {
      render(<NotificationBell {...defaultProps} unreadCount={150} />);
      expect(screen.getByText('99+')).toBeDefined();
    });

    it('sets correct aria-label with unread count', () => {
      render(<NotificationBell {...defaultProps} unreadCount={3} />);
      expect(
        screen.getByRole('button', { name: 'Notifications (3 unread)' }),
      ).toBeDefined();
    });

    it('sets aria-label without unread info when count is 0', () => {
      render(<NotificationBell {...defaultProps} unreadCount={0} />);
      expect(
        screen.getByRole('button', { name: 'Notifications' }),
      ).toBeDefined();
    });
  });

  describe('dropdown open/close', () => {
    it('does not show dropdown by default', () => {
      render(<NotificationBell {...defaultProps} />);
      expect(screen.queryByText('Notifications', { selector: 'span' })).toBeNull();
    });

    it('opens dropdown on bell click', () => {
      render(<NotificationBell {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
      expect(screen.getByText('Notifications', { selector: 'span' })).toBeDefined();
    });

    it('closes dropdown on second bell click (toggle)', () => {
      render(<NotificationBell {...defaultProps} />);
      const bell = screen.getByRole('button', { name: /Notifications/ });
      fireEvent.click(bell);
      expect(screen.getByText('Notifications', { selector: 'span' })).toBeDefined();
      fireEvent.click(bell);
      expect(screen.queryByText('Notifications', { selector: 'span' })).toBeNull();
    });

    it('closes dropdown on Escape key', () => {
      render(<NotificationBell {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
      expect(screen.getByText('Notifications', { selector: 'span' })).toBeDefined();

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByText('Notifications', { selector: 'span' })).toBeNull();
    });

    it('closes dropdown on outside click', () => {
      render(
        <div>
          <div data-testid="outside">outside</div>
          <NotificationBell {...defaultProps} />
        </div>,
      );
      fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
      expect(screen.getByText('Notifications', { selector: 'span' })).toBeDefined();

      fireEvent.mouseDown(screen.getByTestId('outside'));
      expect(screen.queryByText('Notifications', { selector: 'span' })).toBeNull();
    });
  });

  describe('notification list', () => {
    it('shows "No notifications" when list is empty', () => {
      render(<NotificationBell {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
      expect(screen.getByText('No notifications')).toBeDefined();
    });

    it('renders notification messages', () => {
      const notifications = [
        makeNotification({ id: 'n-1', message: 'Session ended' }),
        makeNotification({ id: 'n-2', message: 'Error in agent', type: 'error' }),
      ];
      render(
        <NotificationBell
          {...defaultProps}
          notifications={notifications}
          unreadCount={2}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
      expect(screen.getByText('Session ended')).toBeDefined();
      expect(screen.getByText('Error in agent')).toBeDefined();
    });

    it('renders correct icon for each notification type', () => {
      const notifications = [
        makeNotification({ id: 'n-1', type: 'success', message: 'Done' }),
        makeNotification({ id: 'n-2', type: 'error', message: 'Failed' }),
        makeNotification({ id: 'n-3', type: 'warning', message: 'Watch out' }),
        makeNotification({ id: 'n-4', type: 'info', message: 'FYI' }),
      ];
      render(
        <NotificationBell
          {...defaultProps}
          notifications={notifications}
          unreadCount={4}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
      expect(screen.getByTestId('icon-check')).toBeDefined();
      expect(screen.getByTestId('icon-xcircle')).toBeDefined();
      expect(screen.getByTestId('icon-alert')).toBeDefined();
      expect(screen.getByTestId('icon-info')).toBeDefined();
    });

    it('shows time ago for notifications', () => {
      const notifications = [
        makeNotification({ id: 'n-1', timestamp: Date.now() - 10_000, message: 'Recent' }),
      ];
      render(
        <NotificationBell
          {...defaultProps}
          notifications={notifications}
          unreadCount={1}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
      expect(screen.getByText('just now')).toBeDefined();
    });
  });

  describe('callbacks', () => {
    it('calls onMarkRead with notification id when dismiss button is clicked', () => {
      const onMarkRead = vi.fn();
      const notifications = [
        makeNotification({ id: 'notif-42', message: 'Alert' }),
      ];
      render(
        <NotificationBell
          {...defaultProps}
          notifications={notifications}
          unreadCount={1}
          onMarkRead={onMarkRead}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
      expect(onMarkRead).toHaveBeenCalledWith('notif-42');
    });

    it('calls onMarkAllRead when "Mark all read" is clicked', () => {
      const onMarkAllRead = vi.fn();
      const notifications = [makeNotification({ id: 'n-1' })];
      render(
        <NotificationBell
          {...defaultProps}
          notifications={notifications}
          unreadCount={1}
          onMarkAllRead={onMarkAllRead}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
      fireEvent.click(screen.getByText('Mark all read'));
      expect(onMarkAllRead).toHaveBeenCalledTimes(1);
    });

    it('does not show "Mark all read" when unreadCount is 0', () => {
      const notifications = [makeNotification({ id: 'n-1', read: true })];
      render(
        <NotificationBell
          {...defaultProps}
          notifications={notifications}
          unreadCount={0}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
      expect(screen.queryByText('Mark all read')).toBeNull();
    });

    it('calls onClearAll when "Clear" is clicked', () => {
      const onClearAll = vi.fn();
      const notifications = [makeNotification({ id: 'n-1' })];
      render(
        <NotificationBell
          {...defaultProps}
          notifications={notifications}
          unreadCount={1}
          onClearAll={onClearAll}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
      fireEvent.click(screen.getByText('Clear'));
      expect(onClearAll).toHaveBeenCalledTimes(1);
    });

    it('does not show "Clear" when notifications list is empty', () => {
      render(<NotificationBell {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
      expect(screen.queryByText('Clear')).toBeNull();
    });
  });
});
