import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { StatCard } from './StatCard';
import { StatusBadge } from './StatusBadge';

// ---------------------------------------------------------------------------
// Mock SimpleTooltip so we can verify tooltip content without Radix overhead
// ---------------------------------------------------------------------------
vi.mock('./SimpleTooltip', () => ({
  SimpleTooltip: ({ content, children }: { content: string; children: React.ReactNode }) => (
    <div data-testid="simple-tooltip" data-tooltip-content={content}>
      {children}
    </div>
  ),
}));

// ===========================================================================
// StatusBadge
// ===========================================================================

describe('StatusBadge', () => {
  // -- Green statuses -------------------------------------------------------
  const greenStatuses = ['online', 'running', 'active', 'ok', 'success', 'completed'];
  it.each(greenStatuses)('renders "%s" with green styling', (status) => {
    const { container } = render(<StatusBadge status={status} />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge).toBeDefined();
    expect(badge.className).toContain('text-green-500');
    expect(screen.getByText(status)).toBeDefined();
  });

  // -- Blue statuses --------------------------------------------------------
  const blueStatuses = ['registered', 'restarting'];
  it.each(blueStatuses)('renders "%s" with blue styling', (status) => {
    const { container } = render(<StatusBadge status={status} />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.className).toContain('text-blue-500');
  });

  // -- Yellow statuses ------------------------------------------------------
  const yellowStatuses = ['starting', 'stopping', 'degraded'];
  it.each(yellowStatuses)('renders "%s" with yellow styling', (status) => {
    const { container } = render(<StatusBadge status={status} />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.className).toContain('text-yellow-500');
  });

  // -- Orange status --------------------------------------------------------
  it('renders "paused" with orange styling', () => {
    const { container } = render(<StatusBadge status="paused" />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.className).toContain('text-orange-500');
  });

  // -- Muted statuses -------------------------------------------------------
  const mutedStatuses = ['offline', 'stopped', 'idle', 'ended', 'cancelled'];
  it.each(mutedStatuses)('renders "%s" with muted styling', (status) => {
    const { container } = render(<StatusBadge status={status} />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.className).toContain('text-muted-foreground');
  });

  // -- Red statuses ---------------------------------------------------------
  const redStatuses = ['error', 'failure', 'timeout'];
  it.each(redStatuses)('renders "%s" with red styling', (status) => {
    const { container } = render(<StatusBadge status={status} />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.className).toContain('text-red-500');
  });

  // -- Unknown status fallback ----------------------------------------------
  it('falls back to muted styling for unknown status', () => {
    const { container } = render(<StatusBadge status="unknown_xyz" />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.className).toContain('text-muted-foreground');
    expect(screen.getByText('unknown_xyz')).toBeDefined();
  });

  // -- Pulse animation for active statuses ----------------------------------
  const pulseStatuses = ['running', 'active', 'starting', 'online', 'restarting'];
  it.each(pulseStatuses)('shows pulse animation for "%s"', (status) => {
    const { container } = render(<StatusBadge status={status} />);
    // The dot is the inner span with h-1.5/w-1.5; select it as the span inside the badge
    const badge = container.firstElementChild as HTMLElement;
    const dot = badge.querySelector('span');
    expect(dot).toBeDefined();
    expect(dot?.className).toContain('animate-pulse');
  });

  const noPulseStatuses = ['offline', 'error', 'paused', 'stopped', 'completed'];
  it.each(noPulseStatuses)('does NOT show pulse animation for "%s"', (status) => {
    const { container } = render(<StatusBadge status={status} />);
    const badge = container.firstElementChild as HTMLElement;
    const dot = badge.querySelector('span');
    expect(dot).toBeDefined();
    expect(dot?.className).not.toContain('animate-pulse');
  });

  // -- Capitalize class is applied ------------------------------------------
  it('applies the capitalize class', () => {
    const { container } = render(<StatusBadge status="running" />);
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.className).toContain('capitalize');
  });

  // -- Renders status text --------------------------------------------------
  it('renders the status string as visible text', () => {
    render(<StatusBadge status="degraded" />);
    expect(screen.getByText('degraded')).toBeDefined();
  });
});

// ===========================================================================
// StatCard
// ===========================================================================

describe('StatCard', () => {
  it('renders label and value', () => {
    render(<StatCard label="Agents" value="12" />);
    expect(screen.getByText('Agents')).toBeDefined();
    expect(screen.getByTestId('stat-value-Agents').textContent).toBe('12');
  });

  it('renders the data-testid on the root element', () => {
    render(<StatCard label="Total Cost" value="$5.23" />);
    expect(screen.getByTestId('stat-card-Total Cost')).toBeDefined();
  });

  // -- Sublabel -------------------------------------------------------------
  it('renders sublabel when provided', () => {
    render(<StatCard label="Sessions" value="42" sublabel="+3 today" />);
    expect(screen.getByTestId('stat-sublabel-Sessions')).toBeDefined();
    expect(screen.getByText('+3 today')).toBeDefined();
  });

  it('does NOT render sublabel when not provided', () => {
    render(<StatCard label="Sessions" value="42" />);
    expect(screen.queryByTestId('stat-sublabel-Sessions')).toBeNull();
  });

  // -- Accent colors --------------------------------------------------------
  const accents = ['green', 'yellow', 'red', 'blue', 'purple'] as const;
  it.each(accents)('applies the "%s" accent border class', (accent) => {
    render(<StatCard label="Test" value="0" accent={accent} />);
    const card = screen.getByTestId('stat-card-Test');
    expect(card.className).toContain(`border-l-${accent}-500/60`);
    expect(card.className).toContain('border-l-[3px]');
  });

  it('does NOT apply accent border when accent is omitted', () => {
    render(<StatCard label="Plain" value="0" />);
    const card = screen.getByTestId('stat-card-Plain');
    expect(card.className).not.toContain('border-l-[3px]');
  });

  // -- Tooltip --------------------------------------------------------------
  it('renders tooltip wrapper and info icon when tooltip is provided', () => {
    render(<StatCard label="Cost" value="$10" tooltip="Estimated total" />);
    const tooltipEl = screen.getByTestId('simple-tooltip');
    expect(tooltipEl).toBeDefined();
    expect(tooltipEl.getAttribute('data-tooltip-content')).toBe('Estimated total');
    // The Info icon should be rendered as an SVG inside the tooltip
    const svg = tooltipEl.querySelector('svg');
    expect(svg).toBeDefined();
  });

  it('does NOT render tooltip when tooltip prop is omitted', () => {
    render(<StatCard label="Cost" value="$10" />);
    expect(screen.queryByTestId('simple-tooltip')).toBeNull();
  });

  // -- Value formatting preserved -------------------------------------------
  it('preserves special characters in value (e.g. currency)', () => {
    render(<StatCard label="Revenue" value="$1,234.56" />);
    expect(screen.getByTestId('stat-value-Revenue').textContent).toBe('$1,234.56');
  });
});
