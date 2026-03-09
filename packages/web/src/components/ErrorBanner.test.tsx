import { fireEvent, render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('lucide-react', () => ({
  AlertCircle: (props: Record<string, unknown>) => (
    <svg data-testid="icon-alert-circle" {...props} />
  ),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { ErrorBanner } from './ErrorBanner';

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// Tests
// ===========================================================================

describe('ErrorBanner', () => {
  // -------------------------------------------------------------------------
  // 1. Basic message rendering
  // -------------------------------------------------------------------------

  describe('message rendering', () => {
    it('renders the error message text', () => {
      render(<ErrorBanner message="Something went wrong" />);
      expect(screen.getByText('Something went wrong')).toBeDefined();
    });

    it('renders different error messages', () => {
      const { rerender } = render(<ErrorBanner message="Network error" />);
      expect(screen.getByText('Network error')).toBeDefined();

      rerender(<ErrorBanner message="Timeout exceeded" />);
      expect(screen.getByText('Timeout exceeded')).toBeDefined();
      expect(screen.queryByText('Network error')).toBeNull();
    });

    it('renders an empty message string without crashing', () => {
      const { container } = render(<ErrorBanner message="" />);
      expect(container.firstChild).toBeDefined();
    });

    it('renders a long error message', () => {
      const longMsg = 'Error: '.repeat(50).trim();
      render(<ErrorBanner message={longMsg} />);
      expect(screen.getByText(longMsg)).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 2. Hint text
  // -------------------------------------------------------------------------

  describe('hint rendering', () => {
    it('renders hint text when provided', () => {
      render(<ErrorBanner message="Error" hint="Try refreshing the page" />);
      expect(screen.getByText('Try refreshing the page')).toBeDefined();
    });

    it('does not render hint element when hint is omitted', () => {
      render(<ErrorBanner message="Error" />);
      expect(screen.queryByText('Try refreshing the page')).toBeNull();
    });

    it('renders both message and hint together', () => {
      render(<ErrorBanner message="Connection lost" hint="Check your network" />);
      expect(screen.getByText('Connection lost')).toBeDefined();
      expect(screen.getByText('Check your network')).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 3. Retry button
  // -------------------------------------------------------------------------

  describe('retry button', () => {
    it('renders Retry button when onRetry is provided', () => {
      const onRetry = vi.fn();
      render(<ErrorBanner message="Error" onRetry={onRetry} />);
      expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined();
    });

    it('does not render Retry button when onRetry is omitted', () => {
      render(<ErrorBanner message="Error" />);
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    });

    it('calls onRetry callback when Retry button is clicked', () => {
      const onRetry = vi.fn();
      render(<ErrorBanner message="Error" onRetry={onRetry} />);
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('calls onRetry on each click', () => {
      const onRetry = vi.fn();
      render(<ErrorBanner message="Error" onRetry={onRetry} />);
      const btn = screen.getByRole('button', { name: 'Retry' });
      fireEvent.click(btn);
      fireEvent.click(btn);
      fireEvent.click(btn);
      expect(onRetry).toHaveBeenCalledTimes(3);
    });
  });

  // -------------------------------------------------------------------------
  // 4. className prop
  // -------------------------------------------------------------------------

  describe('className prop', () => {
    it('applies custom className via cn()', () => {
      const { container } = render(<ErrorBanner message="Error" className="mt-8 custom-class" />);
      const wrapper = container.querySelector('[role="alert"]') as HTMLElement;
      expect(wrapper.className).toContain('mt-8');
      expect(wrapper.className).toContain('custom-class');
    });

    it('preserves default classes when className is provided', () => {
      const { container } = render(<ErrorBanner message="Error" className="extra" />);
      const wrapper = container.querySelector('[role="alert"]') as HTMLElement;
      // The cn mock joins all truthy args, so default classes should still be present
      expect(wrapper.className).toContain('bg-destructive/10');
      expect(wrapper.className).toContain('extra');
    });

    it('works without className prop', () => {
      const { container } = render(<ErrorBanner message="Error" />);
      const wrapper = container.querySelector('[role="alert"]') as HTMLElement;
      expect(wrapper.className).toContain('bg-destructive/10');
    });
  });

  // -------------------------------------------------------------------------
  // 5. Icon rendering
  // -------------------------------------------------------------------------

  describe('icon rendering', () => {
    it('renders the AlertCircle icon', () => {
      render(<ErrorBanner message="Error" />);
      expect(screen.getByTestId('icon-alert-circle')).toBeDefined();
    });

    it('icon has size 16', () => {
      render(<ErrorBanner message="Error" />);
      const icon = screen.getByTestId('icon-alert-circle');
      expect(icon.getAttribute('size')).toBe('16');
    });

    it('icon is always rendered regardless of other props', () => {
      render(<ErrorBanner message="Error" hint="Hint" onRetry={() => {}} className="custom" />);
      expect(screen.getByTestId('icon-alert-circle')).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 6. Accessibility
  // -------------------------------------------------------------------------

  describe('accessibility', () => {
    it('has role="alert" on the container', () => {
      render(<ErrorBanner message="Alert message" />);
      expect(screen.getByRole('alert')).toBeDefined();
    });

    it('the alert contains the error message', () => {
      render(<ErrorBanner message="Something broke" />);
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toContain('Something broke');
    });

    it('retry button has type="button"', () => {
      render(<ErrorBanner message="Error" onRetry={() => {}} />);
      const btn = screen.getByRole('button', { name: 'Retry' });
      expect(btn.getAttribute('type')).toBe('button');
    });
  });

  // -------------------------------------------------------------------------
  // 7. Combined rendering
  // -------------------------------------------------------------------------

  describe('combined rendering', () => {
    it('renders message, hint, icon, and retry button together', () => {
      const onRetry = vi.fn();
      render(
        <ErrorBanner
          message="Failed to load"
          hint="Server may be down"
          onRetry={onRetry}
          className="test-class"
        />,
      );
      expect(screen.getByText('Failed to load')).toBeDefined();
      expect(screen.getByText('Server may be down')).toBeDefined();
      expect(screen.getByTestId('icon-alert-circle')).toBeDefined();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined();
      const alert = screen.getByRole('alert');
      expect(alert.className).toContain('test-class');
    });
  });
});
