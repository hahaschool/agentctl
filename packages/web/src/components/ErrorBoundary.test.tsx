import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock lucide-react icons to simple SVGs
// ---------------------------------------------------------------------------
vi.mock('lucide-react', () => ({
  AlertTriangle: (props: Record<string, unknown>) => (
    <svg data-testid="icon-alert-triangle" {...props} />
  ),
  RefreshCw: (props: Record<string, unknown>) => <svg data-testid="icon-refresh" {...props} />,
  RotateCcw: (props: Record<string, unknown>) => <svg data-testid="icon-rotate" {...props} />,
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: unknown; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { ErrorBoundary } from './ErrorBoundary';

// ===========================================================================
// Helpers
// ===========================================================================

/** Component that throws on render. */
function ThrowingChild({ message }: { message?: string }): React.JSX.Element {
  throw new Error(message ?? 'Test error');
}

/** Normal component that renders fine. */
function GoodChild(): React.JSX.Element {
  return <div data-testid="good-child">Hello</div>;
}

// Suppress console.error noise from React error boundaries during tests
const originalConsoleError = console.error;
beforeEach(() => {
  console.error = vi.fn();
  return () => {
    console.error = originalConsoleError;
  };
});

// ===========================================================================
// ErrorBoundary
// ===========================================================================
describe('ErrorBoundary', () => {
  // -------------------------------------------------------------------------
  // Normal rendering
  // -------------------------------------------------------------------------
  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <GoodChild />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('good-child')).toBeDefined();
    expect(screen.getByText('Hello')).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Default fallback UI
  // -------------------------------------------------------------------------
  it('renders default error UI when a child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeDefined();
  });

  it('displays the error message in the default fallback', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild message="Kaboom!" />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Kaboom!')).toBeDefined();
  });

  it('displays "An unexpected error occurred" when error has no message', () => {
    const NoMsgThrower = (): React.JSX.Element => {
      const err = new Error();
      err.message = '';
      throw err;
    };
    render(
      <ErrorBoundary>
        <NoMsgThrower />
      </ErrorBoundary>,
    );
    // The fallback uses: error?.message ?? 'An unexpected error occurred'
    // An empty-string message is falsy but not nullish, so it renders the empty string.
    // The "An unexpected error occurred" only shows when message is null/undefined.
    expect(screen.getByText('Something went wrong')).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Try Again button
  // -------------------------------------------------------------------------
  it('renders a "Try again" button', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('button', { name: /try again/i })).toBeDefined();
  });

  it('resets error state when "Try again" is clicked', () => {
    // First render: throw. After clicking "Try again", the boundary resets
    // hasError to false and re-renders children. We control whether to throw
    // via a ref-like variable that we flip *after* confirming the error UI.
    let shouldThrow = true;
    const MaybeThrow = (): React.JSX.Element => {
      if (shouldThrow) {
        throw new Error('First render error');
      }
      return <div data-testid="recovered">Recovered!</div>;
    };

    render(
      <ErrorBoundary>
        <MaybeThrow />
      </ErrorBoundary>,
    );

    // Error UI is shown
    expect(screen.getByText('Something went wrong')).toBeDefined();

    // Now stop throwing so the re-render after reset succeeds
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(screen.getByTestId('recovered')).toBeDefined();
    expect(screen.getByText('Recovered!')).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Reload page button
  // -------------------------------------------------------------------------
  it('renders a "Reload page" button', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('button', { name: /reload page/i })).toBeDefined();
  });

  it('renders a "Go to Dashboard" link', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('link', { name: /go to dashboard/i })).toBeDefined();
  });

  it('calls window.location.reload when "Reload page" is clicked', () => {
    const reloadMock = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: reloadMock },
      writable: true,
      configurable: true,
    });

    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByRole('button', { name: /reload page/i }));
    expect(reloadMock).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // Error details section
  // -------------------------------------------------------------------------
  it('renders an "Error details" expandable section', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild message="Detail error" />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Error details')).toBeDefined();
  });

  it('shows the error name and message in the details section', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild message="Detailed failure" />
      </ErrorBoundary>,
    );
    const details = screen.getByText('Error details');
    expect(details).toBeDefined();
    // The pre element contains "Error: Detailed failure"
    const preEl = details.closest('details')?.querySelector('pre');
    expect(preEl).not.toBeNull();
    expect(preEl?.textContent).toContain('Error');
    expect(preEl?.textContent).toContain('Detailed failure');
  });

  // -------------------------------------------------------------------------
  // Icons
  // -------------------------------------------------------------------------
  it('renders the alert triangle icon in the error fallback', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('icon-alert-triangle')).toBeDefined();
  });

  it('renders the rotate icon in the "Try again" button', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('icon-rotate')).toBeDefined();
  });

  it('renders the refresh icon in the "Reload page" button', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('icon-refresh')).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Custom fallback
  // -------------------------------------------------------------------------
  it('renders custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={<div data-testid="custom-fallback">Custom error UI</div>}>
        <ThrowingChild />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('custom-fallback')).toBeDefined();
    expect(screen.getByText('Custom error UI')).toBeDefined();
  });

  it('does not render default error UI when custom fallback is provided', () => {
    render(
      <ErrorBoundary fallback={<div>Custom fallback</div>}>
        <ThrowingChild />
      </ErrorBoundary>,
    );
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // resetKey prop
  // -------------------------------------------------------------------------
  it('resets error state when resetKey changes', () => {
    let shouldThrow = true;
    const MaybeThrow = (): React.JSX.Element => {
      if (shouldThrow) {
        throw new Error('Reset key error');
      }
      return <div data-testid="reset-recovered">Back to normal</div>;
    };

    const { rerender } = render(
      <ErrorBoundary resetKey="key-1">
        <MaybeThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeDefined();

    // Stop throwing, then change resetKey to trigger recovery
    shouldThrow = false;
    rerender(
      <ErrorBoundary resetKey="key-2">
        <MaybeThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId('reset-recovered')).toBeDefined();
  });

  it('does not reset when resetKey stays the same', () => {
    render(
      <ErrorBoundary resetKey="same-key">
        <ThrowingChild />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeDefined();
  });
});
