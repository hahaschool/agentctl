import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../lib/format-utils', () => ({
  timeAgo: vi.fn(() => '5m ago'),
  formatDateTime: vi.fn(() => '2026-03-06 10:00:00'),
}));

import { formatDateTime, timeAgo } from '../lib/format-utils';
import { LiveTimeAgo } from './LiveTimeAgo';

const mockedTimeAgo = vi.mocked(timeAgo);
const mockedFormatDateTime = vi.mocked(formatDateTime);

beforeEach(() => {
  vi.useFakeTimers();
  mockedTimeAgo.mockReturnValue('5m ago');
  mockedFormatDateTime.mockReturnValue('2026-03-06 10:00:00');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('LiveTimeAgo', () => {
  describe('rendering with a valid date', () => {
    it('renders timeAgo text for a valid date', () => {
      render(<LiveTimeAgo date="2026-03-06T10:00:00Z" />);
      expect(screen.getByText('5m ago')).toBeDefined();
      expect(mockedTimeAgo).toHaveBeenCalledWith('2026-03-06T10:00:00Z');
    });

    it('calls formatDateTime with the date prop', () => {
      render(<LiveTimeAgo date="2026-03-06T10:00:00Z" />);
      expect(mockedFormatDateTime).toHaveBeenCalledWith('2026-03-06T10:00:00Z');
    });

    it('shows formatDateTime result as title attribute', () => {
      mockedFormatDateTime.mockReturnValue('March 6, 2026 10:00 AM');
      render(<LiveTimeAgo date="2026-03-06T10:00:00Z" />);
      const span = screen.getByText('5m ago');
      expect(span.getAttribute('title')).toBe('March 6, 2026 10:00 AM');
    });

    it('renders a span element', () => {
      const { container } = render(<LiveTimeAgo date="2026-03-06T10:00:00Z" />);
      const span = container.querySelector('span');
      expect(span).toBeDefined();
      expect(span?.textContent).toBe('5m ago');
    });
  });

  describe('className prop', () => {
    it('applies custom className to the span when date is valid', () => {
      const { container } = render(
        <LiveTimeAgo date="2026-03-06T10:00:00Z" className="text-muted" />,
      );
      const span = container.querySelector('span');
      expect(span?.className).toContain('text-muted');
    });

    it('applies custom className to the fallback span when date is empty', () => {
      const { container } = render(<LiveTimeAgo date="" className="text-gray-400" />);
      const span = container.querySelector('span');
      expect(span?.className).toContain('text-gray-400');
    });

    it('does not set className when prop is omitted', () => {
      const { container } = render(<LiveTimeAgo date="2026-03-06T10:00:00Z" />);
      const span = container.querySelector('span');
      // className attribute should not be set (undefined → no attribute)
      expect(span?.className).toBe('');
    });
  });

  describe('fallback behavior', () => {
    it('shows fallback text when date is empty string', () => {
      render(<LiveTimeAgo date="" fallback="N/A" />);
      expect(screen.getByText('N/A')).toBeDefined();
    });

    it('shows default empty string fallback when date is empty and no fallback prop', () => {
      const { container } = render(<LiveTimeAgo date="" />);
      const span = container.querySelector('span');
      expect(span?.textContent).toBe('');
    });

    it('does not call timeAgo when date is empty', () => {
      render(<LiveTimeAgo date="" fallback="none" />);
      expect(mockedTimeAgo).not.toHaveBeenCalled();
    });

    it('does not call formatDateTime when date is empty', () => {
      render(<LiveTimeAgo date="" fallback="none" />);
      expect(mockedFormatDateTime).not.toHaveBeenCalled();
    });

    it('does not render a title attribute when date is empty', () => {
      const { container } = render(<LiveTimeAgo date="" fallback="N/A" />);
      const span = container.querySelector('span');
      expect(span?.getAttribute('title')).toBeNull();
    });

    it('renders custom fallback text for different fallback values', () => {
      render(<LiveTimeAgo date="" fallback="Unknown" />);
      expect(screen.getByText('Unknown')).toBeDefined();
    });
  });

  describe('interval timer setup and cleanup', () => {
    it('sets up a setInterval with the default 30s interval', () => {
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
      render(<LiveTimeAgo date="2026-03-06T10:00:00Z" />);
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);
    });

    it('clears the interval on unmount', () => {
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
      const { unmount } = render(<LiveTimeAgo date="2026-03-06T10:00:00Z" />);
      unmount();
      expect(clearIntervalSpy).toHaveBeenCalledOnce();
    });

    it('clears old interval and sets new one when interval prop changes', () => {
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

      const { rerender } = render(<LiveTimeAgo date="2026-03-06T10:00:00Z" interval={10_000} />);
      const initialCallCount = setIntervalSpy.mock.calls.length;

      rerender(<LiveTimeAgo date="2026-03-06T10:00:00Z" interval={5_000} />);

      // Old interval cleared, new one created
      expect(clearIntervalSpy).toHaveBeenCalled();
      expect(setIntervalSpy.mock.calls.length).toBeGreaterThan(initialCallCount);
      // The most recent setInterval call should use the new interval
      const lastCall = setIntervalSpy.mock.calls[setIntervalSpy.mock.calls.length - 1];
      expect(lastCall?.[1]).toBe(5_000);
    });
  });

  describe('custom interval prop', () => {
    it('uses custom interval value for the timer', () => {
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
      render(<LiveTimeAgo date="2026-03-06T10:00:00Z" interval={5_000} />);
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5_000);
    });

    it('uses custom interval value of 1 second', () => {
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
      render(<LiveTimeAgo date="2026-03-06T10:00:00Z" interval={1_000} />);
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 1_000);
    });
  });

  describe('timer-driven re-renders', () => {
    it('re-renders after the default interval elapses', () => {
      mockedTimeAgo.mockReturnValueOnce('5m ago').mockReturnValueOnce('6m ago');

      render(<LiveTimeAgo date="2026-03-06T10:00:00Z" />);
      expect(screen.getByText('5m ago')).toBeDefined();

      act(() => {
        vi.advanceTimersByTime(30_000);
      });

      expect(screen.getByText('6m ago')).toBeDefined();
    });

    it('re-renders multiple times across multiple intervals', () => {
      mockedTimeAgo
        .mockReturnValueOnce('1m ago')
        .mockReturnValueOnce('2m ago')
        .mockReturnValueOnce('3m ago');

      render(<LiveTimeAgo date="2026-03-06T10:00:00Z" interval={1_000} />);
      expect(screen.getByText('1m ago')).toBeDefined();

      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      expect(screen.getByText('2m ago')).toBeDefined();

      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      expect(screen.getByText('3m ago')).toBeDefined();
    });

    it('does not re-render before the interval elapses', () => {
      mockedTimeAgo.mockReturnValue('5m ago');

      render(<LiveTimeAgo date="2026-03-06T10:00:00Z" interval={10_000} />);

      // Advance less than the interval
      act(() => {
        vi.advanceTimersByTime(5_000);
      });

      // timeAgo should have been called only once (initial render)
      expect(mockedTimeAgo).toHaveBeenCalledTimes(1);
    });

    it('calls timeAgo again after the interval fires', () => {
      render(<LiveTimeAgo date="2026-03-06T10:00:00Z" interval={10_000} />);
      expect(mockedTimeAgo).toHaveBeenCalledTimes(1);

      act(() => {
        vi.advanceTimersByTime(10_000);
      });

      expect(mockedTimeAgo).toHaveBeenCalledTimes(2);
    });

    it('still sets up a timer even when date is empty (effect runs unconditionally)', () => {
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
      render(<LiveTimeAgo date="" fallback="N/A" />);
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);
    });
  });
});
