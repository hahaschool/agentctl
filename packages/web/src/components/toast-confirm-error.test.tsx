import { act, fireEvent, render, screen } from '@testing-library/react';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  CheckCircle2: (props: Record<string, unknown>) => <svg data-testid="icon-check" {...props} />,
  Info: (props: Record<string, unknown>) => <svg data-testid="icon-info" {...props} />,
  X: (props: Record<string, unknown>) => <svg data-testid="icon-x" {...props} />,
  XCircle: (props: Record<string, unknown>) => <svg data-testid="icon-xcircle" {...props} />,
  AlertTriangle: (props: Record<string, unknown>) => <svg data-testid="icon-alert" {...props} />,
  RefreshCw: (props: Record<string, unknown>) => <svg data-testid="icon-refresh" {...props} />,
  RotateCcw: (props: Record<string, unknown>) => <svg data-testid="icon-rotate" {...props} />,
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { ConfirmButton } from './ConfirmButton';
import { ErrorBoundary } from './ErrorBoundary';
import { ToastContainer, toast, useToast } from './Toast';

// Suppress console.error from ErrorBoundary.componentDidCatch during tests
const originalConsoleError = console.error;
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('ErrorBoundary caught')) return;
    if (typeof args[0] === 'string' && args[0].includes('The above error occurred')) return;
    originalConsoleError(...args);
  };
});
afterAll(() => {
  console.error = originalConsoleError;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  // Clear all toasts between tests
  toast.dismiss();
  // Wait for dismiss animation timeout (300ms) — use real timers flush
});

// ===========================================================================
// Toast — standalone API + ToastContainer
// ===========================================================================

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Ensure clean state: dismiss all and flush the 300ms removal timer
    toast.dismiss();
    act(() => {
      vi.advanceTimersByTime(350);
    });
  });

  it('renders nothing when there are no toasts', () => {
    const { container } = render(<ToastContainer />);
    expect(container.innerHTML).toBe('');
  });

  it('renders a success toast with the correct message', () => {
    render(<ToastContainer />);
    act(() => {
      toast.success('Saved successfully');
    });
    expect(screen.getByText('Saved successfully')).toBeDefined();
  });

  it('renders an error toast with the correct message', () => {
    render(<ToastContainer />);
    act(() => {
      toast.error('Something failed');
    });
    expect(screen.getByText('Something failed')).toBeDefined();
  });

  it('renders an info toast with the correct message', () => {
    render(<ToastContainer />);
    act(() => {
      toast.info('FYI info');
    });
    expect(screen.getByText('FYI info')).toBeDefined();
  });

  it('renders toast with role="alert" for accessibility', () => {
    render(<ToastContainer />);
    act(() => {
      toast.success('Alert toast');
    });
    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(0);
  });

  it('renders the container with aria-live="polite"', () => {
    render(<ToastContainer />);
    act(() => {
      toast.info('Polite toast');
    });
    const container = screen.getByLabelText('Notifications');
    expect(container.getAttribute('aria-live')).toBe('polite');
  });

  it('renders multiple toasts simultaneously', () => {
    render(<ToastContainer />);
    act(() => {
      toast.success('First');
      toast.error('Second');
      toast.info('Third');
    });
    expect(screen.getByText('First')).toBeDefined();
    expect(screen.getByText('Second')).toBeDefined();
    expect(screen.getByText('Third')).toBeDefined();
  });

  it('applies animate-toast-in class on new toasts', () => {
    render(<ToastContainer />);
    act(() => {
      toast.success('Animated');
    });
    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('animate-toast-in');
    expect(alert.className).not.toContain('animate-toast-out');
  });

  it('applies animate-toast-out class when dismissing', () => {
    render(<ToastContainer />);
    act(() => {
      toast.success('Will dismiss');
    });
    const dismissBtn = screen.getByLabelText('Dismiss');
    fireEvent.click(dismissBtn);
    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('animate-toast-out');
  });

  it('removes toast from DOM after dismiss animation (300ms)', () => {
    render(<ToastContainer />);
    act(() => {
      toast.success('Temporary');
    });
    expect(screen.getByText('Temporary')).toBeDefined();

    const dismissBtn = screen.getByLabelText('Dismiss');
    fireEvent.click(dismissBtn);

    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(screen.queryByText('Temporary')).toBeNull();
  });

  it('renders a dismiss button with aria-label="Dismiss"', () => {
    render(<ToastContainer />);
    act(() => {
      toast.info('Dismissable');
    });
    expect(screen.getByLabelText('Dismiss')).toBeDefined();
  });

  it('toast.dismiss() clears all toasts', () => {
    render(<ToastContainer />);
    act(() => {
      toast.success('One');
      toast.error('Two');
    });
    expect(screen.getAllByRole('alert')).toHaveLength(2);

    act(() => {
      toast.dismiss();
    });
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('success toasts use emerald container styling', () => {
    render(<ToastContainer />);
    act(() => {
      toast.success('Green toast');
    });
    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('emerald');
  });

  it('error toasts use red container styling', () => {
    render(<ToastContainer />);
    act(() => {
      toast.error('Red toast');
    });
    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('red');
  });

  it('info toasts use blue container styling', () => {
    render(<ToastContainer />);
    act(() => {
      toast.info('Blue toast');
    });
    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('blue');
  });

  it('auto-dismisses after duration via requestAnimationFrame tick', () => {
    // Mock requestAnimationFrame to execute callbacks synchronously-ish
    let rafCallbacks: FrameRequestCallback[] = [];
    const origRAF = globalThis.requestAnimationFrame;
    const origCAF = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    };
    globalThis.cancelAnimationFrame = () => {};

    render(<ToastContainer />);
    act(() => {
      toast.success('Auto dismiss');
    });
    expect(screen.getByText('Auto dismiss')).toBeDefined();

    // Simulate time passing beyond the 5000ms default duration
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 5100);

    // Flush raf callbacks
    act(() => {
      const cbs = [...rafCallbacks];
      rafCallbacks = [];
      for (const cb of cbs) cb(performance.now());
    });

    // The toast should now be in dismissing state, wait for removal
    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(screen.queryByText('Auto dismiss')).toBeNull();

    globalThis.requestAnimationFrame = origRAF;
    globalThis.cancelAnimationFrame = origCAF;
  });
});

