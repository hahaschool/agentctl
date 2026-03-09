import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock Skeleton component
// ---------------------------------------------------------------------------
vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div data-testid="skeleton" className={className} />
  ),
}));

import { DiscoverLoadingSkeleton } from './DiscoverLoadingSkeleton';

// ===========================================================================
// DiscoverLoadingSkeleton
// ===========================================================================
describe('DiscoverLoadingSkeleton', () => {
  it('renders without crashing', () => {
    const { container } = render(<DiscoverLoadingSkeleton />);
    expect(container.firstElementChild).not.toBeNull();
  });

  it('renders exactly 3 skeleton groups', () => {
    const { container } = render(<DiscoverLoadingSkeleton />);
    // Each group is a child div of the flex container
    const groups = container.firstElementChild?.children;
    expect(groups?.length).toBe(3);
  });

  it('renders Skeleton elements', () => {
    const { getAllByTestId } = render(<DiscoverLoadingSkeleton />);
    const skeletons = getAllByTestId('skeleton');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('renders the first group with 4 session rows', () => {
    const { container } = render(<DiscoverLoadingSkeleton />);
    const firstGroup = container.firstElementChild?.children[0];
    // The group has a header div and a rows div
    const rowsContainer = firstGroup?.children[1];
    expect(rowsContainer?.children.length).toBe(4);
  });

  it('renders the second and third groups with 2 session rows each', () => {
    const { container } = render(<DiscoverLoadingSkeleton />);
    const groups = container.firstElementChild?.children;

    const secondGroupRows = groups?.[1]?.children[1];
    expect(secondGroupRows?.children.length).toBe(2);

    const thirdGroupRows = groups?.[2]?.children[1];
    expect(thirdGroupRows?.children.length).toBe(2);
  });

  it('renders header skeletons in each group', () => {
    const { container } = render(<DiscoverLoadingSkeleton />);
    const groups = container.firstElementChild?.children;

    // Each group header (first child) should contain Skeleton elements
    for (let i = 0; i < 3; i++) {
      const header = groups?.[i]?.children[0];
      const skeletons = header?.querySelectorAll('[data-testid="skeleton"]');
      expect(skeletons?.length).toBeGreaterThan(0);
    }
  });

  it('renders session row skeletons with recency dot skeleton', () => {
    const { container } = render(<DiscoverLoadingSkeleton />);
    // Look for small rounded-full skeletons (recency dots)
    const allSkeletons = container.querySelectorAll('[data-testid="skeleton"]');
    const dotSkeletons = Array.from(allSkeletons).filter((s) =>
      s.className?.includes('rounded-full'),
    );
    // 4 rows in group 1 + 2 in group 2 + 2 in group 3 = 8 dot skeletons
    expect(dotSkeletons.length).toBe(8);
  });

  it('total skeleton count matches expected layout', () => {
    const { getAllByTestId } = render(<DiscoverLoadingSkeleton />);
    const skeletons = getAllByTestId('skeleton');
    // Each group header: 4 skeletons (icon, title, subtitle, count)
    // Each session row: 4 skeletons (dot, bar, small, small)
    // Group 1: 4 header + 4*4 rows = 20
    // Group 2: 4 header + 2*4 rows = 12
    // Group 3: 4 header + 2*4 rows = 12
    // Total: 44
    expect(skeletons.length).toBe(44);
  });
});
