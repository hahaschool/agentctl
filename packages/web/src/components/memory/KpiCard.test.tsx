import { render, screen } from '@testing-library/react';

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { KpiCard } from './KpiCard';

describe('KpiCard', () => {
  it('renders label and value', () => {
    render(<KpiCard label="Total Facts" value="1,234" />);

    expect(screen.getByText('Total Facts')).toBeDefined();
    expect(screen.getByTestId('kpi-value-Total Facts')).toBeDefined();
    expect(screen.getByText('1,234')).toBeDefined();
  });

  it('renders sublabel when provided', () => {
    render(<KpiCard label="Total Facts" value="1,234" sublabel="+12 today" />);

    expect(screen.getByTestId('kpi-sublabel-Total Facts').textContent).toBe('+12 today');
  });

  it('does not render sublabel when not provided', () => {
    render(<KpiCard label="Total Facts" value="1,234" />);

    expect(screen.queryByTestId('kpi-sublabel-Total Facts')).toBeNull();
  });

  it('shows loading skeleton when isLoading is true', () => {
    render(<KpiCard label="Total Facts" value="1,234" isLoading />);

    expect(screen.getByTestId('kpi-loading')).toBeDefined();
    expect(screen.queryByTestId('kpi-value-Total Facts')).toBeNull();
  });

  it('hides sublabel while loading', () => {
    render(<KpiCard label="Total Facts" value="1,234" sublabel="+12 today" isLoading />);

    expect(screen.queryByTestId('kpi-sublabel-Total Facts')).toBeNull();
  });

  it('has a data-testid on the root element', () => {
    render(<KpiCard label="My Label" value="42" />);

    expect(screen.getByTestId('kpi-card-My Label')).toBeDefined();
  });
});
