import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  CheckCircle2: (props: Record<string, unknown>) => <svg data-testid="icon-check" {...props} />,
  Info: (props: Record<string, unknown>) => <svg data-testid="icon-info" {...props} />,
  X: (props: Record<string, unknown>) => <svg data-testid="icon-x" {...props} />,
  XCircle: (props: Record<string, unknown>) => <svg data-testid="icon-xcircle" {...props} />,
}));

import { ToastContainer, toast, useToast } from './Toast';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  toast.dismiss();
});

// ===========================================================================
// toast standalone API
// ===========================================================================

describe('toast standalone API', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    toast.dismiss();
    act(() => {
      vi.advanceTimersByTime(350);
    });
  });

  describe('toast.success', () => {
    it('renders a success toast with the provided message', () => {
      render(<ToastContainer />);
      act(() => {
        toast.success('Operation completed');
      });
      expect(screen.getByText('Operation completed')).toBeDefined();
    });

    it('applies emerald styling for success toasts', () => {
      render(<ToastContainer />);
      act(() => {
        toast.success('Green toast');
      });
      const alert = screen.getByRole('alert');
      expect(alert.className).toContain('emerald');
    });

    it('renders the CheckCircle2 icon for success', () => {
      render(<ToastContainer />);
      act(() => {
        toast.success('With icon');
      });
      expect(screen.getByTestId('icon-check')).toBeDefined();
    });
  });

  describe('toast.error', () => {
    it('renders an error toast with the provided message', () => {
      render(<ToastContainer />);
      act(() => {
        toast.error('Something broke');
      });
      expect(screen.getByText('Something broke')).toBeDefined();
    });

    it('applies red styling for error toasts', () => {
      render(<ToastContainer />);
      act(() => {
        toast.error('Red toast');
      });
      const alert = screen.getByRole('alert');
      expect(alert.className).toContain('red');
    });

    it('renders the XCircle icon for error', () => {
      render(<ToastContainer />);
      act(() => {
        toast.error('With error icon');
      });
      expect(screen.getByTestId('icon-xcircle')).toBeDefined();
    });

    it('uses a longer default duration of 8000ms for errors', () => {
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
        toast.error('Long-lived error');
      });
      expect(screen.getByText('Long-lived error')).toBeDefined();

      // At 5100ms, the error toast should still be visible (duration is 8000ms)
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now + 5100);

      act(() => {
        const cbs = [...rafCallbacks];
        rafCallbacks = [];
        for (const cb of cbs) cb(performance.now());
      });

      // Should still be present (not auto-dismissed at 5100ms)
      expect(screen.getByText('Long-lived error')).toBeDefined();

      globalThis.requestAnimationFrame = origRAF;
      globalThis.cancelAnimationFrame = origCAF;
    });
  });

  describe('toast.info', () => {
    it('renders an info toast with the provided message', () => {
      render(<ToastContainer />);
      act(() => {
        toast.info('Heads up');
      });
      expect(screen.getByText('Heads up')).toBeDefined();
    });

    it('applies blue styling for info toasts', () => {
      render(<ToastContainer />);
      act(() => {
        toast.info('Blue toast');
      });
      const alert = screen.getByRole('alert');
      expect(alert.className).toContain('blue');
    });

    it('renders the Info icon for info toasts', () => {
      render(<ToastContainer />);
      act(() => {
        toast.info('With info icon');
      });
      expect(screen.getByTestId('icon-info')).toBeDefined();
    });
  });

  describe('toast.dismiss', () => {
    it('dismisses all toasts', () => {
      render(<ToastContainer />);
      act(() => {
        toast.success('One');
        toast.error('Two');
        toast.info('Three');
      });
      expect(screen.getAllByRole('alert')).toHaveLength(3);

      act(() => {
        toast.dismiss();
      });
      act(() => {
        vi.advanceTimersByTime(350);
      });
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('marks all toasts as dismissing before removal', () => {
      render(<ToastContainer />);
      act(() => {
        toast.success('Fading out');
      });

      act(() => {
        toast.dismiss();
      });
      // Before the 300ms timeout, the toast should still be in DOM with dismiss animation
      const alert = screen.getByRole('alert');
      expect(alert.className).toContain('animate-toast-out');
    });
  });
});

// ===========================================================================
// ToastContainer rendering
// ===========================================================================

describe('ToastContainer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    toast.dismiss();
    act(() => {
      vi.advanceTimersByTime(350);
    });
  });

  it('renders nothing when there are no toasts', () => {
    const { container } = render(<ToastContainer />);
    expect(container.innerHTML).toBe('');
  });

  it('renders the container with aria-live="polite"', () => {
    render(<ToastContainer />);
    act(() => {
      toast.info('Accessible toast');
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
    expect(screen.getAllByRole('alert')).toHaveLength(3);
  });

  it('applies animate-toast-in class on new toasts', () => {
    render(<ToastContainer />);
    act(() => {
      toast.success('New toast');
    });
    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('animate-toast-in');
    expect(alert.className).not.toContain('animate-toast-out');
  });

  it('each toast has a dismiss button with aria-label', () => {
    render(<ToastContainer />);
    act(() => {
      toast.success('Dismissable');
    });
    expect(screen.getByLabelText('Dismiss')).toBeDefined();
  });

  it('clicking dismiss marks toast as animate-toast-out', () => {
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

  it('auto-dismisses after the default duration', () => {
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

    act(() => {
      const cbs = [...rafCallbacks];
      rafCallbacks = [];
      for (const cb of cbs) cb(performance.now());
    });

    // Wait for dismiss animation removal
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

  it('success() adds a success toast', () => {
    render(
      <>
        <HookConsumer />
        <ToastContainer />
      </>,
    );
    fireEvent.click(screen.getByText('Success'));
    expect(screen.getByText('hook success')).toBeDefined();
  });

  it('error() adds an error toast', () => {
    render(
      <>
        <HookConsumer />
        <ToastContainer />
      </>,
    );
    fireEvent.click(screen.getByText('Error'));
    expect(screen.getByText('hook error')).toBeDefined();
  });

  it('info() adds an info toast', () => {
    render(
      <>
        <HookConsumer />
        <ToastContainer />
      </>,
    );
    fireEvent.click(screen.getByText('Info'));
    expect(screen.getByText('hook info')).toBeDefined();
  });

  it('toast() adds a toast via the generic method', () => {
    render(
      <>
        <HookConsumer />
        <ToastContainer />
      </>,
    );
    fireEvent.click(screen.getByText('Toast'));
    expect(screen.getByText('hook toast')).toBeDefined();
  });

  it('error toasts from hook use 8000ms duration', () => {
    let rafCallbacks: FrameRequestCallback[] = [];
    const origRAF = globalThis.requestAnimationFrame;
    const origCAF = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    };
    globalThis.cancelAnimationFrame = () => {};

    render(
      <>
        <HookConsumer />
        <ToastContainer />
      </>,
    );
    fireEvent.click(screen.getByText('Error'));
    expect(screen.getByText('hook error')).toBeDefined();

    // At 5100ms, the error toast should still be visible
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 5100);

    act(() => {
      const cbs = [...rafCallbacks];
      rafCallbacks = [];
      for (const cb of cbs) cb(performance.now());
    });

    expect(screen.getByText('hook error')).toBeDefined();

    globalThis.requestAnimationFrame = origRAF;
    globalThis.cancelAnimationFrame = origCAF;
  });
});
