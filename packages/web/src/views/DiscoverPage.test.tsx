import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DiscoveredSession } from '@/lib/api';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockDiscoverQuery,
  mockSessionsQuery,
  mockCreateSession,
  mockToastSuccess,
  mockToastError,
} = vi.hoisted(() => ({
  mockDiscoverQuery: vi.fn(),
  mockSessionsQuery: vi.fn(),
  mockCreateSession: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock dependencies — BEFORE component import
// ---------------------------------------------------------------------------

vi.mock('@/hooks/use-hotkeys', () => ({
  useHotkeys: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href} data-testid={`link-${href}`}>
      {children}
    </a>
  ),
}));

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className }: { className: string }) => (
    <div className={className} data-testid="skeleton" />
  ),
}));

vi.mock('@/components/ErrorBanner', () => ({
  ErrorBanner: ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
    <div data-testid="error-banner">
      {message}
      {onRetry && (
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  ),
}));

vi.mock('@/components/FetchingBar', () => ({
  FetchingBar: ({ isFetching }: { isFetching: boolean }) => (
    <div data-testid="fetching-bar">{isFetching ? 'fetching' : 'idle'}</div>
  ),
}));

vi.mock('@/components/LastUpdated', () => ({
  LastUpdated: ({ dataUpdatedAt }: { dataUpdatedAt: number }) => (
    <div data-testid="last-updated">{dataUpdatedAt}</div>
  ),
}));

vi.mock('@/components/LiveTimeAgo', () => ({
  LiveTimeAgo: ({ date }: { date: string }) => <span data-testid="time-ago">{date}</span>,
}));

vi.mock('@/components/PathBadge', () => ({
  PathBadge: ({ path }: { path: string }) => <span data-testid="path-badge">{path}</span>,
}));

vi.mock('@/components/RefreshButton', () => ({
  RefreshButton: ({ onClick, isFetching }: { onClick: () => void; isFetching: boolean }) => (
    <button type="button" data-testid="refresh-button" disabled={isFetching} onClick={onClick}>
      Refresh
    </button>
  ),
}));

vi.mock('@/components/SimpleTooltip', () => ({
  SimpleTooltip: ({ content, children }: { content: string; children: React.ReactNode }) => (
    <div data-testid="tooltip" title={content}>
      {children}
    </div>
  ),
}));

vi.mock('@/components/EmptyState', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string; icon?: unknown }) => (
    <div data-testid="empty-state">
      <div>{title}</div>
      {description && <div>{description}</div>}
    </div>
  ),
}));

vi.mock('@/components/CopyableText', () => ({
  CopyableText: ({ value }: { value: string }) => (
    <span data-testid="copyable-text">{value.slice(0, 8)}</span>
  ),
}));

vi.mock('@/components/HighlightText', () => ({
  HighlightText: ({ text }: { text: string; highlight: string }) => <span>{text}</span>,
}));

