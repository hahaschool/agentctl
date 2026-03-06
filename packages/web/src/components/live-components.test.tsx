import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LiveDuration } from './LiveDuration';
import { LiveTimeAgo } from './LiveTimeAgo';

describe('LiveDuration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders static duration from startedAt to endedAt', () => {
    render(<LiveDuration startedAt="2026-03-06T10:00:00Z" endedAt="2026-03-06T10:05:30Z" />);
    expect(screen.getByText('5m 30s')).toBeDefined();
  });

  it('renders "0s" for a just-started session with no endedAt', () => {
    vi.setSystemTime(new Date('2026-03-06T10:00:00Z'));
    render(<LiveDuration startedAt="2026-03-06T10:00:00Z" />);
    expect(screen.getByText('0s')).toBeDefined();
  });

  it('live-updates duration when endedAt is null', () => {
    vi.setSystemTime(new Date('2026-03-06T10:00:00Z'));
    render(<LiveDuration startedAt="2026-03-06T10:00:00Z" endedAt={null} />);
    expect(screen.getByText('0s')).toBeDefined();

    // Advance 65 seconds
    act(() => {
      vi.advanceTimersByTime(65_000);
    });
    expect(screen.getByText('1m 5s')).toBeDefined();
  });

  it('stops ticking when endedAt is provided', () => {
    vi.setSystemTime(new Date('2026-03-06T10:00:00Z'));
    render(<LiveDuration startedAt="2026-03-06T10:00:00Z" endedAt="2026-03-06T10:02:00Z" />);
    expect(screen.getByText('2m 0s')).toBeDefined();

    // Advancing time should not change the displayed text
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText('2m 0s')).toBeDefined();
  });

  it('renders hours for long durations', () => {
    render(<LiveDuration startedAt="2026-03-06T10:00:00Z" endedAt="2026-03-06T12:30:00Z" />);
    expect(screen.getByText('2h 30m')).toBeDefined();
  });

  it('applies custom className', () => {
    const { container } = render(
      <LiveDuration
        startedAt="2026-03-06T10:00:00Z"
        endedAt="2026-03-06T10:01:00Z"
        className="text-red-500"
      />,
    );
    const span = container.querySelector('span');
    expect(span?.className).toContain('text-red-500');
  });
});

describe('LiveTimeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders "just now" for a very recent date', () => {
    vi.setSystemTime(new Date('2026-03-06T10:00:30Z'));
    render(<LiveTimeAgo date="2026-03-06T10:00:00Z" />);
    expect(screen.getByText('just now')).toBeDefined();
  });

  it('renders minutes ago', () => {
    vi.setSystemTime(new Date('2026-03-06T10:05:00Z'));
    render(<LiveTimeAgo date="2026-03-06T10:00:00Z" />);
    expect(screen.getByText('5m ago')).toBeDefined();
  });

  it('renders hours ago', () => {
    vi.setSystemTime(new Date('2026-03-06T13:00:00Z'));
    render(<LiveTimeAgo date="2026-03-06T10:00:00Z" />);
    expect(screen.getByText('3h ago')).toBeDefined();
  });

  it('renders days ago', () => {
    vi.setSystemTime(new Date('2026-03-09T10:00:00Z'));
    render(<LiveTimeAgo date="2026-03-06T10:00:00Z" />);
    expect(screen.getByText('3d ago')).toBeDefined();
  });

  it('auto-updates on interval tick', () => {
    vi.setSystemTime(new Date('2026-03-06T10:00:30Z'));
    render(<LiveTimeAgo date="2026-03-06T10:00:00Z" interval={1_000} />);
    expect(screen.getByText('just now')).toBeDefined();

    // Advance past the 1-minute threshold
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('1m ago')).toBeDefined();
  });

  it('renders fallback when date is empty', () => {
    render(<LiveTimeAgo date="" fallback="N/A" />);
    expect(screen.getByText('N/A')).toBeDefined();
  });

  it('renders empty string fallback by default when date is empty', () => {
    const { container } = render(<LiveTimeAgo date="" />);
    const span = container.querySelector('span');
    expect(span?.textContent).toBe('');
  });

  it('applies custom className', () => {
    vi.setSystemTime(new Date('2026-03-06T10:05:00Z'));
    const { container } = render(
      <LiveTimeAgo date="2026-03-06T10:00:00Z" className="text-muted" />,
    );
    const span = container.querySelector('span');
    expect(span?.className).toContain('text-muted');
  });

  it('sets title attribute with formatted date', () => {
    vi.setSystemTime(new Date('2026-03-06T10:05:00Z'));
    render(<LiveTimeAgo date="2026-03-06T10:00:00Z" />);
    const span = screen.getByText('5m ago');
    expect(span.getAttribute('title')).toBeDefined();
    expect(span.getAttribute('title')!.length).toBeGreaterThan(0);
  });

  it('handles future dates gracefully (shows "just now")', () => {
    vi.setSystemTime(new Date('2026-03-06T10:00:00Z'));
    render(<LiveTimeAgo date="2026-03-06T10:05:00Z" />);
    // timeAgo does Date.now() - date, which is negative → mins < 1 → "just now"
    expect(screen.getByText('just now')).toBeDefined();
  });
});
