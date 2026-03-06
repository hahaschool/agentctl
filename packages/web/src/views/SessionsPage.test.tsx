import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiAccount, Machine, Session } from '@/lib/api';
import { SessionsPage } from './SessionsPage';

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.mock is hoisted to the top of the file, so any
// variables referenced inside factories must be declared via vi.hoisted().
// ---------------------------------------------------------------------------

const {
  mockSessionsQuery,
  mockAccountsQuery,
  mockListMachines,
  mockCreateSession,
  mockSendMessage,
  mockResumeSession,
  mockDeleteSession,
  mockGetSessionContent,
} = vi.hoisted(() => ({
  mockSessionsQuery: vi.fn(),
  mockAccountsQuery: vi.fn(),
  mockListMachines: vi.fn(),
  mockCreateSession: vi.fn(),
  mockSendMessage: vi.fn(),
  mockResumeSession: vi.fn(),
  mockDeleteSession: vi.fn(),
  mockGetSessionContent: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

vi.mock('@/hooks/use-hotkeys', () => ({
  useHotkeys: vi.fn(),
}));

vi.mock('@/hooks/use-session-stream', () => ({
  useSessionStream: () => ({
    connected: false,
    streamOutput: [],
  }),
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

vi.mock('@/components/StatusBadge', () => ({
  StatusBadge: ({ status }: { status: string }) => (
    <span data-testid={`status-badge-${status}`}>{status}</span>
  ),
}));

vi.mock('@/components/ConfirmButton', () => ({
  ConfirmButton: ({ label, onConfirm }: { label: string; onConfirm: () => void }) => (
    <button type="button" data-testid="confirm-button" onClick={onConfirm}>
      {label}
    </button>
  ),
}));

vi.mock('@/components/EmptyState', () => ({
  EmptyState: ({ title, action }: { title: string; action?: React.ReactNode }) => (
    <div data-testid="empty-state">
      {title}
      {action}
    </div>
  ),
}));

vi.mock('@/components/AnsiText', () => ({
  AnsiText: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AnsiSpan: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@/lib/queries', () => ({
  sessionsQuery: () => mockSessionsQuery(),
  accountsQuery: () => mockAccountsQuery(),
  queryKeys: {
    sessions: () => ['sessions'],
  },
  useCreateAgent: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@/lib/api', () => ({
  api: {
    listMachines: mockListMachines,
    createSession: mockCreateSession,
    sendMessage: mockSendMessage,
    resumeSession: mockResumeSession,
    deleteSession: mockDeleteSession,
    getSessionContent: mockGetSessionContent,
  },
}));

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function createMachine(overrides?: Partial<Machine>): Machine {
  return {
    id: 'machine-1',
    hostname: 'test-machine',
    tailscaleIp: '100.0.0.1',
    os: 'linux',
    arch: 'x64',
    status: 'online',
    lastHeartbeat: new Date().toISOString(),
    capabilities: { gpu: false, docker: true, maxConcurrentAgents: 4 },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function createSession(overrides?: Partial<Session>): Session {
  return {
    id: 'session-1',
    agentId: 'agent-1',
    agentName: null,
    machineId: 'machine-1',
    sessionUrl: 'https://example.com/session',
    claudeSessionId: 'claude-session-1',
    status: 'active',
    projectPath: '/tmp/project',
    pid: 12345,
    startedAt: new Date(Date.now() - 60000).toISOString(),
    lastHeartbeat: new Date().toISOString(),
    endedAt: null,
    metadata: {},
    accountId: 'account-1',
    model: 'claude-3-5-sonnet-20241022',
    ...overrides,
  };
}

function createAccount(overrides?: Partial<ApiAccount>): ApiAccount {
  return {
    id: 'account-1',
    name: 'Test Account',
    provider: 'anthropic_api',
    credentialMasked: '****abcd',
    priority: 1,
    rateLimit: {},
    isActive: true,
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderSessions() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <SessionsPage />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default successful responses
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({ sessions: [createSession()], total: 1, limit: 50, offset: 0, hasMore: false }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue({ data: { sessions: [createSession()], total: 1, limit: 50, offset: 0, hasMore: false } }),
    });

    mockAccountsQuery.mockReturnValue({
      queryKey: ['accounts'],
      queryFn: vi.fn().mockResolvedValue([createAccount()]),
      data: [createAccount()],
      isLoading: false,
      isFetching: false,
    });

    mockListMachines.mockResolvedValue([createMachine()]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Rendering & Layout
  // =========================================================================

  it('renders the page with sessions header', () => {
    renderSessions();
    expect(screen.getByText('Sessions')).toBeDefined();
  });

  it('renders session count in header', async () => {
    renderSessions();
    await waitFor(() => {
      // Count is shown inline as a plain number (no parentheses)
      const heading = screen.getByRole('heading', { level: 2 });
      expect(heading.textContent).toContain('1');
    });
  });

  it('renders new session button', () => {
    renderSessions();
    expect(screen.getByText('+ New')).toBeDefined();
  });

  it('renders refresh button', () => {
    renderSessions();
    expect(screen.getByTestId('refresh-button')).toBeDefined();
  });

  it('displays empty state when no sessions exist', async () => {
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({ sessions: [], total: 0, limit: 50, offset: 0, hasMore: false }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue({ data: { sessions: [], total: 0, limit: 50, offset: 0, hasMore: false } }),
    });

    renderSessions();
    await waitFor(() => {
      expect(screen.getByText('No sessions yet')).toBeDefined();
    });
  });

  // =========================================================================
  // Status Filter Tabs
  // =========================================================================

  it('renders all status filter tabs', () => {
    renderSessions();
    // "All" may appear multiple times (status tab + select all checkbox)
    expect(screen.getAllByText('All').length).toBeGreaterThan(0);
    expect(screen.getByText('Starting')).toBeDefined();
    expect(screen.getByText('Active')).toBeDefined();
    expect(screen.getByText('Ended')).toBeDefined();
    expect(screen.getByText('Error')).toBeDefined();
  });

  it('displays status counts in tabs', async () => {
    const sessions = [
      createSession({ id: 'session-1', status: 'active' }),
      createSession({ id: 'session-2', status: 'active' }),
      createSession({ id: 'session-3', status: 'ended' }),
    ];
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({ sessions, total: sessions.length, limit: 50, offset: 0, hasMore: false }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue({ data: { sessions, total: sessions.length, limit: 50, offset: 0, hasMore: false } }),
    });

    renderSessions();
    await waitFor(() => {
      // Find the "All" tab element (not the select-all checkbox)
      const allElements = screen.getAllByText('All');
      const tabText = allElements.map((el) => el.parentElement?.textContent ?? '').find((t) => t.includes('3'));
      expect(tabText).toBeDefined();
    });
  });

  // =========================================================================
  // Search & Filter Interactions
  // =========================================================================

  it('renders search input', () => {
    renderSessions();
    const searchInput = screen.getByPlaceholderText(
      'Search sessions...',
    ) as HTMLInputElement;
    expect(searchInput).toBeDefined();
  });

  it('renders sort order dropdown', () => {
    renderSessions();
    const sortSelect = screen.getByLabelText('Sort order') as HTMLSelectElement;
    expect(sortSelect).toBeDefined();
    expect(sortSelect.value).toBe('newest');
  });

  it('renders group by dropdown', () => {
    renderSessions();
    const groupSelect = screen.getByLabelText('Group by') as HTMLSelectElement;
    expect(groupSelect).toBeDefined();
    expect(groupSelect.value).toBe('none');
  });

  it('renders hide empty checkbox', () => {
    renderSessions();
    const hideEmptyCheckbox = screen.getByLabelText('Hide empty') as HTMLInputElement;
    expect(hideEmptyCheckbox).toBeDefined();
    expect(hideEmptyCheckbox.checked).toBe(false);
  });

  // =========================================================================
  // Session List Rendering
  // =========================================================================

  it('renders session list items', async () => {
    const sessions = [
      createSession({ id: 'session-1', agentId: 'agent-1' }),
      createSession({ id: 'session-2', agentId: 'agent-2' }),
    ];
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({ sessions, total: sessions.length, limit: 50, offset: 0, hasMore: false }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue({ data: { sessions, total: sessions.length, limit: 50, offset: 0, hasMore: false } }),
    });

    renderSessions();
    await waitFor(() => {
      expect(screen.getByText('agent-1')).toBeDefined();
      expect(screen.getByText('agent-2')).toBeDefined();
    });
  });

  it('renders session as listbox option with role', async () => {
    const sessions = [createSession({ id: 'session-1', agentId: 'agent-1' })];
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({ sessions, total: 1, limit: 50, offset: 0, hasMore: false }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue({ data: { sessions, total: 1, limit: 50, offset: 0, hasMore: false } }),
    });

    renderSessions();
    await waitFor(() => {
      const options = screen.getAllByRole('option');
      expect(options.length).toBeGreaterThan(0);
    });
  });

  it('shows loading skeleton when sessions are loading', async () => {
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockReturnValue(new Promise(() => {})),
      dataUpdatedAt: Date.now(),
      isLoading: true,
      isFetching: true,
      refetch: vi.fn(),
    });

    renderSessions();
    await waitFor(() => {
      const skeletons = screen.getAllByTestId('skeleton');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // New Session Form Elements
  // =========================================================================

  it('renders create form toggle button', () => {
    renderSessions();
    const createButton = screen.getByText('+ New') as HTMLButtonElement;
    expect(createButton).toBeDefined();
  });

  // =========================================================================
  // Session Detail Panel
  // =========================================================================

  it('shows detail panel placeholder when no session selected', () => {
    renderSessions();
    expect(screen.getByText('Select a session to view details')).toBeDefined();
  });

  // =========================================================================
  // Cleanup Functionality
  // =========================================================================

  it('shows cleanup button when there are ended sessions', async () => {
    const sessions = [
      createSession({ id: 'session-1', status: 'active' }),
      createSession({ id: 'session-2', status: 'ended' }),
      createSession({ id: 'session-3', status: 'error' }),
    ];
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({ sessions, total: sessions.length, limit: 50, offset: 0, hasMore: false }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue({ data: { sessions, total: sessions.length, limit: 50, offset: 0, hasMore: false } }),
    });

    renderSessions();
    await waitFor(() => {
      expect(screen.getByText(/Clean 2/)).toBeDefined();
    });
  });

  it('hides cleanup button when no cleanupable sessions exist', async () => {
    const sessions = [createSession({ id: 'session-1', status: 'active' })];
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({ sessions, total: 1, limit: 50, offset: 0, hasMore: false }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue({ data: { sessions, total: 1, limit: 50, offset: 0, hasMore: false } }),
    });

    renderSessions();
    await waitFor(() => {
      expect(screen.queryByText(/Clean \d/)).toBeNull();
    });
  });

  // =========================================================================
  // Loading and Error States
  // =========================================================================

  it('renders the fetching bar component', () => {
    renderSessions();
    const fetchingBar = screen.getByTestId('fetching-bar');
    expect(fetchingBar).toBeDefined();
  });

  it('displays last updated timestamp', () => {
    const now = Date.now();
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({ sessions: [createSession()], total: 1, limit: 50, offset: 0, hasMore: false }),
      dataUpdatedAt: now,
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });

    renderSessions();
    expect(screen.getByTestId('last-updated')).toBeDefined();
  });

  // =========================================================================
  // Edge Cases & Data Handling
  // =========================================================================

  it('displays multiple sessions with different statuses', async () => {
    const sessions = [
      createSession({ id: 'session-1', status: 'active' }),
      createSession({ id: 'session-2', status: 'starting' }),
      createSession({ id: 'session-3', status: 'ended' }),
      createSession({ id: 'session-4', status: 'error' }),
    ];
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({ sessions, total: sessions.length, limit: 50, offset: 0, hasMore: false }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue({ data: { sessions, total: sessions.length, limit: 50, offset: 0, hasMore: false } }),
    });

    renderSessions();
    await waitFor(() => {
      const heading = screen.getByRole('heading', { level: 2 });
      expect(heading.textContent).toContain('4');
    });
  });

  it('filters sessions by hiding empty ones', async () => {
    const sessions = [
      createSession({ id: 'session-1', claudeSessionId: 'claude-1' }),
      createSession({ id: 'session-2', claudeSessionId: undefined }),
    ];
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({ sessions, total: sessions.length, limit: 50, offset: 0, hasMore: false }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue({ data: { sessions, total: sessions.length, limit: 50, offset: 0, hasMore: false } }),
    });

    renderSessions();
    const hideEmptyCheckbox = screen.getByLabelText('Hide empty') as HTMLInputElement;
    expect(hideEmptyCheckbox.checked).toBe(false);
    fireEvent.click(hideEmptyCheckbox);
    expect(hideEmptyCheckbox.checked).toBe(true);
  });

  it('changes group by option', async () => {
    const sessions = [
      createSession({ id: 'session-1', projectPath: '/home/user/project-a' }),
      createSession({ id: 'session-2', projectPath: '/home/user/project-b' }),
    ];
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({ sessions, total: sessions.length, limit: 50, offset: 0, hasMore: false }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue({ data: { sessions, total: sessions.length, limit: 50, offset: 0, hasMore: false } }),
    });

    renderSessions();
    const groupSelect = screen.getByLabelText('Group by') as HTMLSelectElement;
    expect(groupSelect.value).toBe('none');
    fireEvent.change(groupSelect, { target: { value: 'project' } });
    expect(groupSelect.value).toBe('project');
  });

  it('changes sort order option', async () => {
    renderSessions();
    const sortSelect = screen.getByLabelText('Sort order') as HTMLSelectElement;
    expect(sortSelect.value).toBe('newest');
    fireEvent.change(sortSelect, { target: { value: 'oldest' } });
    expect(sortSelect.value).toBe('oldest');
  });

  it('changes search query input', async () => {
    renderSessions();
    const searchInput = screen.getByPlaceholderText(
      'Search sessions...',
    ) as HTMLInputElement;
    expect(searchInput.value).toBe('');
    fireEvent.change(searchInput, { target: { value: 'test-search' } });
    expect(searchInput.value).toBe('test-search');
  });

  it('renders session list with listbox role', async () => {
    renderSessions();
    const listbox = screen.getByRole('listbox') as HTMLDivElement;
    expect(listbox).toBeDefined();
  });
});