// ===========================================================================
// useToast hook
// ===========================================================================

describe('useToast hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    toast.dismiss();
    act(() => {
      vi.advanceTimersByTime(350);
    });
  });

  function HookConsumer() {
    const t = useToast();
    return (
      <div>
        <button type="button" onClick={() => t.success('hook success')}>Success</button>
        <button type="button" onClick={() => t.error('hook error')}>Error</button>
        <button type="button" onClick={() => t.info('hook info')}>Info</button>
        <button type="button" onClick={() => t.toast('success', 'hook toast')}>Toast</button>
      </div>
    );
  }

  it('useToast.success adds a toast', () => {
    render(
      <>
        <HookConsumer />
        <ToastContainer />
      </>,
    );
    fireEvent.click(screen.getByText('Success'));
    expect(screen.getByText('hook success')).toBeDefined();
  });

  it('useToast.error adds a toast', () => {
    render(
      <>
        <HookConsumer />
        <ToastContainer />
      </>,
    );
    fireEvent.click(screen.getByText('Error'));
    expect(screen.getByText('hook error')).toBeDefined();
  });

  it('useToast.info adds a toast', () => {
    render(
      <>
        <HookConsumer />
        <ToastContainer />
      </>,
    );
    fireEvent.click(screen.getByText('Info'));
    expect(screen.getByText('hook info')).toBeDefined();
  });

  it('useToast.toast() adds a toast via generic method', () => {
    render(
      <>
        <HookConsumer />
        <ToastContainer />
      </>,
    );
    fireEvent.click(screen.getByText('Toast'));
    expect(screen.getByText('hook toast')).toBeDefined();
  });
});

// ===========================================================================
// ConfirmButton — complementary tests (not in interaction-components.test.tsx)
// ===========================================================================

