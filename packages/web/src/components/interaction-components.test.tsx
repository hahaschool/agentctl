import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Notification } from '../hooks/use-notifications';
import { ConfirmButton } from './ConfirmButton';
import { ErrorBoundary } from './ErrorBoundary';
import { NotificationBell } from './NotificationBell';

// Suppress console.error from ErrorBoundary.componentDidCatch during tests
const originalConsoleError = console.error;
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('ErrorBoundary caught')) return;
    // React logs errors for error boundaries in dev; suppress those too
    if (typeof args[0] === 'string' && args[0].includes('The above error occurred')) return;
    originalConsoleError(...args);
  };
});
afterAll(() => {
  console.error = originalConsoleError;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ===========================================================================
// Helper: create a Notification fixture
// ===========================================================================
function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'n-1',
    type: 'info',
    message: 'Test notification',
    timestamp: Date.now() - 60_000,
    read: false,
    ...overrides,
  };
}

// ===========================================================================
// NotificationBell
// ===========================================================================

describe('NotificationBell', () => {
  const baseProps = {
    notifications: [] as Notification[],
    unreadCount: 0,
    onMarkRead: vi.fn(),
    onMarkAllRead: vi.fn(),
    onClearAll: vi.fn(),
  };

  beforeEach(() => {
    baseProps.onMarkRead = vi.fn();
    baseProps.onMarkAllRead = vi.fn();
    baseProps.onClearAll = vi.fn();
  });

  it('renders the bell button with accessible label', () => {
    render(<NotificationBell {...baseProps} />);
    const btn = screen.getByRole('button', { name: /Notifications/i });
    expect(btn).toBeDefined();
  });

  it('does NOT show unread badge when unreadCount is 0', () => {
    const { container } = render(<NotificationBell {...baseProps} />);
    const badge = container.querySelector('.bg-red-500');
    expect(badge).toBeNull();
  });

  it('shows unread count badge when unreadCount > 0', () => {
    render(<NotificationBell {...baseProps} unreadCount={5} />);
    expect(screen.getByText('5')).toBeDefined();
  });

  it('caps displayed unread count at 99+', () => {
    render(<NotificationBell {...baseProps} unreadCount={120} />);
    expect(screen.getByText('99+')).toBeDefined();
  });

  it('includes unread count in aria-label when unreadCount > 0', () => {
    render(<NotificationBell {...baseProps} unreadCount={3} />);
    const btn = screen.getByRole('button', { name: /3 unread/ });
    expect(btn).toBeDefined();
  });

  it('does NOT show dropdown panel initially', () => {
    render(<NotificationBell {...baseProps} />);
    expect(screen.queryByText('Notifications')).toBeNull();
  });

  it('shows dropdown panel after clicking bell', () => {
    render(<NotificationBell {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Notifications/i }));
    // The dropdown header contains "Notifications" text
    expect(screen.getByText('Notifications')).toBeDefined();
  });

  it('hides dropdown panel on second click (toggle)', () => {
    render(<NotificationBell {...baseProps} />);
    const btn = screen.getByRole('button', { name: /Notifications/i });
    fireEvent.click(btn); // open
    expect(screen.getByText('Notifications')).toBeDefined();
    fireEvent.click(btn); // close
    // The header "Notifications" text should no longer be in the dropdown
    // (the button aria-label still has "Notifications" but the panel text is gone)
    expect(screen.queryByText('No notifications')).toBeNull();
  });

  it('shows "No notifications" when list is empty and panel is open', () => {
    render(<NotificationBell {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Notifications/i }));
    expect(screen.getByText('No notifications')).toBeDefined();
  });

  it('renders notification messages in the dropdown', () => {
    const notifications = [
      makeNotification({ id: 'n-1', message: 'Session completed', type: 'success' }),
      makeNotification({ id: 'n-2', message: 'Agent error occurred', type: 'error' }),
    ];
    render(<NotificationBell {...baseProps} notifications={notifications} unreadCount={2} />);
    fireEvent.click(screen.getByRole('button', { name: /Notifications/i }));
    expect(screen.getByText('Session completed')).toBeDefined();
    expect(screen.getByText('Agent error occurred')).toBeDefined();
  });

  it('shows "Mark all read" button only when there are unread notifications', () => {
    const notifications = [makeNotification({ id: 'n-1', read: false })];
    render(<NotificationBell {...baseProps} notifications={notifications} unreadCount={1} />);
    fireEvent.click(screen.getByRole('button', { name: /Notifications/i }));
    expect(screen.getByText('Mark all read')).toBeDefined();
  });

  it('does NOT show "Mark all read" when unreadCount is 0', () => {
    const notifications = [makeNotification({ id: 'n-1', read: true })];
    render(<NotificationBell {...baseProps} notifications={notifications} unreadCount={0} />);
    fireEvent.click(screen.getByRole('button', { name: /Notifications/i }));
    expect(screen.queryByText('Mark all read')).toBeNull();
  });

  it('calls onMarkAllRead when "Mark all read" is clicked', () => {
    const notifications = [makeNotification({ id: 'n-1', read: false })];
    render(<NotificationBell {...baseProps} notifications={notifications} unreadCount={1} />);
    fireEvent.click(screen.getByRole('button', { name: /Notifications/i }));
    fireEvent.click(screen.getByText('Mark all read'));
    expect(baseProps.onMarkAllRead).toHaveBeenCalledTimes(1);
  });

  it('shows "Clear" button when there are notifications', () => {
    const notifications = [makeNotification({ id: 'n-1' })];
    render(<NotificationBell {...baseProps} notifications={notifications} unreadCount={1} />);
    fireEvent.click(screen.getByRole('button', { name: /Notifications/i }));
    expect(screen.getByText('Clear')).toBeDefined();
  });

  it('does NOT show "Clear" button when notification list is empty', () => {
    render(<NotificationBell {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Notifications/i }));
    expect(screen.queryByText('Clear')).toBeNull();
  });

  it('calls onClearAll when "Clear" is clicked', () => {
    const notifications = [makeNotification({ id: 'n-1' })];
    render(<NotificationBell {...baseProps} notifications={notifications} unreadCount={0} />);
    fireEvent.click(screen.getByRole('button', { name: /Notifications/i }));
    fireEvent.click(screen.getByText('Clear'));
    expect(baseProps.onClearAll).toHaveBeenCalledTimes(1);
  });

  it('calls onMarkRead with notification id when dismiss button is clicked', () => {
    const notifications = [makeNotification({ id: 'n-42', message: 'Alert!' })];
    render(<NotificationBell {...baseProps} notifications={notifications} unreadCount={1} />);
    fireEvent.click(screen.getByRole('button', { name: /Notifications/i }));
    const dismissBtn = screen.getByRole('button', { name: /Dismiss notification/i });
    fireEvent.click(dismissBtn);
    expect(baseProps.onMarkRead).toHaveBeenCalledWith('n-42');
  });

  it('closes dropdown when Escape key is pressed', () => {
    render(<NotificationBell {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Notifications/i }));
    expect(screen.getByText('No notifications')).toBeDefined();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('No notifications')).toBeNull();
  });

  it('closes dropdown on outside click', () => {
    render(
      <div>
        <NotificationBell {...baseProps} />
        <div data-testid="outside">Outside</div>
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Notifications/i }));
    expect(screen.getByText('No notifications')).toBeDefined();

    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByText('No notifications')).toBeNull();
  });

  it('applies unread highlight class to unread notifications', () => {
    const notifications = [makeNotification({ id: 'n-1', read: false })];
    render(<NotificationBell {...baseProps} notifications={notifications} unreadCount={1} />);
    fireEvent.click(screen.getByRole('button', { name: /Notifications/i }));
    // The notification row should have bg-accent/10 for unread
    const messageEl = screen.getByText('Test notification');
    const row = messageEl.closest('[class*="border-b"]');
    expect(row?.className).toContain('bg-accent/10');
  });

  it('does NOT apply unread highlight class to read notifications', () => {
    const notifications = [makeNotification({ id: 'n-1', read: true })];
    render(<NotificationBell {...baseProps} notifications={notifications} unreadCount={0} />);
    fireEvent.click(screen.getByRole('button', { name: /Notifications/i }));
    const messageEl = screen.getByText('Test notification');
    const row = messageEl.closest('[class*="border-b"]');
    expect(row?.className).not.toContain('bg-accent/10');
  });

  it('displays relative timestamp for notifications', () => {
    const notifications = [makeNotification({ id: 'n-1', timestamp: Date.now() - 5 * 60_000 })];
    render(<NotificationBell {...baseProps} notifications={notifications} unreadCount={1} />);
    fireEvent.click(screen.getByRole('button', { name: /Notifications/i }));
    expect(screen.getByText('5m ago')).toBeDefined();
  });

  it('displays "just now" for very recent notifications', () => {
    const notifications = [makeNotification({ id: 'n-1', timestamp: Date.now() - 10_000 })];
    render(<NotificationBell {...baseProps} notifications={notifications} unreadCount={1} />);
    fireEvent.click(screen.getByRole('button', { name: /Notifications/i }));
    expect(screen.getByText('just now')).toBeDefined();
  });
});

