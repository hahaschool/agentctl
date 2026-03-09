import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LastUpdated } from './LastUpdated';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('LastUpdated', () => {
  describe('null / falsy input', () => {
    it('returns null when dataUpdatedAt is 0', () => {
      const { container } = render(<LastUpdated dataUpdatedAt={0} />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('timestamp rendering', () => {
    it('shows "Updated just now" when updated less than 5 seconds ago', () => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      render(<LastUpdated dataUpdatedAt={now - 2000} />);
      expect(screen.getByText('Updated just now')).toBeDefined();
    });

    it('shows seconds ago when updated between 5 and 59 seconds ago', () => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      render(<LastUpdated dataUpdatedAt={now - 30_000} />);
      expect(screen.getByText('Updated 30s ago')).toBeDefined();
    });

    it('shows minutes ago when updated 60+ seconds ago', () => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      render(<LastUpdated dataUpdatedAt={now - 180_000} />);
      expect(screen.getByText('Updated 3m ago')).toBeDefined();
    });

    it('shows correct minutes for large durations', () => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      render(<LastUpdated dataUpdatedAt={now - 600_000} />);
      expect(screen.getByText('Updated 10m ago')).toBeDefined();
    });
  });

  describe('auto-update via interval', () => {
    it('re-renders after the 5s interval tick to update the label', () => {
      vi.useFakeTimers();
      const baseTime = 1_700_000_000_000;
      vi.setSystemTime(baseTime);

      // Updated "just now" (1 second ago)
      render(<LastUpdated dataUpdatedAt={baseTime - 1000} />);
      expect(screen.getByText('Updated just now')).toBeDefined();

      // Advance 10 seconds → total 11s ago → should show "11s ago" after tick
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(screen.getByText('Updated 11s ago')).toBeDefined();
    });
  });

  describe('accessibility', () => {
    it('has a title attribute for accessibility', () => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      render(<LastUpdated dataUpdatedAt={now} />);
      const el = screen.getByTitle('Last data refresh');
      expect(el).toBeDefined();
    });
  });

  describe('boundary values', () => {
    it('shows "Updated 59s ago" at exactly 59 seconds', () => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      render(<LastUpdated dataUpdatedAt={now - 59_000} />);
      expect(screen.getByText('Updated 59s ago')).toBeDefined();
    });

    it('shows "Updated 1m ago" at exactly 60 seconds', () => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      render(<LastUpdated dataUpdatedAt={now - 60_000} />);
      expect(screen.getByText('Updated 1m ago')).toBeDefined();
    });

    it('shows "Updated just now" at exactly 4 seconds', () => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      render(<LastUpdated dataUpdatedAt={now - 4000} />);
      expect(screen.getByText('Updated just now')).toBeDefined();
    });

    it('shows seconds at exactly 5 seconds', () => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      render(<LastUpdated dataUpdatedAt={now - 5000} />);
      expect(screen.getByText('Updated 5s ago')).toBeDefined();
    });
  });
});
