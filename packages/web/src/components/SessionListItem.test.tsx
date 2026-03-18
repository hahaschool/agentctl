import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — BEFORE component import
// ---------------------------------------------------------------------------

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('../lib/format-utils', () => ({
  formatDuration: (start: string, end?: string | null) => {
    if (start === 'instant') return '0s';
    if (!end) return '5m 30s';
    return '10m 0s';
  },
  formatCost: (value: number | null | undefined) => {
    if (value == null) return '$0.00';
    return `$${value.toFixed(2)}`;
  },
}));

vi.mock('./CopyableText', () => ({
  CopyableText: ({
    value,
    maxDisplay,
    className,
  }: {
    value: string;
    maxDisplay?: number;
    className?: string;
  }) => (
    <span data-testid="copyable-text" className={className}>
      {maxDisplay ? value.slice(0, maxDisplay) : value}
    </span>
  ),
}));

vi.mock('./LiveTimeAgo', () => ({
  LiveTimeAgo: ({ date }: { date: string }) => <span data-testid="live-time-ago">{date}</span>,
}));

vi.mock('./PathBadge', () => ({
  PathBadge: ({ path, className }: { path: string; className?: string }) => (
    <span data-testid="path-badge" className={className}>
      {path}
    </span>
  ),
}));

vi.mock('./StatusBadge', () => ({
  StatusBadge: ({ status }: { status: string }) => <span data-testid="status-badge">{status}</span>,
}));

// ---------------------------------------------------------------------------
// Component import (AFTER mocks)
// ---------------------------------------------------------------------------

