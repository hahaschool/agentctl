import { act, fireEvent, render, screen } from '@testing-library/react';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  WifiOff: (props: Record<string, unknown>) => <svg data-testid="icon-wifi-off" {...props} />,
  RefreshCw: (props: Record<string, unknown>) => <svg data-testid="icon-refresh" {...props} />,
}));

import { ConnectionBanner } from './ConnectionBanner';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('ConnectionBanner', () => {
  describe('visibility based on status', () => {
    it('returns null when status is "connected"', () => {
      const { container } = render(<ConnectionBanner status="connected" />);
      expect(container.innerHTML).toBe('');
    });

    it('returns null when status is "connecting"', () => {
      const { container } = render(<ConnectionBanner status="connecting" />);
      expect(container.innerHTML).toBe('');
    });

    it('renders the banner when status is "disconnected"', () => {
      vi.useFakeTimers();
      render(<ConnectionBanner status="disconnected" />);
      expect(screen.getByRole('alert')).toBeDefined();
      expect(screen.getByText(/Connection lost/)).toBeDefined();
    });
  });

  describe('elapsed time display', () => {
    it('shows "0s ago" immediately after disconnecting', () => {
      vi.useFakeTimers();
      render(<ConnectionBanner status="disconnected" />);
      expect(screen.getByText(/0s ago/)).toBeDefined();
    });

    it('increments elapsed time as seconds pass', () => {
      vi.useFakeTimers();
      render(<ConnectionBanner status="disconnected" />);
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.getByText(/5s ago/)).toBeDefined();
    });

    it('switches to minute format after 60 seconds', () => {
      vi.useFakeTimers();
      render(<ConnectionBanner status="disconnected" />);
      act(() => {
        vi.advanceTimersByTime(90_000);
      });
      expect(screen.getByText(/1m ago/)).toBeDefined();
    });
  });

  describe('state transitions', () => {
    it('hides the banner when status transitions from disconnected to connected', () => {
      vi.useFakeTimers();
      const { rerender, container } = render(<ConnectionBanner status="disconnected" />);
      expect(screen.getByRole('alert')).toBeDefined();

      rerender(<ConnectionBanner status="connected" />);
      expect(container.innerHTML).toBe('');
    });

    it('resets elapsed timer when reconnected and then disconnected again', () => {
      vi.useFakeTimers();
      const { rerender } = render(<ConnectionBanner status="disconnected" />);
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(screen.getByText(/10s ago/)).toBeDefined();

      // Reconnect
      rerender(<ConnectionBanner status="connected" />);
      // Disconnect again
      rerender(<ConnectionBanner status="disconnected" />);
      // Should start from 0 again
      expect(screen.getByText(/0s ago/)).toBeDefined();
    });
  });

  describe('Dismiss button', () => {
    it('hides the banner when Dismiss is clicked', () => {
      vi.useFakeTimers();
      const { container } = render(<ConnectionBanner status="disconnected" />);
      expect(screen.getByRole('alert')).toBeDefined();

      fireEvent.click(screen.getByText('Dismiss'));
      expect(container.innerHTML).toBe('');
    });

    it('re-shows banner if status cycles back to disconnected after dismiss', () => {
      vi.useFakeTimers();
      const { rerender } = render(<ConnectionBanner status="disconnected" />);
      fireEvent.click(screen.getByText('Dismiss'));

      // Reconnect then disconnect again — dismissed flag should reset
      rerender(<ConnectionBanner status="connected" />);
      rerender(<ConnectionBanner status="disconnected" />);
      expect(screen.getByRole('alert')).toBeDefined();
    });
  });

  describe('Retry now button', () => {
    it('calls window.location.reload when clicked', () => {
      vi.useFakeTimers();
      const reloadMock = vi.fn();
      Object.defineProperty(window, 'location', {
        value: { ...window.location, reload: reloadMock },
        writable: true,
        configurable: true,
      });

      render(<ConnectionBanner status="disconnected" />);
      fireEvent.click(screen.getByText('Retry now'));
      expect(reloadMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('content', () => {
    it('renders the WifiOff icon', () => {
      vi.useFakeTimers();
      render(<ConnectionBanner status="disconnected" />);
      expect(screen.getByTestId('icon-wifi-off')).toBeDefined();
    });

    it('renders both Retry now and Dismiss buttons', () => {
      vi.useFakeTimers();
      render(<ConnectionBanner status="disconnected" />);
      expect(screen.getByText('Retry now')).toBeDefined();
      expect(screen.getByText('Dismiss')).toBeDefined();
    });
  });
});
