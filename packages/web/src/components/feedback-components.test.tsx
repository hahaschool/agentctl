import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ConnectionBanner } from './ConnectionBanner';
import { EmptyState } from './EmptyState';
import { ErrorBanner } from './ErrorBanner';
import { FetchingBar } from './FetchingBar';
import { Spinner } from './Spinner';

// ===========================================================================
// EmptyState
// ===========================================================================
describe('EmptyState', () => {
  it('renders title text', () => {
    render(<EmptyState title="No items found" />);
    expect(screen.getByText('No items found')).toBeDefined();
  });

  it('renders description when provided', () => {
    render(<EmptyState title="Empty" description="Try creating one." />);
    expect(screen.getByText('Try creating one.')).toBeDefined();
  });

  it('does not render description when omitted', () => {
    render(<EmptyState title="Empty" />);
    expect(screen.queryByText('Try creating one.')).toBeNull();
  });

  it('renders a string icon as emoji text', () => {
    render(<EmptyState title="Empty" icon="🔍" />);
    expect(screen.getByText('🔍')).toBeDefined();
  });

  it('renders a component icon', () => {
    const TestIcon = ({ size, className }: { size?: number; className?: string }) => (
      <svg data-testid="test-icon" width={size} className={className} />
    );
    render(<EmptyState title="Empty" icon={TestIcon} />);
    expect(screen.getByTestId('test-icon')).toBeDefined();
  });

  it('does not render icon when omitted', () => {
    const { container } = render(<EmptyState title="Empty" />);
    // No svg or emoji container beyond the title wrapper
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBe(0);
  });

  it('renders action slot when provided', () => {
    render(<EmptyState title="Empty" action={<button type="button">Create</button>} />);
    expect(screen.getByRole('button', { name: 'Create' })).toBeDefined();
  });

  it('does not render action slot when omitted', () => {
    render(<EmptyState title="Empty" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('defaults to "default" variant styling', () => {
    const { container } = render(<EmptyState title="Default" />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('py-16');
  });

  it('applies compact variant styling', () => {
    const { container } = render(<EmptyState title="Compact" variant="compact" />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('py-6');
  });
});

// ===========================================================================
// ErrorBanner
// ===========================================================================
describe('ErrorBanner', () => {
  it('renders the error message', () => {
    render(<ErrorBanner message="Something went wrong" />);
    expect(screen.getByText('Something went wrong')).toBeDefined();
  });

  it('has role="alert"', () => {
    render(<ErrorBanner message="Error" />);
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('renders hint text when provided', () => {
    render(<ErrorBanner message="Error" hint="Check your connection" />);
    expect(screen.getByText('Check your connection')).toBeDefined();
  });

  it('does not render hint when omitted', () => {
    render(<ErrorBanner message="Error" />);
    expect(screen.queryByText('Check your connection')).toBeNull();
  });

  it('renders Retry button when onRetry is provided', () => {
    const onRetry = vi.fn();
    render(<ErrorBanner message="Error" onRetry={onRetry} />);
    const btn = screen.getByRole('button', { name: 'Retry' });
    expect(btn).toBeDefined();
  });

  it('calls onRetry when Retry button is clicked', () => {
    const onRetry = vi.fn();
    render(<ErrorBanner message="Error" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not render Retry button when onRetry is omitted', () => {
    render(<ErrorBanner message="Error" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('applies custom className', () => {
    const { container } = render(<ErrorBanner message="Error" className="my-custom" />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('my-custom');
  });
});

// ===========================================================================
// ConnectionBanner
// ===========================================================================
describe('ConnectionBanner', () => {
  it('renders nothing when status is "connected"', () => {
    const { container } = render(<ConnectionBanner status="connected" />);
    expect(container.firstElementChild).toBeNull();
  });

  it('renders nothing when status is "connecting"', () => {
    const { container } = render(<ConnectionBanner status="connecting" />);
    expect(container.firstElementChild).toBeNull();
  });

  it('renders banner when status is "disconnected"', () => {
    render(<ConnectionBanner status="disconnected" />);
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText(/Connection lost/)).toBeDefined();
  });

  it('shows "Retry now" button when disconnected', () => {
    render(<ConnectionBanner status="disconnected" />);
    expect(screen.getByRole('button', { name: /Retry now/ })).toBeDefined();
  });

  it('shows "Dismiss" button when disconnected', () => {
    render(<ConnectionBanner status="disconnected" />);
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeDefined();
  });

  it('hides banner after Dismiss is clicked', () => {
    render(<ConnectionBanner status="disconnected" />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('resets dismissed state when status changes back to connected then disconnected', () => {
    const { rerender } = render(<ConnectionBanner status="disconnected" />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();

    // Reconnect
    rerender(<ConnectionBanner status="connected" />);
    // Disconnect again
    rerender(<ConnectionBanner status="disconnected" />);
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('calls window.location.reload when Retry now is clicked', () => {
    const reloadMock = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: reloadMock },
      writable: true,
      configurable: true,
    });

    render(<ConnectionBanner status="disconnected" />);
    fireEvent.click(screen.getByRole('button', { name: /Retry now/ }));
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// FetchingBar
// ===========================================================================
describe('FetchingBar', () => {
  it('renders with role="progressbar"', () => {
    render(<FetchingBar isFetching={true} />);
    expect(screen.getByRole('progressbar')).toBeDefined();
  });

  it('is visible (opacity-100) when isFetching is true', () => {
    render(<FetchingBar isFetching={true} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.className).toContain('opacity-100');
    expect(bar.getAttribute('aria-hidden')).toBe('false');
  });

  it('is hidden (opacity-0) when isFetching is false', () => {
    render(<FetchingBar isFetching={false} />);
    const bar = screen.getByRole('progressbar', { hidden: true });
    expect(bar.className).toContain('opacity-0');
    expect(bar.getAttribute('aria-hidden')).toBe('true');
  });

  it('transitions between states on prop change', () => {
    const { rerender } = render(<FetchingBar isFetching={false} />);
    const bar = screen.getByRole('progressbar', { hidden: true });
    expect(bar.className).toContain('opacity-0');

    rerender(<FetchingBar isFetching={true} />);
    expect(bar.className).toContain('opacity-100');
  });
});

// ===========================================================================
// Spinner
// ===========================================================================
describe('Spinner', () => {
  it('renders with aria-label "Loading"', () => {
    render(<Spinner />);
    expect(screen.getByLabelText('Loading')).toBeDefined();
  });

  it('defaults to md size', () => {
    render(<Spinner />);
    const el = screen.getByLabelText('Loading');
    expect(el.className).toContain('h-6');
    expect(el.className).toContain('w-6');
  });

  it('renders sm size', () => {
    render(<Spinner size="sm" />);
    const el = screen.getByLabelText('Loading');
    expect(el.className).toContain('h-4');
    expect(el.className).toContain('w-4');
  });

  it('renders lg size', () => {
    render(<Spinner size="lg" />);
    const el = screen.getByLabelText('Loading');
    expect(el.className).toContain('h-10');
    expect(el.className).toContain('w-10');
  });

  it('applies custom className', () => {
    render(<Spinner className="extra-class" />);
    const el = screen.getByLabelText('Loading');
    expect(el.className).toContain('extra-class');
  });

  it('has spin animation class', () => {
    render(<Spinner />);
    const el = screen.getByLabelText('Loading');
    expect(el.className).toContain('animate-spin');
  });
});
