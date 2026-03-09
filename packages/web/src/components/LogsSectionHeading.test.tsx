import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LogsSectionHeading } from './LogsSectionHeading';

// ===========================================================================
// Tests
// ===========================================================================

describe('LogsSectionHeading', () => {
  it('renders children text', () => {
    render(<LogsSectionHeading>Audit Trail</LogsSectionHeading>);
    expect(screen.getByText('Audit Trail')).toBeDefined();
  });

  it('renders as an h2 element', () => {
    render(<LogsSectionHeading>Metrics</LogsSectionHeading>);
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading).toBeDefined();
    expect(heading.textContent).toBe('Metrics');
  });

  it('applies expected styling classes', () => {
    render(<LogsSectionHeading>Dependencies</LogsSectionHeading>);
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.className).toContain('text-[15px]');
    expect(heading.className).toContain('font-semibold');
    expect(heading.className).toContain('text-muted-foreground');
  });

  it('renders complex children (JSX)', () => {
    render(
      <LogsSectionHeading>
        <span data-testid="inner">Complex</span> Content
      </LogsSectionHeading>,
    );
    expect(screen.getByTestId('inner')).toBeDefined();
    expect(screen.getByText('Complex')).toBeDefined();
  });

  it('renders empty children without error', () => {
    const { container } = render(<LogsSectionHeading>{''}</LogsSectionHeading>);
    const heading = container.querySelector('h2');
    expect(heading).toBeDefined();
    expect(heading?.textContent).toBe('');
  });
});
