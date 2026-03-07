import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFormatDuration = vi.fn<(start: string, end?: string | null) => string>(() => '0s');

vi.mock('../lib/format-utils', () => ({
  formatDuration: (start: string, end?: string | null) => mockFormatDuration(start, end),
}));

import { LiveDuration } from './LiveDuration';

beforeEach(() => {
  vi.useFakeTimers();
  mockFormatDuration.mockReset();
  mockFormatDuration.mockReturnValue('0s');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('LiveDuration', () => {
  describe('rendering', () => {
    it('renders formatted duration for a completed session (startedAt + endedAt)', () => {
      mockFormatDuration.mockReturnValue('5m 30s');
      render(<LiveDuration startedAt="2026-03-06T10:00:00Z" endedAt="2026-03-06T10:05:30Z" />);
      expect(screen.getByText('5m 30s')).toBeDefined();
      expect(mockFormatDuration).toHaveBeenCalledWith(
        '2026-03-06T10:00:00Z',
        '2026-03-06T10:05:30Z',
      );
    });

    it('renders formatted duration for an active session (no endedAt)', () => {
      mockFormatDuration.mockReturnValue('0s');
      render(<LiveDuration startedAt="2026-03-06T10:00:00Z" />);
      expect(screen.getByText('0s')).toBeDefined();
      expect(mockFormatDuration).toHaveBeenCalledWith('2026-03-06T10:00:00Z', undefined);
    });

    it('renders formatted duration when endedAt is explicitly null', () => {
      mockFormatDuration.mockReturnValue('12s');
      render(<LiveDuration startedAt="2026-03-06T10:00:00Z" endedAt={null} />);
      expect(screen.getByText('12s')).toBeDefined();
      expect(mockFormatDuration).toHaveBeenCalledWith('2026-03-06T10:00:00Z', null);
    });

    it('applies className to the span element', () => {
      mockFormatDuration.mockReturnValue('1m 0s');
      const { container } = render(
        <LiveDuration
          startedAt="2026-03-06T10:00:00Z"
          endedAt="2026-03-06T10:01:00Z"
          className="text-red-500 font-bold"
        />,
      );
      const span = container.querySelector('span');
      expect(span?.className).toContain('text-red-500');
      expect(span?.className).toContain('font-bold');
    });

    it('renders without className when not provided', () => {
      mockFormatDuration.mockReturnValue('0s');
      const { container } = render(<LiveDuration startedAt="2026-03-06T10:00:00Z" />);
      const span = container.querySelector('span');
      expect(span).toBeDefined();
      // className should be undefined (no attribute set)
      expect(span?.getAttribute('class')).toBeNull();
    });
  });

  describe('interval timer for active sessions', () => {
    it('sets up an interval timer when no endedAt (active session)', () => {
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
      render(<LiveDuration startedAt="2026-03-06T10:00:00Z" />);
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 1_000);
    });

    it('sets up an interval timer when endedAt is null', () => {
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
      render(<LiveDuration startedAt="2026-03-06T10:00:00Z" endedAt={null} />);
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 1_000);
    });

    it('does NOT set up an interval timer when endedAt is provided', () => {
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
      render(<LiveDuration startedAt="2026-03-06T10:00:00Z" endedAt="2026-03-06T10:05:00Z" />);
      // setInterval may be called by React internals, so check it was not called
      // with our specific 1000ms argument
      const ourCalls = setIntervalSpy.mock.calls.filter((call) => call[1] === 1_000);
      expect(ourCalls).toHaveLength(0);
    });
  });

  describe('timer triggers re-render', () => {
    it('calls formatDuration again after each timer tick', () => {
      mockFormatDuration.mockReturnValue('0s');
      render(<LiveDuration startedAt="2026-03-06T10:00:00Z" />);

      const initialCallCount = mockFormatDuration.mock.calls.length;

      // Advance by 1 second — one tick
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      expect(mockFormatDuration.mock.calls.length).toBeGreaterThan(initialCallCount);

      const afterFirstTick = mockFormatDuration.mock.calls.length;

      // Advance by another second — another tick
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      expect(mockFormatDuration.mock.calls.length).toBeGreaterThan(afterFirstTick);
    });

    it('updates displayed text when formatDuration returns new value after tick', () => {
      mockFormatDuration.mockReturnValue('0s');
      render(<LiveDuration startedAt="2026-03-06T10:00:00Z" />);
      expect(screen.getByText('0s')).toBeDefined();

      // After tick, formatDuration returns updated value
      mockFormatDuration.mockReturnValue('1s');
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      expect(screen.getByText('1s')).toBeDefined();

      // Another tick with a longer duration
      mockFormatDuration.mockReturnValue('2s');
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      expect(screen.getByText('2s')).toBeDefined();
    });

    it('does not re-render when endedAt is provided and timers advance', () => {
      mockFormatDuration.mockReturnValue('5m 0s');
      render(<LiveDuration startedAt="2026-03-06T10:00:00Z" endedAt="2026-03-06T10:05:00Z" />);
      const callCountAfterRender = mockFormatDuration.mock.calls.length;

      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      // No additional calls because no interval is running
      expect(mockFormatDuration.mock.calls.length).toBe(callCountAfterRender);
    });
  });

  describe('cleanup on unmount', () => {
    it('clears the interval timer when the component unmounts', () => {
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
      const { unmount } = render(<LiveDuration startedAt="2026-03-06T10:00:00Z" />);

      unmount();

      // clearInterval should have been called with the timer ID
      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it('does not call clearInterval on unmount when endedAt is provided (no timer to clear)', () => {
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
      const { unmount } = render(
        <LiveDuration startedAt="2026-03-06T10:00:00Z" endedAt="2026-03-06T10:05:00Z" />,
      );

      // Reset spy to only track calls during unmount
      clearIntervalSpy.mockClear();
      unmount();

      // No interval was set up, so clearInterval should not be called by our effect
      // (React may call it internally, but we check it was not called with a timer ID from us)
      expect(clearIntervalSpy).not.toHaveBeenCalled();
    });
  });

  describe('switching from active to ended', () => {
    it('clears timer when endedAt changes from null to a value', () => {
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
      mockFormatDuration.mockReturnValue('0s');

      const { rerender } = render(<LiveDuration startedAt="2026-03-06T10:00:00Z" endedAt={null} />);

      // Verify timer is ticking
      mockFormatDuration.mockReturnValue('1s');
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      expect(screen.getByText('1s')).toBeDefined();

      // Now provide endedAt — timer should be cleared
      clearIntervalSpy.mockClear();
      mockFormatDuration.mockReturnValue('2m 0s');
      rerender(<LiveDuration startedAt="2026-03-06T10:00:00Z" endedAt="2026-03-06T10:02:00Z" />);

      expect(clearIntervalSpy).toHaveBeenCalled();
      expect(screen.getByText('2m 0s')).toBeDefined();

      // Further time advancement should not cause additional formatDuration calls
      const callsAfterRerender = mockFormatDuration.mock.calls.length;
      act(() => {
        vi.advanceTimersByTime(3_000);
      });
      expect(mockFormatDuration.mock.calls.length).toBe(callsAfterRerender);
    });

    it('starts timer when endedAt changes from a value to null', () => {
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
      mockFormatDuration.mockReturnValue('5m 0s');

      const { rerender } = render(
        <LiveDuration startedAt="2026-03-06T10:00:00Z" endedAt="2026-03-06T10:05:00Z" />,
      );

      // Ended session — no interval with 1000ms
      const initialCalls = setIntervalSpy.mock.calls.filter((call) => call[1] === 1_000);
      expect(initialCalls).toHaveLength(0);

      // Remove endedAt — should start ticking
      setIntervalSpy.mockClear();
      mockFormatDuration.mockReturnValue('5m 1s');
      rerender(<LiveDuration startedAt="2026-03-06T10:00:00Z" endedAt={null} />);

      const newCalls = setIntervalSpy.mock.calls.filter((call) => call[1] === 1_000);
      expect(newCalls).toHaveLength(1);

      // Timer should be working
      mockFormatDuration.mockReturnValue('5m 2s');
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      expect(screen.getByText('5m 2s')).toBeDefined();
    });
  });

  describe('formatDuration arguments', () => {
    it('always passes startedAt and endedAt to formatDuration', () => {
      mockFormatDuration.mockReturnValue('1h 30m');
      render(<LiveDuration startedAt="2026-03-06T08:00:00Z" endedAt="2026-03-06T09:30:00Z" />);
      expect(mockFormatDuration).toHaveBeenCalledWith(
        '2026-03-06T08:00:00Z',
        '2026-03-06T09:30:00Z',
      );
    });

    it('passes undefined endedAt when prop is omitted', () => {
      mockFormatDuration.mockReturnValue('3s');
      render(<LiveDuration startedAt="2026-03-06T10:00:00Z" />);
      expect(mockFormatDuration).toHaveBeenCalledWith('2026-03-06T10:00:00Z', undefined);
    });
  });
});