import type { Session } from '../lib/api';
import { SessionListItem, type SessionListItemProps } from './SessionListItem';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-0123456789abcdef01234567',
    agentId: 'agent-abc12345',
    agentName: 'my-agent',
    machineId: 'machine-1',
    sessionUrl: null,
    claudeSessionId: 'claude-session-1',
    status: 'active',
    projectPath: '/home/user/project',
    pid: 1234,
    startedAt: '2026-03-07T00:00:00Z',
    lastHeartbeat: null,
    endedAt: null,
    metadata: {},
    accountId: null,
    model: 'claude-sonnet-4-6',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderItem(overrides: Partial<SessionListItemProps> = {}) {
  const defaults: SessionListItemProps = {
    session: makeSession(),
    isSelected: false,
    isFocused: false,
    onSelect: vi.fn(),
    isChecked: false,
    onToggleCheck: vi.fn(),
  };
  const props = { ...defaults, ...overrides };
  const result = render(<SessionListItem {...props} />);
  return { ...result, props };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ===========================================================================
// Tests
// ===========================================================================

describe('SessionListItem', () => {
  // -----------------------------------------------------------------------
  // Basic rendering
  // -----------------------------------------------------------------------

  describe('basic rendering', () => {
    it('renders the session id via CopyableText', () => {
      renderItem();
      const copyable = screen.getByTestId('copyable-text');
      // CopyableText maxDisplay=16 → slice(0,16) = 'sess-0123456789a'
      expect(copyable.textContent).toBe('sess-0123456789a');
    });

    it('renders agent name when present', () => {
      renderItem({ session: makeSession({ agentName: 'my-agent' }) });
      expect(screen.getByText('my-agent')).toBeDefined();
    });

    it('renders truncated agentId when agentName is null', () => {
      renderItem({ session: makeSession({ agentName: null, agentId: 'agent-abc12345' }) });
      expect(screen.getByText('agent-abc12345')).toBeDefined();
    });

    it('renders machineId', () => {
      renderItem({ session: makeSession({ machineId: 'machine-xyz' }) });
      expect(screen.getByText('machine-xyz')).toBeDefined();
    });

    it('renders the status badge with correct status', () => {
      renderItem({ session: makeSession({ status: 'active' }) });
      const badge = screen.getByTestId('status-badge');
      expect(badge.textContent).toBe('active');
    });

    it('renders role="option" with session id', () => {
      const { container } = renderItem();
      const option = container.querySelector('[role="option"]');
      expect(option).not.toBeNull();
      expect(option?.id).toBe('session-sess-0123456789abcdef01234567');
    });
  });

  // -----------------------------------------------------------------------
  // Status-specific indicators
  // -----------------------------------------------------------------------

  describe('status indicators', () => {
    it('does not render legacy inline status dots for active sessions', () => {
      const { container } = renderItem({ session: makeSession({ status: 'active' }) });
      expect(container.querySelector('.animate-ping')).toBeNull();
      expect(container.querySelector('.animate-pulse')).toBeNull();
    });

    it('does not render legacy inline status dots for starting sessions', () => {
      const { container } = renderItem({ session: makeSession({ status: 'starting' }) });
      expect(container.querySelector('.animate-ping')).toBeNull();
      expect(container.querySelector('.animate-pulse')).toBeNull();
    });

    it('does not show ping or pulse dot for ended sessions', () => {
      const { container } = renderItem({ session: makeSession({ status: 'ended' }) });
      expect(container.querySelector('.animate-ping')).toBeNull();
      expect(container.querySelector('.animate-pulse')).toBeNull();
    });

    it('does not show ping or pulse dot for error sessions', () => {
      const { container } = renderItem({ session: makeSession({ status: 'error' }) });
      expect(container.querySelector('.animate-ping')).toBeNull();
      expect(container.querySelector('.animate-pulse')).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Selected state
  // -----------------------------------------------------------------------

  describe('selected state', () => {
    it('applies selected styling when isSelected=true', () => {
      const { container } = renderItem({ isSelected: true });
      const option = container.querySelector('[role="option"]');
      expect(option?.className).toContain('bg-accent/15');
    });

    it('sets aria-selected=true when selected', () => {
      const { container } = renderItem({ isSelected: true });
      const option = container.querySelector('[role="option"]');
      expect(option?.getAttribute('aria-selected')).toBe('true');
    });

    it('sets aria-selected=false when not selected', () => {
      const { container } = renderItem({ isSelected: false });
      const option = container.querySelector('[role="option"]');
      expect(option?.getAttribute('aria-selected')).toBe('false');
    });
  });

  // -----------------------------------------------------------------------
  // Focused state
  // -----------------------------------------------------------------------

  describe('focused state', () => {
    it('applies focused styling when isFocused=true and not selected', () => {
      const { container } = renderItem({ isFocused: true, isSelected: false });
      const option = container.querySelector('[role="option"]');
      expect(option?.className).toContain('bg-accent/10');
      expect(option?.className).toContain('ring-1');
    });

    it('sets tabIndex=0 when focused', () => {
      const { container } = renderItem({ isFocused: true });
      const option = container.querySelector('[role="option"]');
      expect(option?.getAttribute('tabindex')).toBe('0');
    });

    it('sets tabIndex=-1 when not focused', () => {
      const { container } = renderItem({ isFocused: false });
      const option = container.querySelector('[role="option"]');
      expect(option?.getAttribute('tabindex')).toBe('-1');
    });
  });

  // -----------------------------------------------------------------------
  // Checkbox behavior
  // -----------------------------------------------------------------------

  describe('checkbox behavior', () => {
    it('renders a checkbox', () => {
      renderItem();
      const checkbox = screen.getByRole('checkbox');
      expect(checkbox).toBeDefined();
    });

    it('checkbox is checked when isChecked=true', () => {
      renderItem({ isChecked: true });
      const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
    });

    it('checkbox is unchecked when isChecked=false', () => {
      renderItem({ isChecked: false });
      const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
    });

    it('calls onToggleCheck with session id on checkbox change', () => {
      const onToggleCheck = vi.fn();
      const onSelect = vi.fn();
      renderItem({ onToggleCheck, onSelect });
      const checkbox = screen.getByRole('checkbox');
      // fireEvent.click on a checkbox triggers the onChange handler
      fireEvent.click(checkbox);
      expect(onToggleCheck).toHaveBeenCalledTimes(1);
      expect(onToggleCheck).toHaveBeenCalledWith('sess-0123456789abcdef01234567');
    });

    it('checkbox click does not propagate to parent button', () => {
      const onSelect = vi.fn();
      renderItem({ onSelect });
      const checkbox = screen.getByRole('checkbox');
      fireEvent.click(checkbox);
      // onSelect should NOT be called from checkbox click
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('checkbox has accessible label with truncated session id', () => {
      renderItem();
      // aria-label uses s.id.slice(0,16) = 'sess-0123456789a'
      const checkbox = screen.getByLabelText('Select session sess-0123456789a');
      expect(checkbox).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Click handler (onSelect)
  // -----------------------------------------------------------------------

  describe('onSelect handler', () => {
    it('calls onSelect with session id when card body is clicked', () => {
      const onSelect = vi.fn();
      renderItem({ onSelect });
      const button = screen.getByRole('button');
      fireEvent.click(button);
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith('sess-0123456789abcdef01234567');
    });
  });

  // -----------------------------------------------------------------------
  // Duration display
  // -----------------------------------------------------------------------

  describe('duration display', () => {
    it('shows "Running for ..." for active sessions (no endedAt)', () => {
      renderItem({
        session: makeSession({ status: 'active', endedAt: null }),
      });
      expect(screen.getByText('Running for 5m 30s')).toBeDefined();
    });

    it('shows "Duration: ..." for ended sessions (with endedAt)', () => {
      renderItem({
        session: makeSession({
          status: 'ended',
          endedAt: '2026-03-07T00:10:00Z',
        }),
      });
      expect(screen.getByText('Duration: 10m 0s')).toBeDefined();
    });

    it('shows title "Running" for active sessions', () => {
      const { container } = renderItem({
        session: makeSession({ status: 'active', endedAt: null }),
      });
      const durationSpan = container.querySelector('[title="Running"]');
      expect(durationSpan).not.toBeNull();
    });

    it('shows title "Total duration" for ended sessions', () => {
      const { container } = renderItem({
        session: makeSession({
          status: 'ended',
          endedAt: '2026-03-07T00:10:00Z',
        }),
      });
      const durationSpan = container.querySelector('[title="Total duration"]');
      expect(durationSpan).not.toBeNull();
    });

    it('shows "Running now" when duration is instant', () => {
      renderItem({
        session: makeSession({ startedAt: 'instant', endedAt: null }),
      });
      expect(screen.getByText('Running now')).toBeDefined();
    });

    it('shows "Duration: instant" for ended instant sessions', () => {
      renderItem({
        session: makeSession({ startedAt: 'instant', endedAt: '2026-03-07T00:10:00Z' }),
      });
      expect(screen.getByText('Duration: instant')).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Cost display
  // -----------------------------------------------------------------------

  describe('cost display', () => {
    it('shows cost when costUsd is in metadata', () => {
      renderItem({
        session: makeSession({ metadata: { costUsd: 1.5 } }),
      });
      expect(screen.getByText('$1.50')).toBeDefined();
    });

    it('does not show cost when costUsd is undefined', () => {
      renderItem({ session: makeSession({ metadata: {} }) });
      expect(screen.queryByText(/\$/)).toBeNull();
    });

    it('shows $0.00 when costUsd is 0', () => {
      renderItem({
        session: makeSession({ metadata: { costUsd: 0 } }),
      });
      expect(screen.getByText('$0.00')).toBeDefined();
    });

    it('formats cost with tabular-nums class', () => {
      renderItem({
        session: makeSession({ metadata: { costUsd: 2.34 } }),
      });
      const costEl = screen.getByText('$2.34');
      expect(costEl.className).toContain('tabular-nums');
    });
  });

  // -----------------------------------------------------------------------
  // Model badge
  // -----------------------------------------------------------------------

  describe('model badge', () => {
    it('shows cleaned model name when model is set', () => {
      renderItem({ session: makeSession({ model: 'claude-sonnet-4-6' }) });
      expect(screen.getByText('sonnet-4-6')).toBeDefined();
    });

    it('removes date suffix from model name', () => {
      renderItem({ session: makeSession({ model: 'claude-opus-4-6-20260301' }) });
      expect(screen.getByText('opus-4-6')).toBeDefined();
    });

    it('shows "default" when model is null', () => {
      renderItem({ session: makeSession({ model: null }) });
      expect(screen.getByText('default')).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Error indicator
  // -----------------------------------------------------------------------

  describe('error indicator', () => {
    it('shows error message for error sessions with errorMessage metadata', () => {
      renderItem({
        session: makeSession({
          status: 'error',
          metadata: { errorMessage: 'Process crashed unexpectedly' },
        }),
      });
      expect(screen.getByText('Process crashed unexpectedly')).toBeDefined();
    });

    it('does not show error message for non-error sessions even with errorMessage', () => {
      renderItem({
        session: makeSession({
          status: 'active',
          metadata: { errorMessage: 'some error' },
        }),
      });
      expect(screen.queryByText('some error')).toBeNull();
    });

    it('does not show error section when status is error but no errorMessage', () => {
      renderItem({
        session: makeSession({
          status: 'error',
          metadata: {},
        }),
      });
      // There should be no red text div for the error message
      const { container } = render(
        <SessionListItem
          session={makeSession({ status: 'error', metadata: {} })}
          isSelected={false}
          isFocused={false}
          onSelect={vi.fn()}
          isChecked={false}
          onToggleCheck={vi.fn()}
        />,
      );
      const errorDiv = container.querySelector('.text-red-600');
      expect(errorDiv).toBeNull();
    });

    it('applies red left border for error status', () => {
      const { container } = renderItem({
        session: makeSession({ status: 'error' }),
      });
      const option = container.querySelector('[role="option"]');
      expect(option?.className).toContain('border-l-red-500');
    });

    it('applies yellow left border for starting status', () => {
      const { container } = renderItem({
        session: makeSession({ status: 'starting' }),
      });
      const option = container.querySelector('[role="option"]');
      expect(option?.className).toContain('border-l-yellow-500');
    });

    it('applies green left border for active status', () => {
      const { container } = renderItem({
        session: makeSession({ status: 'active' }),
      });
      const option = container.querySelector('[role="option"]');
      expect(option?.className).toContain('border-l-green-500');
    });

    it('applies transparent left border for other statuses', () => {
      const { container } = renderItem({
        session: makeSession({ status: 'ended' }),
      });
      const option = container.querySelector('[role="option"]');
      expect(option?.className).toContain('border-l-transparent');
    });

    it('shows empty badge and muted style for empty failed sessions', () => {
      const { container } = renderItem({
        session: makeSession({
          status: 'error',
          claudeSessionId: null,
          endedAt: '2026-03-07T00:00:00Z',
          metadata: { costUsd: 0, messageCount: 0 },
        }),
      });
      expect(screen.getByText('empty')).toBeDefined();
      const option = container.querySelector('[role="option"]');
      expect(option?.className).toContain('border-l-muted-foreground/35');
      expect(option?.className).toContain('opacity-70');
    });
  });

  // -----------------------------------------------------------------------
  // Message count display
  // -----------------------------------------------------------------------

  describe('message count display', () => {
    it('shows message count when messageCount is in metadata', () => {
      renderItem({
        session: makeSession({ metadata: { messageCount: 42 } }),
      });
      expect(screen.getByText('42 msgs')).toBeDefined();
    });

    it('does not show message count when messageCount is undefined', () => {
      renderItem({ session: makeSession({ metadata: {} }) });
      expect(screen.queryByText(/msgs/)).toBeNull();
    });

    it('shows 0 msgs when messageCount is 0', () => {
      renderItem({
        session: makeSession({ metadata: { messageCount: 0 } }),
      });
      expect(screen.getByText('0 msgs')).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Project path display
  // -----------------------------------------------------------------------

  describe('project path display', () => {
    it('renders PathBadge when projectPath is set', () => {
      renderItem({ session: makeSession({ projectPath: '/home/user/myproject' }) });
      const pathBadge = screen.getByTestId('path-badge');
      expect(pathBadge.textContent).toBe('/home/user/myproject');
    });

    it('does not render PathBadge when projectPath is null', () => {
      renderItem({ session: makeSession({ projectPath: null }) });
      expect(screen.queryByTestId('path-badge')).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // LiveTimeAgo integration
  // -----------------------------------------------------------------------

  describe('time ago display', () => {
    it('renders LiveTimeAgo with startedAt date', () => {
      renderItem({ session: makeSession({ startedAt: '2026-03-07T12:00:00Z' }) });
      const timeAgo = screen.getByTestId('live-time-ago');
      expect(timeAgo.textContent).toBe('2026-03-07T12:00:00Z');
    });
  });

  // -----------------------------------------------------------------------
  // Combined metadata display
  // -----------------------------------------------------------------------

  describe('combined metadata', () => {
    it('renders all metadata fields together', () => {
      renderItem({
        session: makeSession({
          metadata: {
            messageCount: 15,
            costUsd: 3.45,
          },
        }),
      });
      expect(screen.getByText('15 msgs')).toBeDefined();
      expect(screen.getByText('$3.45')).toBeDefined();
    });
  });
});
