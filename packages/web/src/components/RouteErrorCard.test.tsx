import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Mock next/navigation
const mockBack = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: mockBack }),
}));

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));

import { RouteErrorCard } from './RouteErrorCard';

const defaultProps = {
  error: new Error('Test error') as Error & { digest?: string },
  reset: vi.fn(),
  title: 'Failed to load things',
  description: 'Things could not be loaded.',
};

describe('RouteErrorCard', () => {
  it('renders title and description', () => {
    render(<RouteErrorCard {...defaultProps} />);
    expect(screen.getByText('Failed to load things')).toBeTruthy();
    expect(screen.getByText('Things could not be loaded.')).toBeTruthy();
  });

  it('renders Go Back, Try Again, and Dashboard buttons', () => {
    render(<RouteErrorCard {...defaultProps} />);
    expect(screen.getByText('Go Back')).toBeTruthy();
    expect(screen.getByText('Try Again')).toBeTruthy();
    expect(screen.getByText('Dashboard')).toBeTruthy();
  });

  it('calls reset when Try Again is clicked', () => {
    const reset = vi.fn();
    render(<RouteErrorCard {...defaultProps} reset={reset} />);
    fireEvent.click(screen.getByText('Try Again'));
    expect(reset).toHaveBeenCalledOnce();
  });

  it('calls router.back when Go Back is clicked', () => {
    mockBack.mockClear();
    render(<RouteErrorCard {...defaultProps} />);
    fireEvent.click(screen.getByText('Go Back'));
    expect(mockBack).toHaveBeenCalledOnce();
  });

  it('renders custom fallback link', () => {
    render(<RouteErrorCard {...defaultProps} fallbackHref="/agents" fallbackLabel="All Agents" />);
    const link = screen.getByText('All Agents');
    expect(link).toBeTruthy();
    expect(link.closest('a')?.getAttribute('href')).toBe('/agents');
  });

  it('defaults fallback link to Dashboard /', () => {
    render(<RouteErrorCard {...defaultProps} />);
    const link = screen.getByText('Dashboard');
    expect(link.closest('a')?.getAttribute('href')).toBe('/');
  });

  it('shows and hides error details', () => {
    render(<RouteErrorCard {...defaultProps} />);
    const toggle = screen.getByText('Show error details');
    expect(toggle).toBeTruthy();

    fireEvent.click(toggle);
    expect(screen.getByText(/Test error/)).toBeTruthy();
    expect(screen.getByText('Hide error details')).toBeTruthy();

    fireEvent.click(screen.getByText('Hide error details'));
    expect(screen.queryByText(/Test error/)).toBeNull();
  });

  it('hides error details toggle when error message is empty', () => {
    const error = new Error('') as Error & { digest?: string };
    render(<RouteErrorCard {...defaultProps} error={error} />);
    expect(screen.queryByText('Show error details')).toBeNull();
  });

  it('shows stack trace when available', () => {
    const error = new Error('boom') as Error & { digest?: string };
    error.stack = 'Error: boom\n  at test.tsx:1:1';
    render(<RouteErrorCard {...defaultProps} error={error} />);
    fireEvent.click(screen.getByText('Show error details'));
    expect(screen.getByText(/at test\.tsx:1:1/)).toBeTruthy();
  });
});
