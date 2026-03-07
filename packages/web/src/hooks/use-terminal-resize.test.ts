import { cleanup, renderHook } from '@testing-library/react';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTerminalResize } from './use-terminal-resize';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFitAddonRef(fit = vi.fn()) {
  return { current: { fit } } as unknown as React.RefObject<
    import('@xterm/addon-fit').FitAddon | null
  >;
}

function makeContainerRef(parentElement?: HTMLElement) {
  const div = document.createElement('div');
  if (parentElement) {
    parentElement.appendChild(div);
  }
  return { current: div };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useTerminalResize', () => {
  let observeSpy: ReturnType<typeof vi.fn>;
  let disconnectSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    observeSpy = vi.fn();
    disconnectSpy = vi.fn();

    vi.stubGlobal(
      'ResizeObserver',
      vi.fn().mockImplementation(() => ({
        observe: observeSpy,
        disconnect: disconnectSpy,
        unobserve: vi.fn(),
      })),
    );
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // =========================================================================
  // 1. Window resize listener
  // =========================================================================
  describe('window resize listener', () => {
    it('adds a resize event listener on mount', () => {
      const addSpy = vi.spyOn(window, 'addEventListener');
      const fitAddonRef = makeFitAddonRef();
      const containerRef = makeContainerRef();

      renderHook(() => useTerminalResize(fitAddonRef, containerRef));

      expect(addSpy).toHaveBeenCalledWith('resize', expect.any(Function));
      addSpy.mockRestore();
    });

    it('removes resize listener on unmount', () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener');
      const fitAddonRef = makeFitAddonRef();
      const containerRef = makeContainerRef();

      const { unmount } = renderHook(() => useTerminalResize(fitAddonRef, containerRef));
      unmount();

      expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function));
      removeSpy.mockRestore();
    });

    it('calls fitAddon.fit() when window resize fires', () => {
      const fit = vi.fn();
      const fitAddonRef = makeFitAddonRef(fit);
      const containerRef = makeContainerRef();

      renderHook(() => useTerminalResize(fitAddonRef, containerRef));
      fit.mockClear();

      window.dispatchEvent(new Event('resize'));

      expect(fit).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 2. Delayed initial fit
  // =========================================================================
  describe('delayed initial fit', () => {
    it('schedules a 100ms delayed fit on mount', async () => {
      vi.useRealTimers();
      vi.useFakeTimers({ shouldAdvanceTime: false });

      const fit = vi.fn();
      const fitAddonRef = makeFitAddonRef(fit);
      const containerRef = makeContainerRef();

      renderHook(() => useTerminalResize(fitAddonRef, containerRef));
      fit.mockClear();

      await vi.advanceTimersByTimeAsync(150);

      expect(fit).toHaveBeenCalled();
    });

    it('clears the delayed timeout on unmount', () => {
      const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
      const fitAddonRef = makeFitAddonRef();
      const containerRef = makeContainerRef();

      const { unmount } = renderHook(() => useTerminalResize(fitAddonRef, containerRef));
      unmount();

      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
    });
  });

  // =========================================================================
  // 3. ResizeObserver
  // =========================================================================
  describe('ResizeObserver', () => {
    it('observes parent element when container has a parent', () => {
      const parent = document.createElement('div');
      const containerRef = makeContainerRef(parent);
      const fitAddonRef = makeFitAddonRef();

      renderHook(() => useTerminalResize(fitAddonRef, containerRef));

      expect(observeSpy).toHaveBeenCalledWith(parent);
    });

    it('does not observe when container has no parent element', () => {
      const containerRef = { current: document.createElement('div') };
      // div is not attached to any parent
      const fitAddonRef = makeFitAddonRef();

      renderHook(() => useTerminalResize(fitAddonRef, containerRef));

      expect(observeSpy).not.toHaveBeenCalled();
    });

    it('disconnects ResizeObserver on unmount', () => {
      const parent = document.createElement('div');
      const containerRef = makeContainerRef(parent);
      const fitAddonRef = makeFitAddonRef();

      const { unmount } = renderHook(() => useTerminalResize(fitAddonRef, containerRef));
      unmount();

      expect(disconnectSpy).toHaveBeenCalled();
    });

    it('calls fit when ResizeObserver callback fires', () => {
      const captured: { cb: ResizeObserverCallback | null } = { cb: null };

      vi.stubGlobal(
        'ResizeObserver',
        vi.fn().mockImplementation((cb: ResizeObserverCallback) => {
          captured.cb = cb;
          return { observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() };
        }),
      );

      const fit = vi.fn();
      const parent = document.createElement('div');
      const containerRef = makeContainerRef(parent);
      const fitAddonRef = makeFitAddonRef(fit);

      renderHook(() => useTerminalResize(fitAddonRef, containerRef));
      fit.mockClear();

      captured.cb?.([], {} as ResizeObserver);

      expect(fit).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 4. Error handling
  // =========================================================================
  describe('error handling', () => {
    it('does not throw when fitAddon.fit() throws', () => {
      const fit = vi.fn().mockImplementation(() => {
        throw new Error('Terminal not ready');
      });
      const fitAddonRef = makeFitAddonRef(fit);
      const containerRef = makeContainerRef();

      renderHook(() => useTerminalResize(fitAddonRef, containerRef));

      expect(() => {
        window.dispatchEvent(new Event('resize'));
      }).not.toThrow();
    });

    it('handles null fitAddon ref gracefully', () => {
      const fitAddonRef = { current: null };
      const containerRef = makeContainerRef();

      renderHook(() => useTerminalResize(fitAddonRef, containerRef));

      expect(() => {
        window.dispatchEvent(new Event('resize'));
      }).not.toThrow();
    });

    it('handles null container ref gracefully', () => {
      const fitAddonRef = makeFitAddonRef();
      const containerRef = { current: null };

      expect(() => {
        renderHook(() => useTerminalResize(fitAddonRef, containerRef));
      }).not.toThrow();
    });
  });
});