// ===========================================================================
// ConfirmButton — additional tests for countdown timer display
// ===========================================================================

describe('ConfirmButton — countdown timer', () => {
  it('displays countdown seconds in confirming state', () => {
    vi.useFakeTimers();
    render(<ConfirmButton label="Delete" onConfirm={() => {}} timeout={3000} />);
    fireEvent.click(screen.getByRole('button'));

    // Should show (3s) countdown
    expect(screen.getByText('(3s)')).toBeDefined();
  });

  it('decrements countdown every second', async () => {
    vi.useFakeTimers();
    render(<ConfirmButton label="Delete" onConfirm={() => {}} timeout={3000} />);
    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByText('(3s)')).toBeDefined();

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('(2s)')).toBeDefined();

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('(1s)')).toBeDefined();
  });

  it('clears countdown after confirmation (second click)', () => {
    vi.useFakeTimers();
    const onConfirm = vi.fn();
    render(<ConfirmButton label="Delete" onConfirm={onConfirm} timeout={5000} />);
    const btn = screen.getByRole('button');

    fireEvent.click(btn); // enter confirming
    expect(screen.getByText('(5s)')).toBeDefined();

    fireEvent.click(btn); // confirm
    // Should be back to initial label, no countdown
    expect(screen.getByText('Delete')).toBeDefined();
    expect(screen.queryByText(/\(\d+s\)/)).toBeNull();
  });

  it('has aria-live="polite" for accessibility', () => {
    render(<ConfirmButton label="Delete" onConfirm={() => {}} />);
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-live')).toBe('polite');
  });
});

