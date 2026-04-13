import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { AgentRun } from '@/lib/api';

import { GroupedRunHistory } from './GroupedRunHistory';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/components/LiveTimeAgo', () => ({
  LiveTimeAgo: ({ date }: { date: string }) => <span>{date}</span>,
}));

function makeRun(overrides: Partial<AgentRun>): AgentRun {
  return {
    id: 'run-1',
    agentId: 'agent-1',
    trigger: 'manual',
    status: 'running',
    startedAt: '2026-03-18T12:00:00.000Z',
    ...overrides,
  };
}

describe('GroupedRunHistory phase indicators', () => {
  it('animates active phases and omits phase indicator for terminal status', () => {
    render(
      <GroupedRunHistory
        runs={[
          makeRun({ id: 'run-active', status: 'running', phase: 'dispatching' }),
          makeRun({ id: 'run-final', status: 'success', phase: 'completed' }),
        ]}
      />,
    );

    const activeIndicators = document.querySelectorAll('[data-phase-indicator="dispatching"]');
    expect(activeIndicators.length).toBeGreaterThan(0);
    for (const indicator of activeIndicators) {
      expect(indicator.firstElementChild?.className).toContain('animate-pulse');
    }

    // Terminal statuses (success) hide the phase indicator entirely — the status badge carries the story
    const finalIndicators = document.querySelectorAll('[data-phase-indicator="completed"]');
    expect(finalIndicators.length).toBe(0);
  });

  it('shows status-based labels for terminal runs (status badge replaces phase)', () => {
    render(
      <GroupedRunHistory
        runs={[
          makeRun({ id: 'run-success', status: 'success', phase: null }),
          makeRun({ id: 'run-failure', status: 'failure', phase: null }),
          makeRun({ id: 'run-empty', status: 'empty', phase: null }),
        ]}
      />,
    );

    expect(screen.getAllByText('Success').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Failure').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Empty').length).toBeGreaterThan(0);
  });

  it('anchors retry groups on latest attempt and shows attempt labels', () => {
    render(
      <GroupedRunHistory
        runs={[
          makeRun({
            id: 'run-original',
            status: 'failure',
            phase: 'failed',
            startedAt: '2026-03-18T12:00:00.000Z',
            retryOf: null,
            retryIndex: null,
          }),
          makeRun({
            id: 'run-retry-1',
            status: 'failure',
            phase: 'failed',
            startedAt: '2026-03-18T12:05:00.000Z',
            retryOf: 'run-original',
            retryIndex: 1,
          }),
          makeRun({
            id: 'run-retry-2',
            status: 'success',
            phase: 'completed',
            startedAt: '2026-03-18T12:10:00.000Z',
            retryOf: 'run-original',
            retryIndex: 2,
          }),
        ]}
      />,
    );

    // Lead run is now the latest attempt (run-retry-2); previous runs are collapsed behind a toggle
    expect(document.querySelectorAll('[data-run-id="run-retry-2"]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-run-id="run-original"]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-run-id="run-retry-1"]')).toHaveLength(0);
    expect(screen.getAllByText('Attempt 3/3').length).toBeGreaterThan(0);

    const toggle = screen.getAllByRole('button', { name: /2 retries/i })[0];
    fireEvent.click(toggle);

    expect(document.querySelectorAll('[data-run-id="run-original"]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-run-id="run-retry-1"]').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Attempt 1/3').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Attempt 2/3').length).toBeGreaterThan(0);
  });
});