vi.mock('@/components/SessionPreview', () => ({
  SessionPreview: ({
    sessionId,
    onClose,
  }: {
    sessionId: string;
    machineId: string;
    projectPath: string;
    onClose: () => void;
  }) => (
    <div data-testid="session-preview">
      <span>{sessionId}</span>
      <button type="button" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({
    success: mockToastSuccess,
    error: mockToastError,
  }),
}));

vi.mock('@/lib/queries', () => ({
  discoverQuery: () => mockDiscoverQuery(),
  sessionsQuery: () => mockSessionsQuery(),
  queryKeys: {
    sessions: () => ['sessions'],
    discover: ['discovered-sessions'],
  },
}));

vi.mock('@/lib/api', () => ({
  api: {
    createSession: mockCreateSession,
  },
}));

// ---------------------------------------------------------------------------
// Component import (AFTER mocks)
// ---------------------------------------------------------------------------

import { DiscoverPage } from './DiscoverPage';

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function createDiscoveredSession(overrides?: Partial<DiscoveredSession>): DiscoveredSession {
  return {
    sessionId: 'discovered-1',
    projectPath: '/Users/test/my-project',
    summary: 'Working on authentication',
    messageCount: 42,
    lastActivity: new Date().toISOString(),
    branch: 'feature/auth',
    machineId: 'machine-1',
    hostname: 'mac-mini',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderDiscover() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <DiscoverPage />
    </QueryClientProvider>,
  );
}

function setupDefaultMocks(
  sessions: DiscoveredSession[] = [createDiscoveredSession()],
  machinesQueried = 1,
  machinesFailed = 0,
) {
  mockDiscoverQuery.mockReturnValue({
    queryKey: ['discovered-sessions'],
    queryFn: vi.fn().mockResolvedValue({
      count: sessions.length,
      machinesQueried,
      machinesFailed,
      sessions,
    }),
  });

  mockSessionsQuery.mockReturnValue({
    queryKey: ['sessions'],
    queryFn: vi.fn().mockResolvedValue({
      sessions: [],
      total: 0,
      limit: 1000,
      offset: 0,
      hasMore: false,
    }),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DiscoverPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Page heading and description
  // =========================================================================

  it('renders page heading "Discover Sessions"', async () => {
    renderDiscover();
    await waitFor(() => {
      expect(screen.getByText('Discover Sessions')).toBeDefined();
    });
  });

  it('renders page description', async () => {
    renderDiscover();
    await waitFor(() => {
      expect(
        screen.getByText(/Browse Claude Code sessions across all fleet machines/),
      ).toBeDefined();
    });
  });

  it('shows machines queried count in description', async () => {
    setupDefaultMocks([createDiscoveredSession()], 3, 0);
    renderDiscover();
    await waitFor(() => {
      expect(screen.getByText(/Queried 3 machine/)).toBeDefined();
    });
  });

  it('shows machines failed count in description when > 0', async () => {
    setupDefaultMocks([createDiscoveredSession()], 3, 1);
    renderDiscover();
    await waitFor(() => {
      expect(screen.getByText(/1 failed/)).toBeDefined();
    });
  });

  // =========================================================================
  // 2. Loading skeleton state
  // =========================================================================

  it('shows loading skeletons when query is loading', async () => {
    mockDiscoverQuery.mockReturnValue({
      queryKey: ['discovered-sessions'],
      queryFn: vi.fn().mockReturnValue(new Promise(() => {})),
    });
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({
        sessions: [],
        total: 0,
        limit: 1000,
        offset: 0,
        hasMore: false,
      }),
    });

    renderDiscover();
    await waitFor(() => {
      const skeletons = screen.getAllByTestId('skeleton');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 3. Renders discovered session cards when data loads
  // =========================================================================

  it('renders session summary text', async () => {
    setupDefaultMocks([createDiscoveredSession({ summary: 'Fix login bug' })]);
    renderDiscover();
    await waitFor(() => {
      expect(screen.getByText('Fix login bug')).toBeDefined();
    });
  });

  it('renders session message count', async () => {
    setupDefaultMocks([createDiscoveredSession({ messageCount: 99 })]);
    renderDiscover();
    await waitFor(() => {
      const matches = screen.getAllByText('99 msgs');
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  it('renders session hostname', async () => {
    setupDefaultMocks([createDiscoveredSession({ hostname: 'ec2-prod' })]);
    renderDiscover();
    await waitFor(() => {
      expect(screen.getByText('ec2-prod')).toBeDefined();
    });
  });

  it('renders session branch badge', async () => {
    setupDefaultMocks([createDiscoveredSession({ branch: 'feat/new-ui' })]);
    renderDiscover();
    await waitFor(() => {
      expect(screen.getByText('feat/new-ui')).toBeDefined();
    });
  });

  it('shows "Untitled" for sessions with empty summary', async () => {
    setupDefaultMocks([createDiscoveredSession({ summary: '' })]);
    renderDiscover();
    await waitFor(() => {
      expect(screen.getByText('Untitled')).toBeDefined();
    });
  });

  it('renders multiple sessions', async () => {
    setupDefaultMocks([
      createDiscoveredSession({ sessionId: 's1', summary: 'Session Alpha' }),
      createDiscoveredSession({ sessionId: 's2', summary: 'Session Beta' }),
      createDiscoveredSession({ sessionId: 's3', summary: 'Session Gamma' }),
    ]);
    renderDiscover();
    await waitFor(() => {
      expect(screen.getByText('Session Alpha')).toBeDefined();
      expect(screen.getByText('Session Beta')).toBeDefined();
      expect(screen.getByText('Session Gamma')).toBeDefined();
    });
  });

  it('shows stats line with session and project counts', async () => {
    setupDefaultMocks([
      createDiscoveredSession({
        sessionId: 's1',
        projectPath: '/project-a',
        hostname: 'host-1',
      }),
      createDiscoveredSession({
        sessionId: 's2',
        projectPath: '/project-b',
        hostname: 'host-2',
      }),
    ]);
    renderDiscover();
    await waitFor(() => {
      expect(screen.getByText(/Showing 2 of 2 sessions/)).toBeDefined();
      expect(screen.getByText(/2 projects/)).toBeDefined();
      expect(screen.getByText(/2 machines/)).toBeDefined();
    });
  });

  // =========================================================================
  // 4. Filter controls (min messages, sort options)
  // =========================================================================

  it('renders min messages filter dropdown', () => {
    renderDiscover();
    const minMsgsSelect = screen.getByLabelText('Minimum message count') as HTMLSelectElement;
    expect(minMsgsSelect).toBeDefined();
    // Default is 1
    expect(minMsgsSelect.value).toBe('1');
  });

  it('changes min messages filter', async () => {
    setupDefaultMocks([
      createDiscoveredSession({ sessionId: 's1', messageCount: 3 }),
      createDiscoveredSession({ sessionId: 's2', messageCount: 12 }),
    ]);
    renderDiscover();
    await waitFor(() => {
      expect(screen.getByText(/Showing 2 of 2/)).toBeDefined();
    });

    const minMsgsSelect = screen.getByLabelText('Minimum message count') as HTMLSelectElement;
    fireEvent.change(minMsgsSelect, { target: { value: '10' } });

    await waitFor(() => {
      expect(screen.getByText(/Showing 1 of 2/)).toBeDefined();
    });
  });

  it('renders sort dropdown', () => {
    renderDiscover();
    const sortSelect = screen.getByLabelText('Sort order') as HTMLSelectElement;
    expect(sortSelect).toBeDefined();
    expect(sortSelect.value).toBe('recent');
  });

  it('changes sort order', () => {
    renderDiscover();
    const sortSelect = screen.getByLabelText('Sort order') as HTMLSelectElement;
    fireEvent.change(sortSelect, { target: { value: 'messages' } });
    expect(sortSelect.value).toBe('messages');
  });

  // =========================================================================
  // 5. Search functionality
  // =========================================================================

  it('renders search input', () => {
    renderDiscover();
    const searchInput = screen.getByLabelText('Search sessions') as HTMLInputElement;
    expect(searchInput).toBeDefined();
    expect(searchInput.value).toBe('');
  });

  it('filters sessions by search term on summary', async () => {
    setupDefaultMocks([
      createDiscoveredSession({ sessionId: 's1', summary: 'Fix authentication' }),
      createDiscoveredSession({ sessionId: 's2', summary: 'Add dashboard' }),
    ]);
    renderDiscover();
    await waitFor(() => {
      expect(screen.getByText(/Showing 2 of 2/)).toBeDefined();
    });

    const searchInput = screen.getByLabelText('Search sessions') as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: 'auth' } });

    await waitFor(() => {
      expect(screen.getByText(/Showing 1 of 2/)).toBeDefined();
    });
  });

  it('filters sessions by search term on project path', async () => {
    setupDefaultMocks([
      createDiscoveredSession({ sessionId: 's1', projectPath: '/home/user/web-app' }),
      createDiscoveredSession({ sessionId: 's2', projectPath: '/home/user/api-server' }),
    ]);
    renderDiscover();
    await waitFor(() => {
      expect(screen.getByText(/Showing 2 of 2/)).toBeDefined();
    });

    const searchInput = screen.getByLabelText('Search sessions') as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: 'api-server' } });

    await waitFor(() => {
      expect(screen.getByText(/Showing 1 of 2/)).toBeDefined();
    });
  });

  it('shows search placeholder text', () => {
    renderDiscover();
    const searchInput = screen.getByPlaceholderText('Search sessions...');
    expect(searchInput).toBeDefined();
  });

  // =========================================================================
  // 6. Import button functionality
  // =========================================================================

  it('renders import button for each non-imported session', async () => {
    setupDefaultMocks([createDiscoveredSession()]);
    renderDiscover();
    await waitFor(() => {
      const importButtons = screen.getAllByText('Import');
      expect(importButtons.length).toBeGreaterThan(0);
    });
  });

  it('calls api.createSession on single import click', async () => {
    const session = createDiscoveredSession({
      sessionId: 'import-me',
      machineId: 'machine-1',
      hostname: 'test-host',
    });
    setupDefaultMocks([session]);
    mockCreateSession.mockResolvedValue({ id: 'new-session' });

    renderDiscover();
    await waitFor(() => {
      expect(screen.getByText('Import')).toBeDefined();
    });

    const importBtn = screen.getByLabelText('Import session import-m');
    fireEvent.click(importBtn);

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'adhoc',
          machineId: 'machine-1',
          resumeSessionId: 'import-me',
        }),
      );
    });
  });

  it('shows toast on successful import', async () => {
    setupDefaultMocks([createDiscoveredSession({ hostname: 'my-mac' })]);
    mockCreateSession.mockResolvedValue({ id: 'new-session' });

    renderDiscover();
    await waitFor(() => {
      expect(screen.getByText('Import')).toBeDefined();
    });

    const importBtn = screen.getAllByText('Import')[0];
    expect(importBtn).toBeDefined();
    if (importBtn) fireEvent.click(importBtn);

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith(
        expect.stringContaining('Imported session from my-mac'),
      );
    });
  });

  it('shows toast on import failure', async () => {
    setupDefaultMocks([createDiscoveredSession()]);
    mockCreateSession.mockRejectedValue(new Error('Network error'));

    renderDiscover();
    await waitFor(() => {
      expect(screen.getByText('Import')).toBeDefined();
    });

    const importBtn = screen.getAllByText('Import')[0];
    expect(importBtn).toBeDefined();
    if (importBtn) fireEvent.click(importBtn);

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('Network error');
    });
  });

  it('marks already-imported sessions with badge', async () => {
    const discoveredSession = createDiscoveredSession({ sessionId: 'already-imported' });
    mockDiscoverQuery.mockReturnValue({
      queryKey: ['discovered-sessions'],
      queryFn: vi.fn().mockResolvedValue({
        count: 1,
        machinesQueried: 1,
        machinesFailed: 0,
        sessions: [discoveredSession],
      }),
    });
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({
        sessions: [{ claudeSessionId: 'already-imported' }],
        total: 1,
        limit: 1000,
        offset: 0,
        hasMore: false,
      }),
    });

    renderDiscover();
    await waitFor(() => {
      expect(screen.getByText('Imported')).toBeDefined();
    });
  });

  it('renders select all button', async () => {
    setupDefaultMocks([createDiscoveredSession()]);
    renderDiscover();
    await waitFor(() => {
      expect(screen.getByText('Select All')).toBeDefined();
    });
  });

  it('shows bulk import button after selecting sessions', async () => {
    setupDefaultMocks([
      createDiscoveredSession({ sessionId: 's1' }),
      createDiscoveredSession({ sessionId: 's2' }),
    ]);
    renderDiscover();
    // Wait for sessions to render
    await waitFor(() => {
      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes.length).toBe(2);
    });

    // Select individual sessions via checkboxes
    const checkboxes = screen.getAllByRole('checkbox');
    const cb0 = checkboxes[0];
    const cb1 = checkboxes[1];
    if (cb0) fireEvent.click(cb0);
    if (cb1) fireEvent.click(cb1);

    await waitFor(() => {
      expect(screen.getByText('Import 2 Selected')).toBeDefined();
    });
  });

  // =========================================================================
  // 7. Group by project/machine modes
  // =========================================================================

  it('renders group by dropdown', () => {
    renderDiscover();
    const groupSelect = screen.getByLabelText('Group by') as HTMLSelectElement;
    expect(groupSelect).toBeDefined();
    expect(groupSelect.value).toBe('project');
  });

  it('groups sessions by project by default', async () => {
    setupDefaultMocks([
      createDiscoveredSession({
        sessionId: 's1',
        projectPath: '/home/user/project-a',
        summary: 'Task A1',
      }),
      createDiscoveredSession({
        sessionId: 's2',
        projectPath: '/home/user/project-a',
        summary: 'Task A2',
      }),
      createDiscoveredSession({
        sessionId: 's3',
        projectPath: '/home/user/project-b',
        summary: 'Task B1',
      }),
    ]);
    renderDiscover();
    await waitFor(() => {
      // Group headers show the last segment of path as project name
      expect(screen.getByText('project-a')).toBeDefined();
      expect(screen.getByText('project-b')).toBeDefined();
    });
  });

  it('switches to group by machine mode', async () => {
    setupDefaultMocks([
      createDiscoveredSession({ sessionId: 's1', hostname: 'host-alpha' }),
      createDiscoveredSession({ sessionId: 's2', hostname: 'host-beta' }),
    ]);
    renderDiscover();

    const groupSelect = screen.getByLabelText('Group by') as HTMLSelectElement;
    fireEvent.change(groupSelect, { target: { value: 'machine' } });

    await waitFor(() => {
      // In machine mode, group headers are hostnames
      // The group header button text contains the hostname
      const buttons = screen.getAllByRole('button');
      const hostAlphaButton = buttons.find((b) => b.textContent?.includes('host-alpha'));
      const hostBetaButton = buttons.find((b) => b.textContent?.includes('host-beta'));
      expect(hostAlphaButton).toBeDefined();
      expect(hostBetaButton).toBeDefined();
    });
  });

  it('switches to flat list mode (no group headers)', async () => {
    setupDefaultMocks([createDiscoveredSession({ sessionId: 's1', summary: 'Flat session' })]);
    renderDiscover();

    const groupSelect = screen.getByLabelText('Group by') as HTMLSelectElement;
    fireEvent.change(groupSelect, { target: { value: 'flat' } });

    await waitFor(() => {
      expect(screen.getByText('Flat session')).toBeDefined();
    });
  });

  it('hides collapse/expand all button in flat mode', async () => {
    setupDefaultMocks([createDiscoveredSession()]);
    renderDiscover();

    // In project mode, the button exists
    expect(screen.getByText('Collapse All')).toBeDefined();

    const groupSelect = screen.getByLabelText('Group by') as HTMLSelectElement;
    fireEvent.change(groupSelect, { target: { value: 'flat' } });

    await waitFor(() => {
      expect(screen.queryByText('Collapse All')).toBeNull();
      expect(screen.queryByText('Expand All')).toBeNull();
    });
  });

  it('collapse all button toggles groups', async () => {
    setupDefaultMocks([
      createDiscoveredSession({
        sessionId: 's1',
        projectPath: '/project-a',
        summary: 'Task in A',
      }),
    ]);
    renderDiscover();
    await waitFor(() => {
      expect(screen.getByText('Task in A')).toBeDefined();
    });

    // Click collapse all
    fireEvent.click(screen.getByText('Collapse All'));

    await waitFor(() => {
      expect(screen.getByText('Expand All')).toBeDefined();
      // Session row should be hidden when collapsed
      expect(screen.queryByText('Task in A')).toBeNull();
    });
  });

  // =========================================================================
  // 8. Empty state when no sessions found
  // =========================================================================

  it('shows empty state when no sessions discovered at all', async () => {
    setupDefaultMocks([], 2, 0);
    renderDiscover();
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeDefined();
      expect(screen.getByText('No sessions discovered')).toBeDefined();
    });
  });

  it('shows empty state description with machine count', async () => {
    setupDefaultMocks([], 3, 0);
    renderDiscover();
    await waitFor(() => {
      expect(screen.getByText(/Scanned 3 machine/)).toBeDefined();
    });
  });

  it('shows filter empty state when all sessions are filtered out', async () => {
    setupDefaultMocks([createDiscoveredSession({ messageCount: 2 })]);
    renderDiscover();

    // Set min messages to 50 — the session with 2 messages should be filtered out
    const minMsgsSelect = screen.getByLabelText('Minimum message count') as HTMLSelectElement;
    fireEvent.change(minMsgsSelect, { target: { value: '50' } });

    await waitFor(() => {
      expect(screen.getByText('No sessions match the current filters')).toBeDefined();
    });
  });

  // =========================================================================
  // Additional interactions
  // =========================================================================

  it('renders refresh button', () => {
    renderDiscover();
    expect(screen.getByTestId('refresh-button')).toBeDefined();
  });

  it('renders new session toggle button', () => {
    renderDiscover();
    expect(screen.getByText('+ New Session')).toBeDefined();
  });

  it('toggles new session form on click', async () => {
    setupDefaultMocks([createDiscoveredSession()]);
    renderDiscover();

    fireEvent.click(screen.getByText('+ New Session'));

    await waitFor(() => {
      expect(screen.getByText('Cancel')).toBeDefined();
      expect(screen.getByLabelText('Machine')).toBeDefined();
      expect(screen.getByLabelText('Project Path')).toBeDefined();
      expect(screen.getByLabelText('Prompt')).toBeDefined();
    });
  });

  it('renders resume button for each session', async () => {
    setupDefaultMocks([createDiscoveredSession()]);
    renderDiscover();
    await waitFor(() => {
      const resumeButtons = screen.getAllByText('Resume');
      expect(resumeButtons.length).toBeGreaterThan(0);
    });
  });

  it('shows resume prompt input when resume clicked', async () => {
    setupDefaultMocks([createDiscoveredSession({ sessionId: 'resume-me' })]);
    renderDiscover();
    await waitFor(() => {
      expect(screen.getByText('Resume')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Resume'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Enter prompt to resume...')).toBeDefined();
    });
  });

  it('renders error banner when query fails', async () => {
    const error = new Error('API failed');
    mockDiscoverQuery.mockReturnValue({
      queryKey: ['discovered-sessions'],
      queryFn: vi.fn().mockRejectedValue(error),
    });
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({
        sessions: [],
        total: 0,
        limit: 1000,
        offset: 0,
        hasMore: false,
      }),
    });

    renderDiscover();
    await waitFor(() => {
      expect(screen.getByTestId('error-banner')).toBeDefined();
    });
  });

  it('renders checkboxes for session selection', async () => {
    setupDefaultMocks([
      createDiscoveredSession({ sessionId: 'sel-1' }),
      createDiscoveredSession({ sessionId: 'sel-2' }),
    ]);
    renderDiscover();
    await waitFor(() => {
      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes.length).toBe(2);
    });
  });

  it('shows machine filter when multiple hostnames', async () => {
    setupDefaultMocks([
      createDiscoveredSession({ sessionId: 's1', hostname: 'host-a' }),
      createDiscoveredSession({ sessionId: 's2', hostname: 'host-b' }),
    ]);
    renderDiscover();
    await waitFor(() => {
      // Machine filter only appears when there are >1 unique hostnames
      expect(screen.getByText(/All \(2\)/)).toBeDefined();
    });
  });
});
