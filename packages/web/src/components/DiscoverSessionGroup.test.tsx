import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { DiscoveredSession } from '../lib/api';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('../lib/format-utils', () => ({
  formatNumber: (n: number) => String(n),
  shortenPath: (p: string | null | undefined) => p ?? '-',
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

vi.mock('./DiscoverSessionRow', () => ({
  DiscoverSessionRow: ({
    session,
    isFlat,
    onSelect,
  }: {
    session: DiscoveredSession;
    isFlat: boolean;
    onSelect: (id: string) => void;
  }) => (
    <div data-testid={`session-row-${session.sessionId}`} data-flat={String(isFlat)}>
      <button type="button" onClick={() => onSelect(session.sessionId)}>
        {session.summary}
      </button>
    </div>
  ),
}));

import type { SessionGroup } from './DiscoverSessionGroup';
import { DiscoverSessionGroup } from './DiscoverSessionGroup';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<DiscoveredSession> = {}): DiscoveredSession {
  return {
    sessionId: 'sess-1',
    projectPath: '/home/user/project',
    summary: 'Test session',
    messageCount: 10,
    lastActivity: '2026-03-07T12:00:00Z',
    branch: null,
    machineId: 'machine-1',
    hostname: 'mac-mini',
    ...overrides,
  };
}

function makeGroup(overrides: Partial<SessionGroup> = {}): SessionGroup {
  return {
    projectPath: '/home/user/project',
    projectName: 'project',
    sessions: [makeSession()],
    totalMessages: 10,
    latestActivity: '2026-03-07T12:00:00Z',
    ...overrides,
  };
}

function defaultProps(overrides: Partial<Parameters<typeof DiscoverSessionGroup>[0]> = {}) {
  return {
    group: makeGroup(),
    groupMode: 'project' as const,
    isCollapsed: false,
    onToggleGroup: vi.fn(),
    selectedSessionId: null,
    resumingSessionId: null,
    resumePrompt: '',
    onResumePromptChange: vi.fn(),
    importedSessionIds: new Set<string>(),
    selectedIds: new Set<string>(),
    importingSessionId: null,
    search: '',
    onSelectSession: vi.fn(),
    onToggleCheck: vi.fn(),
    onImport: vi.fn(),
    onStartResume: vi.fn(),
    onSubmitResume: vi.fn(),
    onCancelResume: vi.fn(),
    ...overrides,
  };
}

// ===========================================================================
// DiscoverSessionGroup
// ===========================================================================
describe('DiscoverSessionGroup', () => {
  // -------------------------------------------------------------------------
  // Group header rendering
  // -------------------------------------------------------------------------
  it('renders the group header with project name', () => {
    render(<DiscoverSessionGroup {...defaultProps()} />);
    expect(screen.getByText('project')).toBeDefined();
  });

  it('renders session count badge in header', () => {
    render(<DiscoverSessionGroup {...defaultProps()} />);
    expect(screen.getByText('1 session')).toBeDefined();
  });

  it('renders plural session count badge', () => {
    const group = makeGroup({
      sessions: [makeSession({ sessionId: 's1' }), makeSession({ sessionId: 's2' })],
    });
    render(<DiscoverSessionGroup {...defaultProps({ group })} />);
    expect(screen.getByText('2 sessions')).toBeDefined();
  });

  it('renders total message count in header', () => {
    render(<DiscoverSessionGroup {...defaultProps({ group: makeGroup({ totalMessages: 42 }) })} />);
    expect(screen.getByText('42 msgs')).toBeDefined();
  });

  it('renders LiveTimeAgo in header with latestActivity date', () => {
    render(<DiscoverSessionGroup {...defaultProps()} />);
    expect(screen.getByTestId('live-time-ago')).toBeDefined();
  });

  it('renders shortened path for project groupMode', () => {
    render(<DiscoverSessionGroup {...defaultProps({ groupMode: 'project' })} />);
    expect(screen.getByText('/home/user/project')).toBeDefined();
  });

  it('renders project count text for machine groupMode', () => {
    const group = makeGroup();
    render(<DiscoverSessionGroup {...defaultProps({ group, groupMode: 'machine' })} />);
    expect(screen.getByText('1 project(s)')).toBeDefined();
  });

  it('renders project count based on unique projectPaths for machine groupMode', () => {
    const group = makeGroup({
      sessions: [
        makeSession({ sessionId: 's1', projectPath: '/a' }),
        makeSession({ sessionId: 's2', projectPath: '/b' }),
        makeSession({ sessionId: 's3', projectPath: '/a' }),
      ],
    });
    render(<DiscoverSessionGroup {...defaultProps({ group, groupMode: 'machine' })} />);
    expect(screen.getByText('2 project(s)')).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Flat mode: no header
  // -------------------------------------------------------------------------
  it('does not render a group header in flat mode', () => {
    const group = makeGroup({ projectPath: '__flat__', projectName: 'Flat' });
    render(<DiscoverSessionGroup {...defaultProps({ group })} />);
    // The header button should not be present
    expect(screen.queryByRole('button', { name: /Flat/i })).toBeNull();
  });

  it('renders session rows in flat mode regardless of isCollapsed', () => {
    const group = makeGroup({
      projectPath: '__flat__',
      sessions: [makeSession({ sessionId: 's1' })],
    });
    render(<DiscoverSessionGroup {...defaultProps({ group, isCollapsed: true })} />);
    expect(screen.getByTestId('session-row-s1')).toBeDefined();
  });

  it('passes isFlat=true to session rows in flat mode', () => {
    const group = makeGroup({
      projectPath: '__flat__',
      sessions: [makeSession({ sessionId: 's1' })],
    });
    render(<DiscoverSessionGroup {...defaultProps({ group })} />);
    const row = screen.getByTestId('session-row-s1');
    expect(row.getAttribute('data-flat')).toBe('true');
  });

  // -------------------------------------------------------------------------
  // Collapse / expand
  // -------------------------------------------------------------------------
  it('renders session rows when not collapsed', () => {
    render(<DiscoverSessionGroup {...defaultProps({ isCollapsed: false })} />);
    expect(screen.getByTestId('session-row-sess-1')).toBeDefined();
  });

  it('does not render session rows when collapsed', () => {
    render(<DiscoverSessionGroup {...defaultProps({ isCollapsed: true })} />);
    expect(screen.queryByTestId('session-row-sess-1')).toBeNull();
  });

  it('calls onToggleGroup with projectPath when header is clicked', () => {
    const onToggleGroup = vi.fn();
    render(<DiscoverSessionGroup {...defaultProps({ onToggleGroup })} />);
    // The header is a button
    const headerBtn = screen.getByText('project').closest('button');
    expect(headerBtn).not.toBeNull();
    if (headerBtn) fireEvent.click(headerBtn);
    expect(onToggleGroup).toHaveBeenCalledWith('/home/user/project');
  });

  it('sets aria-expanded=true when not collapsed', () => {
    render(<DiscoverSessionGroup {...defaultProps({ isCollapsed: false })} />);
    const headerBtn = screen.getByText('project').closest('button');
    expect(headerBtn?.getAttribute('aria-expanded')).toBe('true');
  });

  it('sets aria-expanded=false when collapsed', () => {
    render(<DiscoverSessionGroup {...defaultProps({ isCollapsed: true })} />);
    const headerBtn = screen.getByText('project').closest('button');
    expect(headerBtn?.getAttribute('aria-expanded')).toBe('false');
  });

  // -------------------------------------------------------------------------
  // Session rows
  // -------------------------------------------------------------------------
  it('renders a row for each session in the group', () => {
    const group = makeGroup({
      sessions: [
        makeSession({ sessionId: 's1', summary: 'First' }),
        makeSession({ sessionId: 's2', summary: 'Second' }),
        makeSession({ sessionId: 's3', summary: 'Third' }),
      ],
    });
    render(<DiscoverSessionGroup {...defaultProps({ group })} />);
    expect(screen.getByTestId('session-row-s1')).toBeDefined();
    expect(screen.getByTestId('session-row-s2')).toBeDefined();
    expect(screen.getByTestId('session-row-s3')).toBeDefined();
  });

  it('passes isFlat=false to session rows in grouped mode', () => {
    render(<DiscoverSessionGroup {...defaultProps()} />);
    const row = screen.getByTestId('session-row-sess-1');
    expect(row.getAttribute('data-flat')).toBe('false');
  });

  // -------------------------------------------------------------------------
  // Arrow icon rotation
  // -------------------------------------------------------------------------
  it('shows a down arrow indicator in the header', () => {
    const { container } = render(
      <DiscoverSessionGroup {...defaultProps({ isCollapsed: false })} />,
    );
    // The arrow is a span with the unicode down arrow
    const arrows = container.querySelectorAll('span');
    const arrow = Array.from(arrows).find((s) => s.textContent === '\u25BC');
    expect(arrow).toBeDefined();
  });

  it('applies rotation class when collapsed', () => {
    const { container } = render(<DiscoverSessionGroup {...defaultProps({ isCollapsed: true })} />);
    const arrows = container.querySelectorAll('span');
    const arrow = Array.from(arrows).find((s) => s.textContent === '\u25BC');
    expect(arrow?.className).toContain('-rotate-90');
  });

  it('does not apply rotation class when expanded', () => {
    const { container } = render(
      <DiscoverSessionGroup {...defaultProps({ isCollapsed: false })} />,
    );
    const arrows = container.querySelectorAll('span');
    const arrow = Array.from(arrows).find((s) => s.textContent === '\u25BC');
    expect(arrow?.className).not.toContain('-rotate-90');
  });
});
