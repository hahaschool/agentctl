import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('lucide-react', () => ({
  RefreshCw: (props: Record<string, unknown>) => <svg data-testid="refresh-icon" {...props} />,
}));

import { LastUpdated } from './LastUpdated';
import { RefreshButton } from './RefreshButton';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ===========================================================================
// LastUpdated
// ===========================================================================
describe('LastUpdated', () => {
  it('returns null when dataUpdatedAt is 0', () => {
    const { container } = render(<LastUpdated dataUpdatedAt={0} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows "just now" when updated less than 5 seconds ago', () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    render(<LastUpdated dataUpdatedAt={now - 2000} />);
    expect(screen.getByText('Updated just now')).toBeDefined();
  });

  it('shows seconds ago when updated between 5 and 59 seconds ago', () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    render(<LastUpdated dataUpdatedAt={now - 30_000} />);
    expect(screen.getByText('Updated 30s ago')).toBeDefined();
  });

  it('shows minutes ago when updated 60+ seconds ago', () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    render(<LastUpdated dataUpdatedAt={now - 180_000} />);
    expect(screen.getByText('Updated 3m ago')).toBeDefined();
  });

  it('has a title attribute for accessibility', () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    render(<LastUpdated dataUpdatedAt={now} />);
    const el = screen.getByTitle('Last data refresh');
    expect(el).toBeDefined();
  });
});

// ===========================================================================
// RefreshButton
// ===========================================================================
describe('RefreshButton', () => {
  it('calls onClick when clicked', () => {
    const handler = vi.fn();
    render(<RefreshButton onClick={handler} />);
    fireEvent.click(screen.getByTestId('refresh-button'));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('renders default "Refresh" label', () => {
    render(<RefreshButton onClick={vi.fn()} />);
    expect(screen.getByText('Refresh')).toBeDefined();
  });

  it('renders custom label', () => {
    render(<RefreshButton onClick={vi.fn()} label="Reload" />);
    expect(screen.getByText('Reload')).toBeDefined();
    expect(screen.queryByText('Refresh')).toBeNull();
  });

  it('is disabled when isFetching is true', () => {
    render(<RefreshButton onClick={vi.fn()} isFetching />);
    const btn = screen.getByTestId('refresh-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('is enabled when isFetching is false', () => {
    render(<RefreshButton onClick={vi.fn()} isFetching={false} />);
    const btn = screen.getByTestId('refresh-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('does not fire onClick when disabled', () => {
    const handler = vi.fn();
    render(<RefreshButton onClick={handler} isFetching />);
    fireEvent.click(screen.getByTestId('refresh-button'));
    expect(handler).not.toHaveBeenCalled();
  });

  it('applies animate-spin class to icon when fetching', () => {
    render(<RefreshButton onClick={vi.fn()} isFetching />);
    const icon = screen.getByTestId('refresh-icon');
    expect(icon.className).toContain('animate-spin');
  });

  it('does not apply animate-spin class when not fetching', () => {
    render(<RefreshButton onClick={vi.fn()} isFetching={false} />);
    const icon = screen.getByTestId('refresh-icon');
    expect(icon.className).not.toContain('animate-spin');
  });

  it('uses label for aria-label', () => {
    render(<RefreshButton onClick={vi.fn()} label="Sync now" />);
    const btn = screen.getByTestId('refresh-button');
    expect(btn.getAttribute('aria-label')).toBe('Sync now');
  });
});
