import { render, screen } from '@testing-library/react';

import { ScopeBadge } from './ScopeBadge';

describe('ScopeBadge', () => {
  it('renders a global scope badge', () => {
    render(<ScopeBadge scope="global" />);

    expect(screen.getByText('global')).toBeDefined();
  });

  it('applies project styling for project scopes', () => {
    render(<ScopeBadge scope="project:agentctl" />);

    expect(screen.getByText('project:agentctl').className).toContain('emerald');
  });
});
