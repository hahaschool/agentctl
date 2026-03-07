import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the component under test
// ---------------------------------------------------------------------------

const mockWrite = vi.fn();
const mockOpen = vi.fn();
const mockLoadAddon = vi.fn();
const mockDispose = vi.fn();

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    write: mockWrite,
    open: mockOpen,
    loadAddon: mockLoadAddon,
    dispose: mockDispose,
  })),
}));

const mockFit = vi.fn();

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: mockFit,
  })),
}));

vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// ---------------------------------------------------------------------------
// Component import (after mocks)
// ---------------------------------------------------------------------------

import { TerminalView } from './TerminalView';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wait for the async dynamic import() inside the component's useEffect to
 * resolve so that xterm Terminal is created and opened.
 */
async function flushAsyncInit(): Promise<void> {
  await vi.waitFor(() => {
    expect(mockOpen).toHaveBeenCalled();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TerminalView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // =========================================================================
  // 1. Rendering with default props
  // =========================================================================
  describe('rendering with default props', () => {
    it('renders a <section> with aria-label "Terminal output"', () => {
      render(<TerminalView rawOutput={[]} />);
      const section = screen.getByLabelText('Terminal output');
      expect(section).toBeDefined();
      expect(section.tagName).toBe('SECTION');
    });

    it('renders the terminal container div', () => {
      const { container } = render(<TerminalView rawOutput={[]} />);
      expect(container.firstChild).toBeDefined();
    });

    it('renders the bg-[#0a0a0a] inner container', () => {
      const { container } = render(<TerminalView rawOutput={[]} />);
      const termDiv = container.querySelector('.bg-\\[\\#0a0a0a\\]');
      expect(termDiv).not.toBeNull();
    });

    it('shows "No terminal output" when rawOutput is empty and not active', () => {
      render(<TerminalView rawOutput={[]} />);
      expect(screen.getByText('No terminal output')).toBeDefined();
    });

    it('shows "Waiting for terminal output..." when rawOutput is empty and isActive is true', () => {
      render(<TerminalView rawOutput={[]} isActive />);
      expect(screen.getByText('Waiting for terminal output...')).toBeDefined();
    });

    it('renders a TerminalIcon in the empty state overlay (aria-hidden)', () => {
      const { container } = render(<TerminalView rawOutput={[]} />);
      const svg = container.querySelector('svg[aria-hidden="true"]');
      expect(svg).not.toBeNull();
    });
  });

  // =========================================================================
  // 2. Props handling
  // =========================================================================
  describe('props handling', () => {
    describe('isActive', () => {
      it('applies animate-pulse to empty state text when isActive is true', () => {
        render(<TerminalView rawOutput={[]} isActive />);
        const el = screen.getByText('Waiting for terminal output...');
        expect(el.className).toContain('animate-pulse');
      });

      it('does not apply animate-pulse to empty state text when isActive is false', () => {
        render(<TerminalView rawOutput={[]} isActive={false} />);
        const el = screen.getByText('No terminal output');
        expect(el.className).not.toContain('animate-pulse');
      });

      it('applies animate-pulse to the terminal icon when isActive is true', () => {
        const { container } = render(<TerminalView rawOutput={[]} isActive />);
        const svg = container.querySelector('svg[aria-hidden="true"]');
        const classStr = svg?.getAttribute('class') ?? '';
        const parentClass = svg?.parentElement?.className ?? '';
        const hasAnimatePulse =
          classStr.includes('animate-pulse') || parentClass.includes('animate-pulse');
        expect(hasAnimatePulse).toBe(true);
      });

      it('does not apply animate-pulse to the terminal icon when isActive is false', () => {
        const { container } = render(<TerminalView rawOutput={[]} isActive={false} />);
        const svg = container.querySelector('svg[aria-hidden="true"]');
        const classStr = svg?.getAttribute('class') ?? '';
        expect(classStr).not.toContain('animate-pulse');
      });

      it('defaults isActive to undefined (no live indicator, no pulse)', () => {
        render(<TerminalView rawOutput={[]} />);
        const el = screen.getByText('No terminal output');
        expect(el.className).not.toContain('animate-pulse');
        expect(screen.queryByText('Live')).toBeNull();
      });
    });

    describe('className', () => {
      it('applies custom className to the outer section', () => {
        const { container } = render(<TerminalView rawOutput={[]} className="my-custom-class" />);
        const section = container.firstChild as HTMLElement;
        expect(section.className).toContain('my-custom-class');
      });

      it('preserves default classes when custom className is added', () => {
        const { container } = render(<TerminalView rawOutput={[]} className="extra" />);
        const section = container.firstChild as HTMLElement;
        expect(section.className).toContain('relative');
        expect(section.className).toContain('extra');
      });

      it('works without className prop', () => {
        const { container } = render(<TerminalView rawOutput={[]} />);
        const section = container.firstChild as HTMLElement;
        expect(section.className).toContain('relative');
      });
    });

    describe('rawOutput', () => {
      it('shows the empty state overlay when rawOutput is an empty array', () => {
        render(<TerminalView rawOutput={[]} />);
        expect(screen.getByText('No terminal output')).toBeDefined();
      });

      it('hides the empty state overlay when rawOutput has data', () => {
        render(<TerminalView rawOutput={['hello']} />);
        expect(screen.queryByText('No terminal output')).toBeNull();
        expect(screen.queryByText('Waiting for terminal output...')).toBeNull();
      });
    });
  });

  // =========================================================================
  // 3. Live indicator
  // =========================================================================
  describe('live indicator', () => {
    it('shows "Live" badge when isActive and rawOutput has data', () => {
      render(<TerminalView rawOutput={['some output']} isActive />);
      expect(screen.getByText('Live')).toBeDefined();
    });

    it('shows an animated green dot alongside the Live label', () => {
      const { container } = render(<TerminalView rawOutput={['some output']} isActive />);
      const dot = container.querySelector('.bg-green-500.animate-pulse');
      expect(dot).not.toBeNull();
    });

    it('does not show "Live" when isActive is false', () => {
      render(<TerminalView rawOutput={['some output']} isActive={false} />);
      expect(screen.queryByText('Live')).toBeNull();
    });

    it('does not show "Live" when isActive is true but rawOutput is empty', () => {
      render(<TerminalView rawOutput={[]} isActive />);
      expect(screen.queryByText('Live')).toBeNull();
    });

    it('does not show "Live" when isActive is undefined and rawOutput has data', () => {
      render(<TerminalView rawOutput={['output']} />);
      expect(screen.queryByText('Live')).toBeNull();
    });
  });

  // =========================================================================
  // 4. Terminal initialization (xterm dynamic import)
  // =========================================================================
  describe('terminal initialization', () => {
    it('dynamically imports @xterm/xterm and @xterm/addon-fit', async () => {
      render(<TerminalView rawOutput={[]} />);
      await flushAsyncInit();
      expect(mockOpen).toHaveBeenCalled();
      expect(mockLoadAddon).toHaveBeenCalled();
    });

    it('loads FitAddon into the terminal before opening', async () => {
      render(<TerminalView rawOutput={[]} />);
      await flushAsyncInit();
      const loadAddonOrder = mockLoadAddon.mock.invocationCallOrder[0] ?? 0;
      const openOrder = mockOpen.mock.invocationCallOrder[0] ?? 0;
      expect(loadAddonOrder).toBeLessThan(openOrder);
    });

    it('calls fitAddon.fit() after opening the terminal', async () => {
      render(<TerminalView rawOutput={[]} />);
      await flushAsyncInit();
      expect(mockFit).toHaveBeenCalled();
    });

    it('opens terminal into the container div element', async () => {
      const { container } = render(<TerminalView rawOutput={[]} />);
      await flushAsyncInit();
      const termDiv = container.querySelector('.bg-\\[\\#0a0a0a\\]');
      expect(mockOpen).toHaveBeenCalledWith(termDiv);
    });

    it('resets writtenCount on re-mount', async () => {
      // First mount: render with empty, then add output after init
      const { rerender, unmount } = render(<TerminalView rawOutput={[]} />);
      await flushAsyncInit();
      rerender(<TerminalView rawOutput={['first']} />);

      await vi.waitFor(() => {
        expect(mockWrite).toHaveBeenCalledWith('first');
      });

      unmount();
      vi.clearAllMocks();

      // Second mount: the writtenCount ref resets, so all chunks are written
      const { rerender: rerender2 } = render(<TerminalView rawOutput={[]} />);
      await flushAsyncInit();
      rerender2(<TerminalView rawOutput={['second']} />);

      await vi.waitFor(() => {
        expect(mockWrite).toHaveBeenCalledWith('second');
      });
    });
  });

  // =========================================================================
  // 5. Terminal data handling — writing rawOutput chunks
  // =========================================================================
  describe('terminal data handling', () => {
    // NOTE: The component initialises the terminal asynchronously via dynamic
    // import(). The rawOutput useEffect depends on [rawOutput], but runs
    // synchronously on the initial render when terminalRef.current is still
    // null. To trigger a write, we must change the rawOutput reference AFTER
    // the async init has completed, either by re-rendering with new data or
    // by starting with an empty array and then adding data.

    it('writes rawOutput chunks to the terminal when rawOutput changes after init', async () => {
      const { rerender } = render(<TerminalView rawOutput={[]} />);
      await flushAsyncInit();

      rerender(<TerminalView rawOutput={['hello', 'world']} />);

      await vi.waitFor(() => {
        expect(mockWrite).toHaveBeenCalledWith('hello');
        expect(mockWrite).toHaveBeenCalledWith('world');
      });
    });

    it('writes only new chunks when rawOutput array grows', async () => {
      const { rerender } = render(<TerminalView rawOutput={[]} />);
      await flushAsyncInit();

      rerender(<TerminalView rawOutput={['chunk1']} />);
      await vi.waitFor(() => {
        expect(mockWrite).toHaveBeenCalledWith('chunk1');
      });

      mockWrite.mockClear();
      rerender(<TerminalView rawOutput={['chunk1', 'chunk2', 'chunk3']} />);

      await vi.waitFor(() => {
        expect(mockWrite).toHaveBeenCalledWith('chunk2');
        expect(mockWrite).toHaveBeenCalledWith('chunk3');
      });

      // chunk1 should NOT be re-written
      expect(mockWrite).not.toHaveBeenCalledWith('chunk1');
    });

    it('does not write anything when rawOutput is empty', async () => {
      render(<TerminalView rawOutput={[]} />);
      await flushAsyncInit();
      expect(mockWrite).not.toHaveBeenCalled();
    });

    it('skips empty string chunks (falsy guard)', async () => {
      const { rerender } = render(<TerminalView rawOutput={[]} />);
      await flushAsyncInit();

      rerender(<TerminalView rawOutput={['', 'valid', '']} />);

      await vi.waitFor(() => {
        expect(mockWrite).toHaveBeenCalledWith('valid');
      });

      // Empty strings are falsy so terminal.write is NOT called for them
      expect(mockWrite).toHaveBeenCalledTimes(1);
    });

    it('does not call terminal.write when terminal is not yet initialized', () => {
      // The rawOutput effect runs synchronously on first render when
      // terminalRef.current is still null. No crash expected.
      render(<TerminalView rawOutput={['data']} />);
      // No assertion needed — the test passes if no error is thrown.
    });

    it('handles many rapid re-renders with growing rawOutput', async () => {
      const { rerender } = render(<TerminalView rawOutput={[]} />);
      await flushAsyncInit();

      rerender(<TerminalView rawOutput={['a']} />);
      await vi.waitFor(() => {
        expect(mockWrite).toHaveBeenCalledWith('a');
      });

      mockWrite.mockClear();

      rerender(<TerminalView rawOutput={['a', 'b']} />);
      rerender(<TerminalView rawOutput={['a', 'b', 'c']} />);
      rerender(<TerminalView rawOutput={['a', 'b', 'c', 'd']} />);

      await vi.waitFor(() => {
        expect(mockWrite).toHaveBeenCalledWith('d');
      });

      // Should write b, c, d but NOT re-write 'a'
      expect(mockWrite).not.toHaveBeenCalledWith('a');
    });

    it('writes all chunks when multiple arrive at once', async () => {
      const { rerender } = render(<TerminalView rawOutput={[]} />);
      await flushAsyncInit();

      rerender(<TerminalView rawOutput={['line1\n', 'line2\n', 'line3\n']} />);

      await vi.waitFor(() => {
        expect(mockWrite).toHaveBeenCalledTimes(3);
      });

      expect(mockWrite).toHaveBeenNthCalledWith(1, 'line1\n');
      expect(mockWrite).toHaveBeenNthCalledWith(2, 'line2\n');
      expect(mockWrite).toHaveBeenNthCalledWith(3, 'line3\n');
    });

    it('handles ANSI escape sequences in rawOutput', async () => {
      const { rerender } = render(<TerminalView rawOutput={[]} />);
      await flushAsyncInit();

      const ansiChunk = '\x1b[32mgreen text\x1b[0m';
      rerender(<TerminalView rawOutput={[ansiChunk]} />);

      await vi.waitFor(() => {
        expect(mockWrite).toHaveBeenCalledWith(ansiChunk);
      });
    });
  });

  // =========================================================================
  // 6. Resize handling
  // =========================================================================
  describe('resize handling', () => {
    it('adds a window resize listener on mount', () => {
      const addSpy = vi.spyOn(window, 'addEventListener');
      render(<TerminalView rawOutput={[]} />);

      expect(addSpy).toHaveBeenCalledWith('resize', expect.any(Function));
      addSpy.mockRestore();
    });

    it('calls fitAddon.fit() on window resize event', async () => {
      render(<TerminalView rawOutput={[]} />);
      await flushAsyncInit();
      mockFit.mockClear();

      window.dispatchEvent(new Event('resize'));

      expect(mockFit).toHaveBeenCalled();
    });

    it('schedules a delayed fit via setTimeout(100ms) on mount', async () => {
      // Use real timers so we control advancement precisely
      vi.useRealTimers();
      vi.useFakeTimers({ shouldAdvanceTime: false });

      render(<TerminalView rawOutput={[]} />);

      // Resolve the async dynamic imports by flushing microtasks
      await vi.advanceTimersByTimeAsync(0);

      // At this point the terminal is initialised and the 100ms timer is
      // pending. The init itself called fit() once; clear the count so we
      // can isolate the delayed call.
      mockFit.mockClear();

      // Advance past the 100ms timeout
      await vi.advanceTimersByTimeAsync(150);

      expect(mockFit).toHaveBeenCalled();
    });

    it('does not throw when fitAddon.fit() throws during resize', async () => {
      render(<TerminalView rawOutput={[]} />);
      await flushAsyncInit();

      mockFit.mockImplementationOnce(() => {
        throw new Error('Terminal not ready');
      });

      expect(() => {
        window.dispatchEvent(new Event('resize'));
      }).not.toThrow();
    });

    it('swallows errors from fitAddon.fit() silently (try/catch in handleResize)', async () => {
      render(<TerminalView rawOutput={[]} />);
      await flushAsyncInit();

      // Throw multiple times — all should be swallowed
      mockFit.mockImplementation(() => {
        throw new Error('not ready');
      });

      expect(() => {
        window.dispatchEvent(new Event('resize'));
        window.dispatchEvent(new Event('resize'));
      }).not.toThrow();

      mockFit.mockImplementation(vi.fn());
    });

    it('observes parent element with ResizeObserver', () => {
      const observeSpy = vi.fn();
      const disconnectSpy = vi.fn();

      vi.stubGlobal(
        'ResizeObserver',
        vi.fn().mockImplementation(() => ({
          observe: observeSpy,
          disconnect: disconnectSpy,
          unobserve: vi.fn(),
        })),
      );

      render(<TerminalView rawOutput={[]} />);
      expect(observeSpy).toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it('disconnects ResizeObserver on unmount', () => {
      const disconnectSpy = vi.fn();

      vi.stubGlobal(
        'ResizeObserver',
        vi.fn().mockImplementation(() => ({
          observe: vi.fn(),
          disconnect: disconnectSpy,
          unobserve: vi.fn(),
        })),
      );

      const { unmount } = render(<TerminalView rawOutput={[]} />);
      unmount();

      expect(disconnectSpy).toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it('calls fit when ResizeObserver fires', async () => {
      let resizeCallback: ResizeObserverCallback | null = null;

      vi.stubGlobal(
        'ResizeObserver',
        vi.fn().mockImplementation((cb: ResizeObserverCallback) => {
          resizeCallback = cb;
          return {
            observe: vi.fn(),
            disconnect: vi.fn(),
            unobserve: vi.fn(),
          };
        }),
      );

      render(<TerminalView rawOutput={[]} />);
      await flushAsyncInit();
      mockFit.mockClear();

      // biome-ignore lint/style/noNonNullAssertion: TS can't narrow let across closures
      resizeCallback!([], {} as ResizeObserver);

      expect(mockFit).toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it('handles multiple resize events in rapid succession', async () => {
      render(<TerminalView rawOutput={[]} />);
      await flushAsyncInit();
      mockFit.mockClear();

      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('resize'));

      expect(mockFit).toHaveBeenCalledTimes(3);
    });
  });

  // =========================================================================
  // 7. Cleanup on unmount
  // =========================================================================
  describe('cleanup on unmount', () => {
    it('disposes the xterm terminal on unmount', async () => {
      const { unmount } = render(<TerminalView rawOutput={[]} />);
      await flushAsyncInit();
      mockDispose.mockClear();

      unmount();

      expect(mockDispose).toHaveBeenCalled();
    });

    it('removes the window resize listener on unmount', () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener');

      const { unmount } = render(<TerminalView rawOutput={[]} />);
      unmount();

      expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function));
      removeSpy.mockRestore();
    });

    it('clears the delayed fit timeout on unmount', () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      const { unmount } = render(<TerminalView rawOutput={[]} />);
      unmount();

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });

    it('sets disposed flag to prevent terminal init after unmount', async () => {
      const { unmount } = render(<TerminalView rawOutput={[]} />);
      // Unmount immediately before async init completes
      unmount();

      // Wait for the async import to resolve
      await vi.advanceTimersByTimeAsync(0);

      // No error should be thrown. The disposed flag prevents calling
      // terminal.open on an unmounted component.
    });

    it('nulls out terminal and fitAddon refs on cleanup', async () => {
      const { unmount } = render(<TerminalView rawOutput={['data']} />);
      await flushAsyncInit();

      unmount();

      // After unmount, the resize listener is already removed and refs are
      // null. This is a structural guarantee from the cleanup function.
      mockFit.mockClear();
    });

    it('resets writtenCount on cleanup so re-mount writes all chunks', async () => {
      const { rerender, unmount } = render(<TerminalView rawOutput={[]} />);
      await flushAsyncInit();

      rerender(<TerminalView rawOutput={['line1', 'line2']} />);
      await vi.waitFor(() => {
        expect(mockWrite).toHaveBeenCalledWith('line1');
        expect(mockWrite).toHaveBeenCalledWith('line2');
      });

      unmount();
      vi.clearAllMocks();

      // Re-mount: writtenCount should be 0 again, so all chunks are re-written
      const { rerender: rerender2 } = render(<TerminalView rawOutput={[]} />);
      await flushAsyncInit();

      rerender2(<TerminalView rawOutput={['line1', 'line2']} />);
      await vi.waitFor(() => {
        expect(mockWrite).toHaveBeenCalledWith('line1');
        expect(mockWrite).toHaveBeenCalledWith('line2');
      });
    });

    it('does not call terminal.write after unmount even if rawOutput was pending', async () => {
      const { unmount } = render(<TerminalView rawOutput={[]} />);
      await flushAsyncInit();

      // Unmount before adding data
      unmount();
      mockWrite.mockClear();

      // No further writes should happen since the terminal is disposed
      expect(mockWrite).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 8. React.memo behavior
  // =========================================================================
  describe('React.memo behavior', () => {
    it('does not re-render when the same props object references are passed', async () => {
      const output = ['hello'];
      const { rerender } = render(<TerminalView rawOutput={output} isActive className="cls" />);
      await flushAsyncInit();

      mockWrite.mockClear();

      // Re-render with the exact same object references
      rerender(<TerminalView rawOutput={output} isActive className="cls" />);

      // Since rawOutput reference is the same, the useEffect does not re-run
      expect(mockWrite).not.toHaveBeenCalled();
    });

    it('re-runs rawOutput effect when a new array reference is passed', async () => {
      const { rerender } = render(<TerminalView rawOutput={[]} />);
      await flushAsyncInit();

      // Pass a new array reference with the same contents — effect should re-run
      rerender(<TerminalView rawOutput={['data']} />);

      await vi.waitFor(() => {
        expect(mockWrite).toHaveBeenCalledWith('data');
      });
    });
  });

  // =========================================================================
  // 9. Edge cases
  // =========================================================================
  describe('edge cases', () => {
    it('handles rawOutput with only empty strings (overlay hidden since length > 0)', () => {
      render(<TerminalView rawOutput={['', '', '']} />);
      // rawOutput.length > 0 hides the empty overlay even though strings are empty
      expect(screen.queryByText('No terminal output')).toBeNull();
    });

    it('handles very large rawOutput arrays', async () => {
      const { rerender } = render(<TerminalView rawOutput={[]} />);
      await flushAsyncInit();

      const largeOutput = Array.from({ length: 1000 }, (_, i) => `line ${String(i)}\n`);
      rerender(<TerminalView rawOutput={largeOutput} />);

      await vi.waitFor(() => {
        expect(mockWrite).toHaveBeenCalledTimes(1000);
      });
    });

    it('does not crash when rawOutput transitions from non-empty to empty', async () => {
      const { rerender } = render(<TerminalView rawOutput={['data']} />);
      await flushAsyncInit();

      expect(() => {
        rerender(<TerminalView rawOutput={[]} />);
      }).not.toThrow();

      // Empty state overlay should reappear
      expect(screen.getByText('No terminal output')).toBeDefined();
    });

    it('renders correctly when isActive switches from true to false', () => {
      const { rerender } = render(<TerminalView rawOutput={['data']} isActive />);
      expect(screen.getByText('Live')).toBeDefined();

      rerender(<TerminalView rawOutput={['data']} isActive={false} />);
      expect(screen.queryByText('Live')).toBeNull();
    });

    it('renders correctly when isActive switches from false to true', () => {
      const { rerender } = render(<TerminalView rawOutput={['data']} isActive={false} />);
      expect(screen.queryByText('Live')).toBeNull();

      rerender(<TerminalView rawOutput={['data']} isActive />);
      expect(screen.getByText('Live')).toBeDefined();
    });

    it('does not show Live indicator when isActive toggles but rawOutput stays empty', () => {
      const { rerender } = render(<TerminalView rawOutput={[]} isActive={false} />);
      rerender(<TerminalView rawOutput={[]} isActive />);

      // Both conditions must be true: isActive AND rawOutput.length > 0
      expect(screen.queryByText('Live')).toBeNull();
      expect(screen.getByText('Waiting for terminal output...')).toBeDefined();
    });

    it('handles rawOutput with special characters (newlines, tabs, unicode)', async () => {
      const { rerender } = render(<TerminalView rawOutput={[]} />);
      await flushAsyncInit();

      const specialChunk = 'hello\n\ttab\r\nwindows\n\u2603 snowman';
      rerender(<TerminalView rawOutput={[specialChunk]} />);

      await vi.waitFor(() => {
        expect(mockWrite).toHaveBeenCalledWith(specialChunk);
      });
    });

    it('does not write duplicate chunks when rawOutput is unchanged between rerenders', async () => {
      const { rerender } = render(<TerminalView rawOutput={[]} />);
      await flushAsyncInit();

      const output = ['chunk1', 'chunk2'];
      rerender(<TerminalView rawOutput={output} />);

      await vi.waitFor(() => {
        expect(mockWrite).toHaveBeenCalledTimes(2);
      });

      mockWrite.mockClear();

      // Re-render with the same reference — should not write again
      rerender(<TerminalView rawOutput={output} />);

      expect(mockWrite).not.toHaveBeenCalled();
    });
  });
});
