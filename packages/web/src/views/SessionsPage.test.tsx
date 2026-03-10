import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import type { ApiAccount, Machine, RuntimeSession, Session } from '@/lib/api';
import { SessionsPage } from './SessionsPage';

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.mock is hoisted to the top of the file, so any
// variables referenced inside factories must be declared via vi.hoisted().
// ---------------------------------------------------------------------------

const {
  mockSessionsQuery,
  mockRuntimeSessionsQuery,
  mockAccountsQuery,
  mockMachinesQuery,
  mockRuntimeSessionHandoffsQuery,
  mockRuntimeSessionPreflightQuery,
  mockListMachines,
  mockCreateSession,
  mockResumeRuntimeSessionMutateAsync,
  mockForkRuntimeSessionMutateAsync,
  mockHandoffRuntimeSessionMutateAsync,
  mockSendMessage,
  mockResumeSession,
  mockDeleteSession,
  mockGetSessionContent,
  mockPathBadge,
} = vi.hoisted(() => ({
  mockSessionsQuery: vi.fn(),
  mockRuntimeSessionsQuery: vi.fn(),
  mockAccountsQuery: vi.fn(),
  mockMachinesQuery: vi.fn(),
  mockRuntimeSessionHandoffsQuery: vi.fn(),
  mockRuntimeSessionPreflightQuery: vi.fn(),
  mockListMachines: vi.fn(),
  mockCreateSession: vi.fn(),
  mockResumeRuntimeSessionMutateAsync: vi.fn(),
  mockForkRuntimeSessionMutateAsync: vi.fn(),
  mockHandoffRuntimeSessionMutateAsync: vi.fn(),
  mockSendMessage: vi.fn(),
  mockResumeSession: vi.fn(),
  mockDeleteSession: vi.fn(),
  mockGetSessionContent: vi.fn(),
  mockPathBadge: vi.fn(),
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
  PathBadge: (props: { path: string; copyable?: boolean }) => {
    mockPathBadge(props);
    return <span data-testid="path-badge">{props.path}</span>;
  },
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
  runtimeSessionsQuery: () => mockRuntimeSessionsQuery(),
  accountsQuery: () => mockAccountsQuery(),
  machinesQuery: () => mockMachinesQuery(),
  runtimeSessionHandoffsQuery: (id: string, limit?: number) =>
    mockRuntimeSessionHandoffsQuery(id, limit),
  runtimeSessionPreflightQuery: (id: string, params: Record<string, unknown>) =>
    mockRuntimeSessionPreflightQuery(id, params),
  useResumeRuntimeSession: () => ({
    mutateAsync: mockResumeRuntimeSessionMutateAsync,
    isPending: false,
  }),
  useForkRuntimeSession: () => ({
    mutateAsync: mockForkRuntimeSessionMutateAsync,
    isPending: false,
  }),
  useHandoffRuntimeSession: () => ({
    mutateAsync: mockHandoffRuntimeSessionMutateAsync,
    isPending: false,
  }),
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

function createRuntimeSession(overrides?: Partial<RuntimeSession>): RuntimeSession {
  return {
    id: 'runtime-1',
    runtime: 'codex',
    nativeSessionId: 'native-runtime-1',
    machineId: 'machine-runtime',
    agentId: 'runtime-agent-1',
    projectPath: '/tmp/runtime-project',
    worktreePath: '/tmp/runtime-project/.trees/codex',
    status: 'active',
    configRevision: 4,
    handoffStrategy: null,
    handoffSourceSessionId: null,
    metadata: {
      model: 'gpt-5-codex',
      activeMcpServers: ['github'],
    },
    startedAt: new Date(Date.now() - 120000).toISOString(),
    lastHeartbeat: new Date().toISOString(),
    endedAt: null,
    ...overrides,
  };
}

function createRuntimeHandoff(overrides: Record<string, unknown> = {}) {
  return {
    id: 'handoff-1',
    sourceSessionId: 'runtime-1',
    targetSessionId: 'runtime-2',
    sourceRuntime: 'codex',
    targetRuntime: 'claude-code',
    reason: 'manual',
    strategy: 'snapshot-handoff',
    status: 'succeeded',
    snapshot: {
      sourceRuntime: 'codex',
      sourceSessionId: 'runtime-1',
      sourceNativeSessionId: 'native-runtime-1',
      projectPath: '/tmp/runtime-project',
      worktreePath: '/tmp/runtime-project/.trees/codex',
      branch: 'feature/runtime',
      headSha: 'abc123',
      dirtyFiles: [],
      diffSummary: 'Added runtime handoff support.',
      conversationSummary: 'Continue runtime integration.',
      openTodos: ['Wire the unified page'],
      nextSuggestedPrompt: 'Keep going',
      activeConfigRevision: 4,
      activeMcpServers: ['github'],
      activeSkills: ['brainstorming'],
      reason: 'manual',
    },
    nativeImportAttempt: undefined,
    errorMessage: null,
    createdAt: '2026-03-10T08:06:00.000Z',
    completedAt: '2026-03-10T08:06:30.000Z',
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
      <TooltipProvider>
        <SessionsPage />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

/** Return session list items scoped to the listbox (excludes select option elements). */
function getSessionItems() {
  const listbox = screen.getByRole('listbox');
  return within(listbox).getAllByRole('option');
}

function querySessionItems() {
  const listbox = screen.getByRole('listbox');
  return within(listbox).queryAllByRole('option');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathBadge.mockClear();

    // Default successful responses
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({
        sessions: [createSession()],
        total: 1,
        limit: 50,
        offset: 0,
        hasMore: false,
      }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue({
        data: { sessions: [createSession()], total: 1, limit: 50, offset: 0, hasMore: false },
      }),
    });

    mockAccountsQuery.mockReturnValue({
      queryKey: ['accounts'],
      queryFn: vi.fn().mockResolvedValue([createAccount()]),
      data: [createAccount()],
      isLoading: false,
      isFetching: false,
    });

    mockRuntimeSessionsQuery.mockReturnValue({
      queryKey: ['runtime-sessions'],
      queryFn: vi.fn().mockResolvedValue({
        sessions: [],
        count: 0,
      }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue({
        data: { sessions: [], count: 0 },
      }),
    });

    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([createMachine(), createMachine({ id: 'machine-2' })]),
    });
    mockRuntimeSessionHandoffsQuery.mockImplementation((id: string) => ({
      queryKey: ['runtime-sessions', id, 'handoffs'],
      queryFn: vi.fn().mockResolvedValue({
        handoffs: id ? [createRuntimeHandoff({ sourceSessionId: id })] : [],
        count: id ? 1 : 0,
      }),
    }));
    mockRuntimeSessionPreflightQuery.mockImplementation((id: string, params: Record<string, unknown>) => ({
      queryKey: ['runtime-sessions', id, 'preflight', params.targetRuntime],
      queryFn: vi.fn().mockResolvedValue({
        nativeImportCapable: true,
        attempt: {
          ok: false,
          sourceRuntime: 'codex',
          targetRuntime: String(params.targetRuntime ?? 'claude-code'),
          reason: 'not_implemented',
          metadata: {
            targetCli: 'claude',
            sourceStorage: '/Users/example/.codex/sessions',
          },
        },
      }),
    }));
    mockResumeRuntimeSessionMutateAsync.mockResolvedValue({
      ok: true,
      session: createRuntimeSession(),
    });
    mockForkRuntimeSessionMutateAsync.mockResolvedValue({
      ok: true,
      session: createRuntimeSession({ id: 'runtime-forked' }),
    });
    mockHandoffRuntimeSessionMutateAsync.mockResolvedValue({
      ok: true,
      strategy: 'snapshot-handoff',
      session: createRuntimeSession({ id: 'runtime-handoff', runtime: 'claude-code' }),
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
      queryFn: vi
        .fn()
        .mockResolvedValue({ sessions: [], total: 0, limit: 50, offset: 0, hasMore: false }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue({
        data: { sessions: [], total: 0, limit: 50, offset: 0, hasMore: false },
      }),
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
      queryFn: vi.fn().mockResolvedValue({
        sessions,
        total: sessions.length,
        limit: 50,
        offset: 0,
        hasMore: false,
      }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue({
        data: { sessions, total: sessions.length, limit: 50, offset: 0, hasMore: false },
      }),
    });

    renderSessions();
    await waitFor(() => {
      // Find the "All" tab element (not the select-all checkbox)
      const allElements = screen.getAllByText('All');
      const tabText = allElements
        .map((el) => el.parentElement?.textContent ?? '')
        .find((t) => t.includes('3'));
      expect(tabText).toBeDefined();
    });
  });

  // =========================================================================
  // Search & Filter Interactions
  // =========================================================================

  it('renders search input', () => {
    renderSessions();
    const searchInput = screen.getByPlaceholderText('Search sessions...') as HTMLInputElement;
    expect(searchInput).toBeDefined();
  });

  it('renders sort order dropdown', () => {
    renderSessions();
    const sortSelect = screen.getByLabelText('Sort by') as HTMLSelectElement;
    expect(sortSelect).toBeDefined();
    expect(sortSelect.value).toBe('newest');
  });

  it('renders group by dropdown', () => {
    renderSessions();
    const groupSelect = screen.getByLabelText('Group by') as HTMLSelectElement;
    expect(groupSelect).toBeDefined();
    expect(groupSelect.value).toBe('none');
  });

  it('renders a type filter with all, agent, and runtime options defaulting to all', async () => {
    renderSessions();

    const typeSelect = (await screen.findByLabelText('Type')) as HTMLSelectElement;
    expect(typeSelect.value).toBe('all');
    expect(within(typeSelect).getByRole('option', { name: 'All' })).toBeDefined();
    expect(within(typeSelect).getByRole('option', { name: 'Agent' })).toBeDefined();
    expect(within(typeSelect).getByRole('option', { name: 'Runtime' })).toBeDefined();
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
      queryFn: vi.fn().mockResolvedValue({
        sessions,
        total: sessions.length,
        limit: 50,
        offset: 0,
        hasMore: false,
      }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue({
        data: { sessions, total: sessions.length, limit: 50, offset: 0, hasMore: false },
      }),
    });

    renderSessions();
    await waitFor(() => {
      expect(screen.getByText('agent-1')).toBeDefined();
      expect(screen.getByText('agent-2')).toBeDefined();
    });
  });

  it('shows runtime rows in the default all view when mixed data is present', async () => {
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({
        sessions: [createSession({ id: 'agent-session-1', agentId: 'agent-alpha', agentName: 'Agent Alpha' })],
        total: 1,
        limit: 50,
        offset: 0,
        hasMore: false,
      }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue({
        data: {
          sessions: [createSession({ id: 'agent-session-1', agentId: 'agent-alpha', agentName: 'Agent Alpha' })],
          total: 1,
          limit: 50,
          offset: 0,
          hasMore: false,
        },
      }),
    });
    mockRuntimeSessionsQuery.mockReturnValue({
      queryKey: ['runtime-sessions'],
      queryFn: vi.fn().mockResolvedValue({
        sessions: [createRuntimeSession({ id: 'runtime-session-1', runtime: 'codex' })],
        count: 1,
      }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue({
        data: {
          sessions: [createRuntimeSession({ id: 'runtime-session-1', runtime: 'codex' })],
          count: 1,
        },
      }),
    });

    renderSessions();

    await waitFor(() => {
      expect(screen.getByText('Agent Alpha')).toBeDefined();
      expect(screen.getByText('Runtime · Codex')).toBeDefined();
    });
  });

  it('filters runtime rows out when type is agent', async () => {
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({
        sessions: [createSession({ id: 'agent-session-1', agentId: 'agent-alpha', agentName: 'Agent Alpha' })],
        total: 1,
        limit: 50,
        offset: 0,
        hasMore: false,
      }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue({
        data: {
          sessions: [createSession({ id: 'agent-session-1', agentId: 'agent-alpha', agentName: 'Agent Alpha' })],
          total: 1,
          limit: 50,
          offset: 0,
          hasMore: false,
        },
      }),
    });
    mockRuntimeSessionsQuery.mockReturnValue({
      queryKey: ['runtime-sessions'],
      queryFn: vi.fn().mockResolvedValue({
        sessions: [createRuntimeSession({ id: 'runtime-session-1', runtime: 'codex' })],
        count: 1,
      }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue({
        data: {
          sessions: [createRuntimeSession({ id: 'runtime-session-1', runtime: 'codex' })],
          count: 1,
        },
      }),
    });

    renderSessions();

    const typeSelect = (await screen.findByLabelText('Type')) as HTMLSelectElement;
    fireEvent.change(typeSelect, { target: { value: 'agent' } });

    await waitFor(() => {
      expect(screen.getByText('Agent Alpha')).toBeDefined();
      expect(screen.queryByText('Runtime · Codex')).toBeNull();
    });
  });

  it('filters agent rows out when type is runtime', async () => {
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({
        sessions: [createSession({ id: 'agent-session-1', agentId: 'agent-alpha', agentName: 'Agent Alpha' })],
        total: 1,
        limit: 50,
        offset: 0,
        hasMore: false,
      }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue({
        data: {
          sessions: [createSession({ id: 'agent-session-1', agentId: 'agent-alpha', agentName: 'Agent Alpha' })],
          total: 1,
          limit: 50,
          offset: 0,
          hasMore: false,
        },
      }),
    });
    mockRuntimeSessionsQuery.mockReturnValue({
      queryKey: ['runtime-sessions'],
      queryFn: vi.fn().mockResolvedValue({
        sessions: [createRuntimeSession({ id: 'runtime-session-1', runtime: 'codex' })],
        count: 1,
      }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue({
        data: {
          sessions: [createRuntimeSession({ id: 'runtime-session-1', runtime: 'codex' })],
          count: 1,
        },
      }),
    });

    renderSessions();

    const typeSelect = (await screen.findByLabelText('Type')) as HTMLSelectElement;
    fireEvent.change(typeSelect, { target: { value: 'runtime' } });

    await waitFor(() => {
      expect(screen.getByText('Runtime · Codex')).toBeDefined();
      expect(screen.queryByText('Agent Alpha')).toBeNull();
    });
  });

  it('shows runtime-specific detail actions when selecting a runtime row', async () => {
    mockRuntimeSessionsQuery.mockReturnValue({
      queryKey: ['runtime-sessions'],
      queryFn: vi.fn().mockResolvedValue({
        sessions: [
          createRuntimeSession({
            id: 'runtime-session-1',
            runtime: 'codex',
            machineId: 'machine-1',
          }),
        ],
        count: 1,
      }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue({
        data: {
          sessions: [
            createRuntimeSession({
              id: 'runtime-session-1',
              runtime: 'codex',
              machineId: 'machine-1',
            }),
          ],
          count: 1,
        },
      }),
    });

    renderSessions();

    fireEvent.click(await screen.findByText('Runtime · Codex'));

    await waitFor(() => {
      expect(screen.getByText('Manual Handoff')).toBeDefined();
      expect(screen.getByText('Handoff History')).toBeDefined();
      expect(screen.getByLabelText('Back to session list')).toBeDefined();
      expect(screen.getByRole('button', { name: 'Resume Session' })).toBeDefined();
      expect(screen.getByRole('button', { name: 'Fork Session' })).toBeDefined();
      expect(screen.getByRole('button', { name: 'Start Native Import' })).toBeDefined();
    });
  });

  it('passes non-interactive PathBadge props inside session selection buttons', async () => {
    renderSessions();

    await waitFor(() => {
      expect(mockPathBadge).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/tmp/project',
          copyable: false,
        }),
      );
    });
  });

  it('renders session as listbox option with role', async () => {
    const sessions = [createSession({ id: 'session-1', agentId: 'agent-1' })];
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi
        .fn()
        .mockResolvedValue({ sessions, total: 1, limit: 50, offset: 0, hasMore: false }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi
        .fn()
        .mockResolvedValue({ data: { sessions, total: 1, limit: 50, offset: 0, hasMore: false } }),
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
      queryFn: vi.fn().mockResolvedValue({
        sessions,
        total: sessions.length,
        limit: 50,
        offset: 0,
        hasMore: false,
      }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue({
        data: { sessions, total: sessions.length, limit: 50, offset: 0, hasMore: false },
      }),
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
      queryFn: vi
        .fn()
        .mockResolvedValue({ sessions, total: 1, limit: 50, offset: 0, hasMore: false }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi
        .fn()
        .mockResolvedValue({ data: { sessions, total: 1, limit: 50, offset: 0, hasMore: false } }),
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
      queryFn: vi.fn().mockResolvedValue({
        sessions: [createSession()],
        total: 1,
        limit: 50,
        offset: 0,
        hasMore: false,
      }),
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
      queryFn: vi.fn().mockResolvedValue({
        sessions,
        total: sessions.length,
        limit: 50,
        offset: 0,
        hasMore: false,
      }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue({
        data: { sessions, total: sessions.length, limit: 50, offset: 0, hasMore: false },
      }),
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
      queryFn: vi.fn().mockResolvedValue({
        sessions,
        total: sessions.length,
        limit: 50,
        offset: 0,
        hasMore: false,
      }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue({
        data: { sessions, total: sessions.length, limit: 50, offset: 0, hasMore: false },
      }),
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
      queryFn: vi.fn().mockResolvedValue({
        sessions,
        total: sessions.length,
        limit: 50,
        offset: 0,
        hasMore: false,
      }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue({
        data: { sessions, total: sessions.length, limit: 50, offset: 0, hasMore: false },
      }),
    });

    renderSessions();
    const groupSelect = screen.getByLabelText('Group by') as HTMLSelectElement;
    expect(groupSelect.value).toBe('none');
    fireEvent.change(groupSelect, { target: { value: 'project' } });
    expect(groupSelect.value).toBe('project');
  });

  it('changes sort order option', async () => {
    renderSessions();
    const sortSelect = screen.getByLabelText('Sort by') as HTMLSelectElement;
    expect(sortSelect.value).toBe('newest');
    fireEvent.change(sortSelect, { target: { value: 'oldest' } });
    expect(sortSelect.value).toBe('oldest');
  });

  it('changes search query input', async () => {
    renderSessions();
    const searchInput = screen.getByPlaceholderText('Search sessions...') as HTMLInputElement;
    expect(searchInput.value).toBe('');
    fireEvent.change(searchInput, { target: { value: 'test-search' } });
    expect(searchInput.value).toBe('test-search');
  });

  it('renders session list with listbox role', async () => {
    renderSessions();
    const listbox = screen.getByRole('listbox') as HTMLDivElement;
    expect(listbox).toBeDefined();
  });

  // =========================================================================
  // Status Tab Filtering
  // =========================================================================

  it('clicking Active tab filters sessions', async () => {
    const sessions = [
      createSession({ id: 's1', status: 'active', agentName: 'my-active-agent' }),
      createSession({ id: 's2', status: 'ended', agentName: 'my-ended-agent' }),
      createSession({ id: 's3', status: 'error', agentName: 'my-error-agent' }),
    ];
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi
        .fn()
        .mockResolvedValue({ sessions, total: 3, limit: 50, offset: 0, hasMore: false }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    renderSessions();
    await waitFor(() => {
      expect(screen.getByText('my-active-agent')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Active'));
    await waitFor(() => {
      expect(screen.getByText('my-active-agent')).toBeDefined();
      expect(screen.queryByText('my-ended-agent')).toBeNull();
      expect(screen.queryByText('my-error-agent')).toBeNull();
    });
  });

  it('clicking Error tab filters to only error sessions', async () => {
    const sessions = [
      createSession({ id: 's1', status: 'active', agentName: 'my-active-agent' }),
      createSession({ id: 's2', status: 'error', agentName: 'my-error-agent' }),
    ];
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi
        .fn()
        .mockResolvedValue({ sessions, total: 2, limit: 50, offset: 0, hasMore: false }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    renderSessions();
    await waitFor(() => {
      expect(screen.getByText('my-error-agent')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Error'));
    await waitFor(() => {
      expect(screen.getByText('my-error-agent')).toBeDefined();
      expect(screen.queryByText('my-active-agent')).toBeNull();
    });
  });

  // =========================================================================
  // Select-all checkbox
  // =========================================================================

  it('renders select-all checkbox', async () => {
    renderSessions();
    await waitFor(() => {
      const checkbox = document.getElementById('sessions-select-all') as HTMLInputElement;
      expect(checkbox).toBeDefined();
      expect(checkbox.type).toBe('checkbox');
    });
  });

  it('select-all toggles all session checkboxes', async () => {
    const sessions = [
      createSession({ id: 's1', agentId: 'a1' }),
      createSession({ id: 's2', agentId: 'a2' }),
    ];
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi
        .fn()
        .mockResolvedValue({ sessions, total: 2, limit: 50, offset: 0, hasMore: false }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    renderSessions();
    await waitFor(() => {
      expect(screen.getByText('a1')).toBeDefined();
    });
    const selectAll = document.getElementById('sessions-select-all') as HTMLInputElement;
    fireEvent.click(selectAll);
    // After selecting all, the bulk action bar should show
    await waitFor(() => {
      expect(screen.getByText(/2 selected/)).toBeDefined();
    });
  });

  // =========================================================================
  // Search interaction
  // =========================================================================

  it('search input filters sessions by agentName', async () => {
    const sessions = [
      createSession({ id: 's1', agentName: 'deploy-agent' }),
      createSession({ id: 's2', agentName: 'test-agent' }),
    ];
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi
        .fn()
        .mockResolvedValue({ sessions, total: 2, limit: 50, offset: 0, hasMore: false }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    renderSessions();
    await waitFor(() => {
      expect(screen.getByText('deploy-agent')).toBeDefined();
      expect(screen.getByText('test-agent')).toBeDefined();
    });
    const searchInput = screen.getByPlaceholderText('Search sessions...') as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: 'deploy' } });
    await waitFor(() => {
      expect(screen.getByText('deploy-agent')).toBeDefined();
      expect(screen.queryByText('test-agent')).toBeNull();
    });
  });

  // =========================================================================
  // Select All — deselect
  // =========================================================================

  it('select all checkbox deselects all when clicked twice', async () => {
    const sessions = [
      createSession({ id: 'sa-1', status: 'active' }),
      createSession({ id: 'sa-2', status: 'ended' }),
    ];
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({
        sessions,
        total: sessions.length,
        limit: 50,
        offset: 0,
        hasMore: false,
      }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    renderSessions();
    await waitFor(() => {
      expect(getSessionItems().length).toBe(2);
    });
    const selectAll = document.getElementById('sessions-select-all') as HTMLInputElement;
    fireEvent.click(selectAll);
    await waitFor(() => {
      expect(screen.getByText('2 selected')).toBeDefined();
    });
    fireEvent.click(selectAll);
    await waitFor(() => {
      expect(screen.queryByText('2 selected')).toBeNull();
    });
  });

  // =========================================================================
  // Bulk bar — Clear button
  // =========================================================================

  it('Clear button in bulk bar deselects all checked sessions', async () => {
    const sessions = [createSession({ id: 'cb-1', status: 'active' })];
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi
        .fn()
        .mockResolvedValue({ sessions, total: 1, limit: 50, offset: 0, hasMore: false }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    renderSessions();
    await waitFor(() => {
      expect(getSessionItems().length).toBe(1);
    });
    const selectAll = document.getElementById('sessions-select-all') as HTMLInputElement;
    fireEvent.click(selectAll);
    await waitFor(() => {
      expect(screen.getByText('1 selected')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Clear'));
    await waitFor(() => {
      expect(screen.queryByText('1 selected')).toBeNull();
    });
  });

  // =========================================================================
  // CSV Export Button
  // =========================================================================

  it('CSV button is disabled when no sessions exist', async () => {
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi
        .fn()
        .mockResolvedValue({ sessions: [], total: 0, limit: 50, offset: 0, hasMore: false }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    renderSessions();
    const csvButton = screen.getByText('CSV') as HTMLButtonElement;
    expect(csvButton.disabled).toBe(true);
  });

  it('CSV button is enabled when sessions exist', async () => {
    renderSessions();
    await waitFor(() => {
      const csvButton = screen.getByText('CSV') as HTMLButtonElement;
      expect(csvButton.disabled).toBe(false);
    });
  });

  // =========================================================================
  // Status Tab — Ended (includes paused)
  // =========================================================================

  it('clicking Ended tab filters to ended and paused sessions', async () => {
    const sessions = [
      createSession({ id: 'ef-1', status: 'active', agentName: 'agt-active-ef' }),
      createSession({ id: 'ef-2', status: 'ended', agentName: 'agt-ended-ef' }),
      createSession({ id: 'ef-3', status: 'paused', agentName: 'agt-paused-ef' }),
    ];
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({
        sessions,
        total: sessions.length,
        limit: 50,
        offset: 0,
        hasMore: false,
      }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    renderSessions();
    await waitFor(() => {
      expect(screen.getByText('agt-ended-ef')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Ended'));
    await waitFor(() => {
      expect(screen.getByText('agt-ended-ef')).toBeDefined();
      expect(screen.getByText('agt-paused-ef')).toBeDefined();
      expect(screen.queryByText('agt-active-ef')).toBeNull();
    });
  });

  // =========================================================================
  // Status Tab — All restores full list
  // =========================================================================

  it('clicking All tab restores full list after filtering', async () => {
    const sessions = [
      createSession({ id: 'at-1', status: 'active', agentName: 'agt-active-at' }),
      createSession({ id: 'at-2', status: 'ended', agentName: 'agt-ended-at' }),
    ];
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({
        sessions,
        total: sessions.length,
        limit: 50,
        offset: 0,
        hasMore: false,
      }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    renderSessions();
    await waitFor(() => {
      expect(screen.getByText('agt-active-at')).toBeDefined();
      expect(screen.getByText('agt-ended-at')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Active'));
    await waitFor(() => {
      expect(screen.queryByText('agt-ended-at')).toBeNull();
    });
    const allButtons = screen.getAllByText('All');
    const allTab = allButtons.find((el) => el.closest('button')?.className.includes('border-b-2'));
    expect(allTab).toBeDefined();
    fireEvent.click(allTab as HTMLElement);
    await waitFor(() => {
      expect(screen.getByText('agt-active-at')).toBeDefined();
      expect(screen.getByText('agt-ended-at')).toBeDefined();
    });
  });

  // =========================================================================
  // Search — by project path
  // =========================================================================

  it('search filters sessions by project path', async () => {
    const sessions = [
      createSession({ id: 'sp-1', agentName: 'agt-sp-1', projectPath: '/home/user/web-app' }),
      createSession({ id: 'sp-2', agentName: 'agt-sp-2', projectPath: '/home/user/api-server' }),
    ];
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({
        sessions,
        total: sessions.length,
        limit: 50,
        offset: 0,
        hasMore: false,
      }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    renderSessions();
    await waitFor(() => {
      expect(screen.getByText('agt-sp-1')).toBeDefined();
      expect(screen.getByText('agt-sp-2')).toBeDefined();
    });
    const searchInput = screen.getByPlaceholderText('Search sessions...') as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: 'api-server' } });
    await waitFor(() => {
      expect(screen.getByText('agt-sp-2')).toBeDefined();
      expect(screen.queryByText('agt-sp-1')).toBeNull();
    });
  });

  // =========================================================================
  // Search — by model
  // =========================================================================

  it('search filters sessions by model name', async () => {
    const sessions = [
      createSession({ id: 'sm-1', agentName: 'agt-sm-1', model: 'claude-opus-4-6' }),
      createSession({ id: 'sm-2', agentName: 'agt-sm-2', model: 'claude-haiku-4-5' }),
    ];
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({
        sessions,
        total: sessions.length,
        limit: 50,
        offset: 0,
        hasMore: false,
      }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    renderSessions();
    await waitFor(() => {
      expect(screen.getByText('agt-sm-1')).toBeDefined();
      expect(screen.getByText('agt-sm-2')).toBeDefined();
    });
    const searchInput = screen.getByPlaceholderText('Search sessions...') as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: 'haiku' } });
    await waitFor(() => {
      expect(screen.getByText('agt-sm-2')).toBeDefined();
      expect(screen.queryByText('agt-sm-1')).toBeNull();
    });
  });

  // =========================================================================
  // Search — no results
  // =========================================================================

  it('search with no matches hides all session items', async () => {
    renderSessions();
    await waitFor(() => {
      expect(getSessionItems().length).toBe(1);
    });
    const searchInput = screen.getByPlaceholderText('Search sessions...') as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: 'nonexistent-query-xyz' } });
    await waitFor(() => {
      expect(querySessionItems().length).toBe(0);
    });
  });

  // =========================================================================
  // GroupBy Dropdown
  // =========================================================================

  it('changing group by to project preserves session items', async () => {
    const sessions = [
      createSession({ id: 'gp-1', agentName: 'agt-gp-1', projectPath: '/home/user/proj-a' }),
      createSession({ id: 'gp-2', agentName: 'agt-gp-2', projectPath: '/home/user/proj-b' }),
    ];
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({
        sessions,
        total: sessions.length,
        limit: 50,
        offset: 0,
        hasMore: false,
      }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    renderSessions();
    await waitFor(() => {
      expect(getSessionItems().length).toBe(2);
    });
    const groupSelect = screen.getByLabelText('Group by') as HTMLSelectElement;
    fireEvent.change(groupSelect, { target: { value: 'project' } });
    await waitFor(() => {
      expect(getSessionItems().length).toBe(2);
      expect(groupSelect.value).toBe('project');
    });
  });

  it('changing group by to machine preserves session items', async () => {
    const sessions = [
      createSession({ id: 'gm-1', agentName: 'agt-gm-1', machineId: 'machine-a' }),
      createSession({ id: 'gm-2', agentName: 'agt-gm-2', machineId: 'machine-b' }),
    ];
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({
        sessions,
        total: sessions.length,
        limit: 50,
        offset: 0,
        hasMore: false,
      }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    renderSessions();
    await waitFor(() => {
      expect(getSessionItems().length).toBe(2);
    });
    const groupSelect = screen.getByLabelText('Group by') as HTMLSelectElement;
    fireEvent.change(groupSelect, { target: { value: 'machine' } });
    await waitFor(() => {
      expect(getSessionItems().length).toBe(2);
      expect(groupSelect.value).toBe('machine');
    });
  });

  it('group by dropdown has all options', () => {
    renderSessions();
    const groupSelect = screen.getByLabelText('Group by') as HTMLSelectElement;
    const opts = Array.from(groupSelect.options).map((o) => o.value);
    expect(opts).toEqual(['none', 'project', 'machine', 'agent']);
  });

  // =========================================================================
  // Sort Order Changes
  // =========================================================================

  it('sort order dropdown has all sort options', () => {
    renderSessions();
    const sortSelect = screen.getByLabelText('Sort by') as HTMLSelectElement;
    const opts = Array.from(sortSelect.options).map((o) => o.value);
    expect(opts).toEqual(['newest', 'oldest', 'status', 'cost', 'duration']);
  });

  it('changing sort to oldest reverses session order', async () => {
    const sessions = [
      createSession({ id: 'so-old', agentName: 'agt-old-so', startedAt: '2025-01-01T00:00:00Z' }),
      createSession({ id: 'so-new', agentName: 'agt-new-so', startedAt: '2026-01-01T00:00:00Z' }),
    ];
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({
        sessions,
        total: sessions.length,
        limit: 50,
        offset: 0,
        hasMore: false,
      }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    renderSessions();
    await waitFor(() => {
      expect(getSessionItems().length).toBe(2);
    });
    let items = getSessionItems();
    expect(items[0]?.textContent).toContain('agt-new-so');
    const sortSelect = screen.getByLabelText('Sort by') as HTMLSelectElement;
    fireEvent.change(sortSelect, { target: { value: 'oldest' } });
    await waitFor(() => {
      items = getSessionItems();
      expect(items[0]?.textContent).toContain('agt-old-so');
    });
  });

  it('changing sort to status puts active before error', async () => {
    const sessions = [
      createSession({
        id: 'ss-err',
        agentName: 'agt-error-ss',
        status: 'error',
        startedAt: '2026-01-01T00:00:00Z',
      }),
      createSession({
        id: 'ss-act',
        agentName: 'agt-active-ss',
        status: 'active',
        startedAt: '2025-01-01T00:00:00Z',
      }),
    ];
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({
        sessions,
        total: sessions.length,
        limit: 50,
        offset: 0,
        hasMore: false,
      }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    renderSessions();
    const sortSelect = screen.getByLabelText('Sort by') as HTMLSelectElement;
    fireEvent.change(sortSelect, { target: { value: 'status' } });
    await waitFor(() => {
      const items = getSessionItems();
      expect(items[0]?.textContent).toContain('agt-active-ss');
      expect(items[1]?.textContent).toContain('agt-error-ss');
    });
  });

  // =========================================================================
  // Pagination (Load more)
  // =========================================================================

  it('shows Load more button when hasMore is true', async () => {
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({
        sessions: [createSession()],
        total: 75,
        limit: 50,
        offset: 0,
        hasMore: true,
      }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    renderSessions();
    await waitFor(() => {
      expect(screen.getByText(/Load more/)).toBeDefined();
    });
  });

  it('shows remaining count in Load more button', async () => {
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({
        sessions: [createSession()],
        total: 75,
        limit: 50,
        offset: 0,
        hasMore: true,
      }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    renderSessions();
    await waitFor(() => {
      expect(screen.getByText(/74 remaining/)).toBeDefined();
    });
  });

  it('shows All N sessions loaded when hasMore is false', async () => {
    const sessions = [createSession({ id: 'pg-1' }), createSession({ id: 'pg-2' })];
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({
        sessions,
        total: sessions.length,
        limit: 50,
        offset: 0,
        hasMore: false,
      }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    renderSessions();
    await waitFor(() => {
      expect(screen.getByText(/All 2 sessions loaded/)).toBeDefined();
    });
  });

  it('does not show pagination footer when loading', async () => {
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockReturnValue(new Promise(() => {})),
      dataUpdatedAt: Date.now(),
      isLoading: true,
      isFetching: true,
      refetch: vi.fn(),
    });
    renderSessions();
    expect(screen.queryByText(/Load more/)).toBeNull();
    expect(screen.queryByText(/sessions loaded/)).toBeNull();
  });
});
