import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @/lib/utils
// ---------------------------------------------------------------------------
vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { FetchingBar } from './FetchingBar';

// ===========================================================================
// FetchingBar
// ===========================================================================
describe('FetchingBar', () => {
  // -------------------------------------------------------------------------
  // Visibility based on loading state
  // -------------------------------------------------------------------------
  it('is visible (opacity-100) when isFetching is true', () => {
    const { container } = render(<FetchingBar isFetching={true} />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.className).toContain('opacity-100');
    expect(bar.className).not.toContain('opacity-0');
  });

  it('is hidden (opacity-0) when isFetching is false', () => {
    const { container } = render(<FetchingBar isFetching={false} />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.className).toContain('opacity-0');
    expect(bar.className).not.toContain('opacity-100');
  });

  // -------------------------------------------------------------------------
  // ARIA attributes
  // -------------------------------------------------------------------------
  it('has role="progressbar"', () => {
    const { container } = render(<FetchingBar isFetching={true} />);
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar).not.toBeNull();
  });

  it('sets aria-hidden to false when fetching', () => {
    const { container } = render(<FetchingBar isFetching={true} />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.getAttribute('aria-hidden')).toBe('false');
  });

  it('sets aria-hidden to true when not fetching', () => {
    const { container } = render(<FetchingBar isFetching={false} />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.getAttribute('aria-hidden')).toBe('true');
  });

  // -------------------------------------------------------------------------
  // Structural elements
  // -------------------------------------------------------------------------
  it('renders an outer container with positioning classes', () => {
    const { container } = render(<FetchingBar isFetching={true} />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.className).toContain('absolute');
    expect(bar.className).toContain('top-0');
    expect(bar.className).toContain('left-0');
    expect(bar.className).toContain('right-0');
  });

  it('has a fixed height of 2px', () => {
    const { container } = render(<FetchingBar isFetching={true} />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.className).toContain('h-[2px]');
  });

  it('has overflow-hidden to contain the animation', () => {
    const { container } = render(<FetchingBar isFetching={true} />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.className).toContain('overflow-hidden');
  });

  // -------------------------------------------------------------------------
  // Animation inner bar
  // -------------------------------------------------------------------------
  it('contains an inner animated bar element', () => {
    const { container } = render(<FetchingBar isFetching={true} />);
    const inner = container.querySelector('.animate-fetching-bar');
    expect(inner).not.toBeNull();
  });

  it('inner bar has primary background color', () => {
    const { container } = render(<FetchingBar isFetching={true} />);
    const inner = container.querySelector('.bg-primary');
    expect(inner).not.toBeNull();
  });

  it('inner bar has full height', () => {
    const { container } = render(<FetchingBar isFetching={true} />);
    const inner = container.querySelector('.h-full');
    expect(inner).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Transition classes
  // -------------------------------------------------------------------------
  it('has smooth opacity transition', () => {
    const { container } = render(<FetchingBar isFetching={true} />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.className).toContain('transition-opacity');
    expect(bar.className).toContain('duration-300');
  });

  // -------------------------------------------------------------------------
  // Toggle behavior
  // -------------------------------------------------------------------------
  it('transitions from hidden to visible when isFetching changes', () => {
    const { container, rerender } = render(<FetchingBar isFetching={false} />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.className).toContain('opacity-0');

    rerender(<FetchingBar isFetching={true} />);
    expect(bar.className).toContain('opacity-100');
    expect(bar.className).not.toContain('opacity-0');
  });

  it('transitions from visible to hidden when isFetching changes', () => {
    const { container, rerender } = render(<FetchingBar isFetching={true} />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.className).toContain('opacity-100');

    rerender(<FetchingBar isFetching={false} />);
    expect(bar.className).toContain('opacity-0');
    expect(bar.className).not.toContain('opacity-100');
  });

  // -------------------------------------------------------------------------
  // Always renders (just hidden via opacity)
  // -------------------------------------------------------------------------
  it('renders the inner bar even when not fetching', () => {
    const { container } = render(<FetchingBar isFetching={false} />);
    const inner = container.querySelector('.animate-fetching-bar');
    expect(inner).not.toBeNull();
  });
});
