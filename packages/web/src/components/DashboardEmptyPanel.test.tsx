import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className, ...props }: { className?: string }) => (
    <div data-testid="skeleton" className={className} {...props} />
  ),
}));

import { DashboardEmptyPanel } from './DashboardEmptyPanel';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DashboardEmptyPanel', () => {
  describe('loading state', () => {
    it('renders skeletons when loading is true', () => {
      render(<DashboardEmptyPanel loading={true} message="No data" />);
      const skeletons = screen.getAllByTestId('skeleton');
      // 3 rows, each with 4 skeletons (circle + 2 bars + right bar) = 12 total
      expect(skeletons.length).toBe(12);
    });

    it('does not render message when loading', () => {
      render(<DashboardEmptyPanel loading={true} message="No data available" />);
      expect(screen.queryByText('No data available')).toBeNull();
    });
  });

  describe('empty state', () => {
    it('renders the message when not loading', () => {
      render(<DashboardEmptyPanel loading={false} message="No sessions found" />);
      expect(screen.getByText('No sessions found')).toBeDefined();
    });

    it('does not render skeletons when not loading', () => {
      render(<DashboardEmptyPanel loading={false} message="Empty" />);
      expect(screen.queryByTestId('skeleton')).toBeNull();
    });

    it('renders different messages', () => {
      const { rerender } = render(
        <DashboardEmptyPanel loading={false} message="No agents configured" />,
      );
      expect(screen.getByText('No agents configured')).toBeDefined();

      rerender(<DashboardEmptyPanel loading={false} message="No recent activity" />);
      expect(screen.getByText('No recent activity')).toBeDefined();
      expect(screen.queryByText('No agents configured')).toBeNull();
    });
  });
});
