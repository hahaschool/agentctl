import { render, screen } from '@testing-library/react';

import { ConfidenceBar } from './ConfidenceBar';

describe('ConfidenceBar', () => {
  it('renders a progressbar with percentage text', () => {
    render(<ConfidenceBar confidence={0.82} />);

    expect(
      screen.getByRole('progressbar', { name: 'Confidence' }).getAttribute('aria-valuenow'),
    ).toBe('82');
    expect(screen.getByText('82%')).toBeDefined();
  });

  it('clamps the confidence percentage', () => {
    render(<ConfidenceBar confidence={2} />);

    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
  });
});
