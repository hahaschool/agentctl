import { render, screen } from '@testing-library/react';

import { EntityTypeBadge } from './EntityTypeBadge';

describe('EntityTypeBadge', () => {
  it('renders a human-friendly entity type label', () => {
    render(<EntityTypeBadge entityType="code_artifact" />);

    expect(screen.getByText('code artifact')).toBeDefined();
  });

  it('applies an entity-specific color class', () => {
    render(<EntityTypeBadge entityType="decision" />);

    expect(screen.getByText('decision').className).toContain('amber');
  });
});