describe('ConfirmButton — complementary', () => {
  it('auto-reverts to default state after timeout expires', async () => {
    vi.useFakeTimers();
    const onConfirm = vi.fn();
    render(<ConfirmButton label="Remove" onConfirm={onConfirm} timeout={2000} />);
    const btn = screen.getByRole('button');

    fireEvent.click(btn); // enter confirming
    expect(screen.getByText('Confirm?')).toBeDefined();

    await act(async () => {
      vi.advanceTimersByTime(2100);
    });

    // Should revert to default label
    expect(screen.getByText('Remove')).toBeDefined();
    expect(screen.queryByText('Confirm?')).toBeNull();
    // onConfirm should NOT have been called
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('uses custom confirmLabel text', () => {
    render(<ConfirmButton label="Delete" confirmLabel="Really delete?" onConfirm={() => {}} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Really delete?')).toBeDefined();
  });

  it('does not call onConfirm when disabled', () => {
    const onConfirm = vi.fn();
    render(<ConfirmButton label="Delete" onConfirm={onConfirm} disabled />);
    const btn = screen.getByRole('button');

    fireEvent.click(btn); // first click — should not enter confirming
    fireEvent.click(btn); // second click — should not confirm
    expect(onConfirm).not.toHaveBeenCalled();
    // Should still show default label
    expect(screen.getByText('Delete')).toBeDefined();
  });

  it('renders with disabled attribute when disabled prop is true', () => {
    render(<ConfirmButton label="Delete" onConfirm={() => {}} disabled />);
    const btn = screen.getByRole('button');
    expect(btn.hasAttribute('disabled')).toBe(true);
  });

  it('applies confirmClassName when in confirming state', () => {
    render(
      <ConfirmButton
        label="Delete"
        onConfirm={() => {}}
        className="default-style"
        confirmClassName="confirm-style"
      />,
    );
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('default-style');

    fireEvent.click(btn);
    expect(btn.className).toContain('confirm-style');
    expect(btn.className).not.toContain('default-style');
  });

  it('applies cursor-not-allowed class when disabled', () => {
    render(<ConfirmButton label="Delete" onConfirm={() => {}} disabled className="base" />);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('cursor-not-allowed');
  });

  it('shows countdown based on custom timeout value', () => {
    vi.useFakeTimers();
    render(<ConfirmButton label="Delete" onConfirm={() => {}} timeout={5000} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('(5s)')).toBeDefined();
  });
});

// ===========================================================================
// ErrorBoundary — complementary tests (not in interaction-components.test.tsx)
// ===========================================================================

describe('ErrorBoundary — complementary', () => {
  it('renders custom fallback prop instead of default UI', () => {
    const ThrowError = () => {
      throw new Error('Boom');
    };

    render(
      <ErrorBoundary fallback={<div>Custom fallback UI</div>}>
        <ThrowError />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Custom fallback UI')).toBeDefined();
    // Default UI should NOT be present
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  it('"Try again" button resets error state and re-renders children', () => {
    let shouldThrow = true;
    const MaybeThrow = () => {
      if (shouldThrow) {
        throw new Error('First render fails');
      }
      return <div>Recovered content</div>;
    };

    render(
      <ErrorBoundary>
        <MaybeThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeDefined();

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: /Try again/i }));
    expect(screen.getByText('Recovered content')).toBeDefined();
  });

  it('"Reload page" button calls window.location.reload', () => {
    const reloadMock = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: reloadMock },
      writable: true,
    });

    const ThrowError = () => {
      throw new Error('Crash');
    };

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Reload page/i }));
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('displays the specific error message in the description', () => {
    const ThrowError = () => {
      throw new Error('Database connection lost');
    };

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Database connection lost')).toBeDefined();
  });

  it('shows default heading when error message is empty', () => {
    const ThrowError = () => {
      throw new Error('');
    };

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );

    // Empty message means ?? does not trigger (empty string is not null),
    // but the heading "Something went wrong" is always shown
    expect(screen.getByText('Something went wrong')).toBeDefined();
    // The error details section should still be present
    expect(screen.getByText('Error details')).toBeDefined();
  });

  it('renders children normally when no error occurs', () => {
    render(
      <ErrorBoundary>
        <div>All good</div>
      </ErrorBoundary>,
    );

    expect(screen.getByText('All good')).toBeDefined();
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });
});
