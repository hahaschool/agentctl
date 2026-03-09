import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LogsMetricCard } from './LogsMetricCard';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('lucide-react', () => ({
  Info: (props: Record<string, unknown>) => <svg data-testid="info-icon" {...props} />,
}));

vi.mock('./SimpleTooltip', () => ({
  SimpleTooltip: ({ content, children }: { content: string; children: React.ReactNode }) => (
    <div data-testid="simple-tooltip" data-tooltip-content={content}>
      {children}
    </div>
  ),
}));

// ===========================================================================
// Tests
// ===========================================================================

describe('LogsMetricCard', () => {
  // -----------------------------------------------------------------------
  // Basic rendering
  // -----------------------------------------------------------------------

  it('renders label and value', () => {
    render(<LogsMetricCard label="Total Actions" value="1,234" />);
    expect(screen.getByText('Total Actions')).toBeDefined();
    expect(screen.getByText('1,234')).toBeDefined();
  });

  it('renders value with default foreground style when no variant', () => {
    const { container } = render(<LogsMetricCard label="Count" value="42" />);
    const valueEl = container.querySelector('.text-2xl') as HTMLElement;
    expect(valueEl.className).toContain('text-foreground');
  });

  // -----------------------------------------------------------------------
  // Value variants
  // -----------------------------------------------------------------------

  it('applies green class for green valueVariant', () => {
    const { container } = render(
      <LogsMetricCard label="Success" value="99%" valueVariant="green" />,
    );
    const valueEl = container.querySelector('.text-2xl') as HTMLElement;
    expect(valueEl.className).toContain('text-green-500');
  });

  it('applies red class for red valueVariant', () => {
    const { container } = render(<LogsMetricCard label="Errors" value="15" valueVariant="red" />);
    const valueEl = container.querySelector('.text-2xl') as HTMLElement;
    expect(valueEl.className).toContain('text-red-500');
  });

  it('applies yellow class for yellow valueVariant', () => {
    const { container } = render(
      <LogsMetricCard label="Warnings" value="7" valueVariant="yellow" />,
    );
    const valueEl = container.querySelector('.text-2xl') as HTMLElement;
    expect(valueEl.className).toContain('text-yellow-500');
  });

  // -----------------------------------------------------------------------
  // Custom valueClassName overrides variant
  // -----------------------------------------------------------------------

  it('uses valueClassName instead of variant when both provided', () => {
    const { container } = render(
      <LogsMetricCard
        label="Custom"
        value="X"
        valueVariant="green"
        valueClassName="text-purple-500"
      />,
    );
    const valueEl = container.querySelector('.text-2xl') as HTMLElement;
    expect(valueEl.className).toContain('text-purple-500');
    expect(valueEl.className).not.toContain('text-green-500');
  });

  it('uses valueClassName when no variant is provided', () => {
    const { container } = render(
      <LogsMetricCard label="Custom" value="Y" valueClassName="text-orange-600 font-bold" />,
    );
    const valueEl = container.querySelector('.text-2xl') as HTMLElement;
    expect(valueEl.className).toContain('text-orange-600');
  });

  // -----------------------------------------------------------------------
  // Accent border
  // -----------------------------------------------------------------------

  it.each([
    ['green', 'border-l-green-500/60'],
    ['yellow', 'border-l-yellow-500/60'],
    ['red', 'border-l-red-500/60'],
    ['blue', 'border-l-blue-500/60'],
    ['purple', 'border-l-purple-500/60'],
  ] as const)('applies accent border for "%s"', (accent, expectedClass) => {
    const { container } = render(<LogsMetricCard label="Metric" value="1" accent={accent} />);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain(expectedClass);
    expect(card.className).toContain('border-l-[3px]');
  });

  it('does not apply accent border when accent is undefined', () => {
    const { container } = render(<LogsMetricCard label="Metric" value="1" />);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).not.toContain('border-l-[3px]');
  });

  // -----------------------------------------------------------------------
  // Tooltip
  // -----------------------------------------------------------------------

  it('renders SimpleTooltip with info icon when tooltip is provided', () => {
    render(<LogsMetricCard label="Error Rate" value="2%" tooltip="Errors in the last hour" />);
    const tooltip = screen.getByTestId('simple-tooltip');
    expect(tooltip).toBeDefined();
    expect(tooltip.getAttribute('data-tooltip-content')).toBe('Errors in the last hour');
    expect(screen.getByTestId('info-icon')).toBeDefined();
  });

  it('renders label directly without tooltip wrapper when no tooltip', () => {
    render(<LogsMetricCard label="Plain Label" value="10" />);
    expect(screen.queryByTestId('simple-tooltip')).toBeNull();
    expect(screen.queryByTestId('info-icon')).toBeNull();
    expect(screen.getByText('Plain Label')).toBeDefined();
  });

  it('renders label text inside tooltip when tooltip is provided', () => {
    render(<LogsMetricCard label="Throughput" value="100" tooltip="Requests per second" />);
    expect(screen.getByText('Throughput')).toBeDefined();
  });
});
