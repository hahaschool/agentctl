import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { DashboardActivityIcon } from './DashboardActivityIcon';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DashboardActivityIcon', () => {
  describe('color classes', () => {
    it('applies green for "running" status', () => {
      const { container } = render(<DashboardActivityIcon status="running" />);
      const span = container.querySelector('span');
      expect(span?.className).toContain('bg-green-500');
    });

    it('applies green for "active" status', () => {
      const { container } = render(<DashboardActivityIcon status="active" />);
      const span = container.querySelector('span');
      expect(span?.className).toContain('bg-green-500');
    });

    it('applies red for "error" status', () => {
      const { container } = render(<DashboardActivityIcon status="error" />);
      const span = container.querySelector('span');
      expect(span?.className).toContain('bg-red-500');
    });

    it('applies red for "timeout" status', () => {
      const { container } = render(<DashboardActivityIcon status="timeout" />);
      const span = container.querySelector('span');
      expect(span?.className).toContain('bg-red-500');
    });

    it('applies yellow for "starting" status', () => {
      const { container } = render(<DashboardActivityIcon status="starting" />);
      const span = container.querySelector('span');
      expect(span?.className).toContain('bg-yellow-500');
    });

    it('applies muted-foreground for unknown statuses', () => {
      const { container } = render(<DashboardActivityIcon status="idle" />);
      const span = container.querySelector('span');
      expect(span?.className).toContain('bg-muted-foreground');
    });

    it('applies muted-foreground for empty string status', () => {
      const { container } = render(<DashboardActivityIcon status="" />);
      const span = container.querySelector('span');
      expect(span?.className).toContain('bg-muted-foreground');
    });
  });

  describe('pulse animation', () => {
    it('applies animate-pulse for "running" status', () => {
      const { container } = render(<DashboardActivityIcon status="running" />);
      const span = container.querySelector('span');
      expect(span?.className).toContain('animate-pulse');
    });

    it('applies animate-pulse for "active" status', () => {
      const { container } = render(<DashboardActivityIcon status="active" />);
      const span = container.querySelector('span');
      expect(span?.className).toContain('animate-pulse');
    });

    it('does NOT apply animate-pulse for "error" status', () => {
      const { container } = render(<DashboardActivityIcon status="error" />);
      const span = container.querySelector('span');
      expect(span?.className).not.toContain('animate-pulse');
    });

    it('does NOT apply animate-pulse for "starting" status', () => {
      const { container } = render(<DashboardActivityIcon status="starting" />);
      const span = container.querySelector('span');
      expect(span?.className).not.toContain('animate-pulse');
    });

    it('does NOT apply animate-pulse for "timeout" status', () => {
      const { container } = render(<DashboardActivityIcon status="timeout" />);
      const span = container.querySelector('span');
      expect(span?.className).not.toContain('animate-pulse');
    });

    it('does NOT apply animate-pulse for unknown status', () => {
      const { container } = render(<DashboardActivityIcon status="stopped" />);
      const span = container.querySelector('span');
      expect(span?.className).not.toContain('animate-pulse');
    });
  });

  describe('base classes', () => {
    it('always includes base shape classes', () => {
      const { container } = render(<DashboardActivityIcon status="running" />);
      const span = container.querySelector('span');
      expect(span?.className).toContain('w-2');
      expect(span?.className).toContain('h-2');
      expect(span?.className).toContain('rounded-full');
    });
  });
});
