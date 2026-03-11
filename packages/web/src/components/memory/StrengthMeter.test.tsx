import { render, screen } from '@testing-library/react';

import { StrengthMeter } from './StrengthMeter';

describe('StrengthMeter', () => {
  it('renders a progressbar with percentage label', () => {
    render(<StrengthMeter strength={0.75} />);

    const bar = screen.getByRole('progressbar', { name: 'Strength' });
    expect(bar.getAttribute('aria-valuenow')).toBe('75');
    expect(screen.getByText('75%')).toBeDefined();
  });

  it('hides the label when showLabel is false', () => {
    render(<StrengthMeter strength={0.5} showLabel={false} />);

    expect(screen.queryByText('50%')).toBeNull();
    expect(screen.getByRole('progressbar')).toBeDefined();
  });

  it('clamps strength values outside 0-1 range', () => {
    render(<StrengthMeter strength={1.5} />);

    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
  });
});