// ===========================================================================
// ErrorBoundary — additional tests for untested features
// ===========================================================================

describe('ErrorBoundary — additional coverage', () => {
  it('resets error state when resetKey prop changes', () => {
    let shouldThrow = true;

    const ConditionalError = () => {
      if (shouldThrow) {
        throw new Error('Boom');
      }
      return <div>Recovered</div>;
    };

    const { rerender } = render(
      <ErrorBoundary resetKey="key-1">
        <ConditionalError />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeDefined();

    shouldThrow = false;

    rerender(
      <ErrorBoundary resetKey="key-2">
        <ConditionalError />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Recovered')).toBeDefined();
  });

  it('does NOT reset when resetKey stays the same', () => {
    const ThrowError = () => {
      throw new Error('Boom');
    };

    const { rerender } = render(
      <ErrorBoundary resetKey="key-1">
        <ThrowError />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeDefined();

    rerender(
      <ErrorBoundary resetKey="key-1">
        <ThrowError />
      </ErrorBoundary>,
    );

    // Should still show error
    expect(screen.getByText('Something went wrong')).toBeDefined();
  });

  it('renders a "Reload page" button on error', () => {
    const ThrowError = () => {
      throw new Error('Test');
    };

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('button', { name: /Reload page/i })).toBeDefined();
  });

  it('renders "Error details" expandable section', () => {
    const ThrowError = () => {
      throw new Error('Detailed failure');
    };

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Error details')).toBeDefined();
  });

  it('shows error name and message inside the details section', () => {
    const ThrowError = () => {
      throw new Error('Something bad happened');
    };

    const { container } = render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );

    const pre = container.querySelector('pre');
    expect(pre).toBeDefined();
    expect(pre?.textContent).toContain('Error');
    expect(pre?.textContent).toContain('Something bad happened');
  });

  it('displays fallback message when error has no message', () => {
    const ThrowError = () => {
      throw new Error('');
    };

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );

    // The component renders error?.message which is '' — the p tag should still exist
    expect(screen.getByText('Something went wrong')).toBeDefined();
  });

  it('logs the error via componentDidCatch', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const ThrowError = () => {
      throw new Error('Caught error');
    };

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );

    const catchCall = consoleSpy.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('ErrorBoundary caught'),
    );
    expect(catchCall).toBeDefined();

    consoleSpy.mockRestore();
  });
});
