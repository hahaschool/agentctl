import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { DependencyInfo } from './LogsDependencyCard';
import { LogsDependencyCard } from './LogsDependencyCard';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('./StatusBadge', () => ({
  StatusBadge: ({ status }: { status: string }) => <span data-testid="status-badge">{status}</span>,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDep(overrides: Partial<DependencyInfo> = {}): DependencyInfo {
  return {
    status: 'ok',
    latencyMs: 100,
    ...overrides,
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe('LogsDependencyCard', () => {
  // -----------------------------------------------------------------------
  // Basic rendering
  // -----------------------------------------------------------------------

  it('renders the dependency name', () => {
    render(<LogsDependencyCard name="postgres" dep={makeDep()} />);
    expect(screen.getByText('postgres')).toBeDefined();
  });

  it('renders the StatusBadge with correct status', () => {
    render(<LogsDependencyCard name="redis" dep={makeDep({ status: 'error' })} />);
    const badge = screen.getByTestId('status-badge');
    expect(badge.textContent).toBe('error');
  });

  it('renders latency value', () => {
    render(<LogsDependencyCard name="redis" dep={makeDep({ latencyMs: 250 })} />);
    expect(screen.getByText(/Latency: 250ms/)).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Latency thresholds
  // -----------------------------------------------------------------------

  it('shows normal latency without any warning text', () => {
    render(<LogsDependencyCard name="db" dep={makeDep({ latencyMs: 100 })} />);
    const latencyEl = screen.getByText(/Latency:/);
    expect(latencyEl.textContent).toBe('Latency: 100ms');
    expect(latencyEl.className).toContain('text-muted-foreground');
  });

  it('shows "(slow)" for latency > 500ms and applies yellow color', () => {
    render(<LogsDependencyCard name="db" dep={makeDep({ latencyMs: 750 })} />);
    const latencyEl = screen.getByText(/Latency:/);
    expect(latencyEl.textContent).toContain('(slow)');
    expect(latencyEl.className).toContain('text-yellow-500');
  });

  it('shows "(critical)" for latency > 2000ms and applies red color', () => {
    render(<LogsDependencyCard name="db" dep={makeDep({ latencyMs: 3000 })} />);
    const latencyEl = screen.getByText(/Latency:/);
    expect(latencyEl.textContent).toContain('(critical)');
    expect(latencyEl.className).toContain('text-red-500');
  });

  it('does not show "(slow)" when latency is exactly 500', () => {
    render(<LogsDependencyCard name="db" dep={makeDep({ latencyMs: 500 })} />);
    const latencyEl = screen.getByText(/Latency:/);
    expect(latencyEl.textContent).not.toContain('(slow)');
  });

  // -----------------------------------------------------------------------
  // Border colors based on status and latency
  // -----------------------------------------------------------------------

  it('applies error border when status is error', () => {
    const { container } = render(
      <LogsDependencyCard name="db" dep={makeDep({ status: 'error', latencyMs: 100 })} />,
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('border-red-500/40');
  });

  it('applies yellow border for critical latency (ok status)', () => {
    const { container } = render(
      <LogsDependencyCard name="db" dep={makeDep({ status: 'ok', latencyMs: 2500 })} />,
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('border-yellow-500/40');
  });

  it('applies default border for ok status and normal latency', () => {
    const { container } = render(
      <LogsDependencyCard name="db" dep={makeDep({ status: 'ok', latencyMs: 100 })} />,
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('border-border/50');
  });

  // -----------------------------------------------------------------------
  // Error display - expand/collapse
  // -----------------------------------------------------------------------

  it('does not show error toggle button when no error', () => {
    render(<LogsDependencyCard name="db" dep={makeDep()} />);
    expect(screen.queryByText('Show error')).toBeNull();
    expect(screen.queryByText('Hide error')).toBeNull();
  });

  it('shows "Show error" button when error is present', () => {
    render(<LogsDependencyCard name="db" dep={makeDep({ error: 'Connection refused' })} />);
    expect(screen.getByText('Show error')).toBeDefined();
  });

  it('does not show error text by default', () => {
    render(<LogsDependencyCard name="db" dep={makeDep({ error: 'Connection refused' })} />);
    expect(screen.queryByText('Connection refused')).toBeNull();
  });

  it('reveals error text when "Show error" is clicked', () => {
    render(<LogsDependencyCard name="db" dep={makeDep({ error: 'Connection refused' })} />);
    fireEvent.click(screen.getByText('Show error'));
    expect(screen.getByText('Connection refused')).toBeDefined();
    expect(screen.getByText('Hide error')).toBeDefined();
  });

  it('hides error text when "Hide error" is clicked', () => {
    render(<LogsDependencyCard name="db" dep={makeDep({ error: 'Connection refused' })} />);
    // Expand
    fireEvent.click(screen.getByText('Show error'));
    expect(screen.getByText('Connection refused')).toBeDefined();

    // Collapse
    fireEvent.click(screen.getByText('Hide error'));
    expect(screen.queryByText('Connection refused')).toBeNull();
    expect(screen.getByText('Show error')).toBeDefined();
  });

  it('toggles error visibility multiple times', () => {
    render(<LogsDependencyCard name="db" dep={makeDep({ error: 'Timeout' })} />);

    // Toggle open
    fireEvent.click(screen.getByText('Show error'));
    expect(screen.getByText('Timeout')).toBeDefined();

    // Toggle close
    fireEvent.click(screen.getByText('Hide error'));
    expect(screen.queryByText('Timeout')).toBeNull();

    // Toggle open again
    fireEvent.click(screen.getByText('Show error'));
    expect(screen.getByText('Timeout')).toBeDefined();
  });
});
