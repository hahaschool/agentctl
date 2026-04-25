import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { DashboardQuickActions } from './DashboardQuickActions';

describe('DashboardQuickActions', () => {
  it('renders dashboard quick actions with accessible names and hrefs', () => {
    render(<DashboardQuickActions />);

    const actions = [
      { name: 'Start Agent', href: '/agents?new=1' },
      { name: 'New Session', href: '/sessions?new=1' },
      { name: 'View Logs', href: '/logs' },
      { name: 'Discover Sessions', href: '/discover' },
    ];

    for (const action of actions) {
      const link = screen.getByRole('link', { name: action.name, exact: true });
      expect(link).toHaveAttribute('href', action.href);

      const icon = link.querySelector('svg');
      expect(icon).not.toBeNull();
      expect(icon).toHaveAttribute('aria-hidden', 'true');
      expect(within(link).queryByRole('img')).toBeNull();
    }
  });
});
