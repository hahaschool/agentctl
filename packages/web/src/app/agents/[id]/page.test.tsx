import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Agent, AgentRun, ApiAccount, Machine, Session } from '@/lib/api';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockAgentQuery,
  mockAgentRunsQuery,
  mockSessionsQuery,
  mockAccountsQuery,
  mockMachinesQuery,
  mockStartAgent,
  mockStopAgent,
  mockUpdateAgent,
} = vi.hoisted(() => ({
  mockAgentQuery: vi.fn(),
  mockAgentRunsQuery: vi.fn(),
  mockSessionsQuery: vi.fn(),
  mockAccountsQuery: vi.fn(),
  mockMachinesQuery: vi.fn(),
  mockStartAgent: vi.fn(),
  mockStopAgent: vi.fn(),
  mockUpdateAgent: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock dependencies — BEFORE the component import
// ---------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'agent-1' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href} data-testid={`link-${href}`}>
      {children}
    </a>
  ),
}));

vi.mock('@/hooks/use-hotkeys', () => ({
  useHotkeys: vi.fn(),
}));

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className }: { className: string }) => (
    <div className={className} data-testid="skeleton" />
  ),
}));

vi.mock('@/components/ui/card', () => ({
  Card: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="card" className={className}>{children}</div>
  ),
  CardContent: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  CardHeader: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  CardTitle: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <h3 className={className}>{children}</h3>
  ),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> }) => {
    const { ref: _ref, ...rest } = props;
    return <input {...rest} />;
  },
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    value,
    onValueChange,
    disabled,
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (v: string) => void;
    disabled?: boolean;
  }) => (
    <div data-testid="select" data-value={value} data-disabled={disabled} onClick={() => onValueChange?.('')}>
      {children}
    </div>
  ),
  SelectTrigger: ({ children, ...rest }: { children: React.ReactNode; [k: string]: unknown }) => (
    <div data-testid="select-trigger" {...(rest['aria-label'] ? { 'aria-label': rest['aria-label'] } : {})}>{children}</div>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <div data-testid={`select-item-${value}`}>{children}</div>
  ),
  SelectValue: ({ children, placeholder }: { children?: React.ReactNode; placeholder?: string }) => (
    <span>{children ?? placeholder}</span>
  ),
  SelectSeparator: () => <hr data-testid="select-separator" />,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/Breadcrumb', () => ({
  Breadcrumb: ({ items }: { items: { label: string; href?: string }[] }) => (
    <nav data-testid="breadcrumb" aria-label="Breadcrumb">
      {items.map((item) => (
        <span key={item.label} data-testid={`breadcrumb-${item.label}`}>
          {item.href ? <a href={item.href}>{item.label}</a> : item.label}
        </span>
      ))}
    </nav>
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

vi.mock('@/components/CopyableText', () => ({
  CopyableText: ({ value }: { value: string }) => <span data-testid="copyable-text">{value}</span>,
}));

vi.mock('@/components/ConfirmButton', () => ({
  ConfirmButton: ({ label, onConfirm, disabled }: { label: string; onConfirm: () => void; disabled?: boolean }) => (
    <button type="button" data-testid="confirm-button" onClick={onConfirm} disabled={disabled}>
      {label}
    </button>
  ),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@/lib/queries', () => ({
  agentQuery: (id: string) => mockAgentQuery(id),
  agentRunsQuery: (agentId: string) => mockAgentRunsQuery(agentId),
  sessionsQuery: (params?: Record<string, unknown>) => mockSessionsQuery(params),
  accountsQuery: () => mockAccountsQuery(),
  machinesQuery: () => mockMachinesQuery(),
  useStartAgent: () => mockStartAgent(),
  useStopAgent: () => mockStopAgent(),
  useUpdateAgent: () => mockUpdateAgent(),
}));

// ---------------------------------------------------------------------------
// Import component AFTER mocks
// ---------------------------------------------------------------------------

import AgentDetailPage from './page';

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function createAgent(overrides?: Partial<Agent>): Agent {
  return {
    id: 'agent-1',
    machineId: 'machine-1',
    name: 'test-agent',
    type: 'autonomous',
    status: 'registered',
    schedule: '*/15 * * * *',
    projectPath: '/home/user/project',
    worktreeBranch: 'feat/my-branch',
    currentSessionId: null,
    config: { model: 'claude-sonnet-4-20250514', maxTurns: 50 },
    lastRunAt: '2026-03-05T10:00:00Z',
    lastCostUsd: 0.42,
    totalCostUsd: 12.75,
    accountId: 'account-1',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function createRun(overrides?: Partial<AgentRun>): AgentRun {
  return {
    id: 'run-1',
    agentId: 'agent-1',
    status: 'completed',
    prompt: 'Fix the bug in auth module',
    costUsd: 0.42,
    durationMs: 120000,
    startedAt: '2026-03-05T09:58:00Z',
    endedAt: '2026-03-05T10:00:00Z',
    ...overrides,
  };
}

function createSession(overrides?: Partial<Session>): Session {
  return {
    id: 'session-1',
    agentId: 'agent-1',
    agentName: null,
    machineId: 'machine-1',
    sessionUrl: null,
    claudeSessionId: null,
    status: 'ended',
    projectPath: '/home/user/project',
    pid: 12345,
    startedAt: '2026-03-05T09:58:00Z',
    lastHeartbeat: '2026-03-05T10:00:00Z',
    endedAt: '2026-03-05T10:00:00Z',
    metadata: {},
    accountId: 'account-1',
    model: 'claude-sonnet-4-20250514',
    ...overrides,
  };
}

function createAccount(overrides?: Partial<ApiAccount>): ApiAccount {
  return {
    id: 'account-1',
    name: 'Main Account',
    provider: 'anthropic',
    credentialMasked: 'sk-...abcd',
    priority: 1,
    rateLimit: { itpm: 100000, otpm: 50000 },
    isActive: true,
    metadata: {},
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMutationHook(overrides?: Record<string, unknown>) {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    ...overrides,
  };
}

function makeQueryResult(key: string, data: unknown, overrides?: Record<string, unknown>) {
  return {
    queryKey: [key],
    queryFn: vi.fn().mockResolvedValue(data),
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AgentDetailPage />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockAgentQuery.mockReturnValue(makeQueryResult('agent', createAgent()));
    mockAgentRunsQuery.mockReturnValue(makeQueryResult('agent-runs', [createRun()]));
    mockSessionsQuery.mockReturnValue(
      makeQueryResult('sessions', {
        sessions: [createSession()],
        total: 1,
        limit: 20,
        offset: 0,
        hasMore: false,
      }),
    );
    mockAccountsQuery.mockReturnValue(makeQueryResult('accounts', [createAccount()]));
    mockMachinesQuery.mockReturnValue(makeQueryResult('machines', [createMachine()]));

    mockStartAgent.mockReturnValue(makeMutationHook());
    mockStopAgent.mockReturnValue(makeMutationHook());
    mockUpdateAgent.mockReturnValue(makeMutationHook());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Renders agent name in header with breadcrumb
  // =========================================================================

  it('renders agent name in header', async () => {
    renderPage();
    await waitFor(() => {
      const matches = screen.getAllByText('test-agent');
      expect(matches.length).toBeGreaterThanOrEqual(2); // breadcrumb + h1
    });
  });

  it('renders breadcrumb with Agents link and agent name', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('breadcrumb')).toBeDefined();
      expect(screen.getByTestId('breadcrumb-Agents')).toBeDefined();
      expect(screen.getByTestId('breadcrumb-test-agent')).toBeDefined();
    });
  });

  it('breadcrumb Agents item links to /agents', async () => {
    renderPage();
    await waitFor(() => {
      const agentsLink = screen.getByTestId('breadcrumb-Agents').querySelector('a');
      expect(agentsLink).not.toBeNull();
      expect(agentsLink!.getAttribute('href')).toBe('/agents');
    });
  });

  // =========================================================================
  // 2. Loading skeleton state
  // =========================================================================

  it('shows loading skeletons when agent data is loading', async () => {
    mockAgentQuery.mockReturnValue(makeQueryResult('agent', null, {
      queryFn: vi.fn().mockReturnValue(new Promise(() => {})),
    }));
    renderPage();
    await waitFor(() => {
      const skeletons = screen.getAllByTestId('skeleton');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  it('does not render agent name while loading', async () => {
    mockAgentQuery.mockReturnValue(makeQueryResult('agent', null, {
      queryFn: vi.fn().mockReturnValue(new Promise(() => {})),
    }));
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
    });
    expect(screen.queryByText('test-agent')).toBeNull();
  });

  // =========================================================================
  // 3. Agent info grid (ID, machine, type, schedule, project, branch)
  // =========================================================================

  it('renders Agent Details card', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Agent Details')).toBeDefined();
    });
  });

  it('displays agent ID via CopyableText', async () => {
    renderPage();
    await waitFor(() => {
      const copyables = screen.getAllByTestId('copyable-text');
      const idEl = copyables.find((el) => el.textContent === 'agent-1');
      expect(idEl).toBeDefined();
    });
  });

  it('displays machine hostname as link when machine is found', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('test-machine')).toBeDefined();
      expect(screen.getByTestId('link-/machines/machine-1')).toBeDefined();
    });
  });

  it('displays machine ID via CopyableText when machine is not found', async () => {
    mockMachinesQuery.mockReturnValue(makeQueryResult('machines', []));
    renderPage();
    await waitFor(() => {
      const copyables = screen.getAllByTestId('copyable-text');
      const machineEl = copyables.find((el) => el.textContent === 'machine-1');
      expect(machineEl).toBeDefined();
    });
  });

  it('displays agent type', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('autonomous')).toBeDefined();
    });
  });

  it('displays schedule', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('*/15 * * * *')).toBeDefined();
    });
  });

  it('displays "None" when schedule is null', async () => {
    mockAgentQuery.mockReturnValue(makeQueryResult('agent', createAgent({ schedule: null })));
    renderPage();
    await waitFor(() => {
      // "None" appears in schedule field and account selector
      const nones = screen.getAllByText('None');
      expect(nones.length).toBeGreaterThanOrEqual(1);
      // Verify the schedule-specific one is a font-mono span
      const scheduleNone = nones.find((el) => el.classList.contains('font-mono'));
      expect(scheduleNone).toBeDefined();
    });
  });

  it('displays project path', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('/home/user/project')).toBeDefined();
    });
  });

  it('displays "Not set" when project path is null', async () => {
    mockAgentQuery.mockReturnValue(makeQueryResult('agent', createAgent({ projectPath: null })));
    renderPage();
    await waitFor(() => {
      const notSets = screen.getAllByText('Not set');
      expect(notSets.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('displays worktree branch', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('feat/my-branch')).toBeDefined();
    });
  });

  it('displays "Not set" when worktree branch is null', async () => {
    mockAgentQuery.mockReturnValue(makeQueryResult('agent', createAgent({ worktreeBranch: null })));
    renderPage();
    await waitFor(() => {
      const notSets = screen.getAllByText('Not set');
      expect(notSets.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('displays created date', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Created')).toBeDefined();
    });
  });

  it('displays last run via LiveTimeAgo when present', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Last Run')).toBeDefined();
      const timeAgos = screen.getAllByTestId('time-ago');
      const lastRunEl = timeAgos.find((el) => el.textContent === '2026-03-05T10:00:00Z');
      expect(lastRunEl).toBeDefined();
    });
  });

  it('displays "Never" when last run is null', async () => {
    mockAgentQuery.mockReturnValue(makeQueryResult('agent', createAgent({ lastRunAt: null })));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Never')).toBeDefined();
    });
  });

  it('displays current session link when currentSessionId is set', async () => {
    mockAgentQuery.mockReturnValue(
      makeQueryResult('agent', createAgent({ currentSessionId: 'sess-abc123def456' })),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Current Session')).toBeDefined();
      expect(screen.getByTestId('link-/sessions/sess-abc123def456')).toBeDefined();
    });
  });

  it('does not display current session when currentSessionId is null', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText('test-agent').length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByText('Current Session')).toBeNull();
  });

  // =========================================================================
  // 4. Status badge display
  // =========================================================================

  it('renders status badge for registered agent', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('status-badge-registered')).toBeDefined();
    });
  });

  it('renders status badge for running agent', async () => {
    mockAgentQuery.mockReturnValue(makeQueryResult('agent', createAgent({ status: 'running' })));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('status-badge-running')).toBeDefined();
    });
  });

  it('renders status badge for error agent', async () => {
    mockAgentQuery.mockReturnValue(makeQueryResult('agent', createAgent({ status: 'error' })));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('status-badge-error')).toBeDefined();
    });
  });

  // =========================================================================
  // 5. Start/Stop button behavior
  // =========================================================================

  it('shows Start button for non-running agent', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Start')).toBeDefined();
    });
  });

  it('shows prompt input when Start is clicked', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Start')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Start'));
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Enter prompt...')).toBeDefined();
    });
  });

  it('shows Go and Cancel buttons when prompt is visible', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Start')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Start'));
    await waitFor(() => {
      expect(screen.getByText('Go')).toBeDefined();
      expect(screen.getByText('Cancel')).toBeDefined();
    });
  });

  it('hides prompt input when Cancel is clicked', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Start')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Start'));
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Enter prompt...')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Enter prompt...')).toBeNull();
    });
  });

  it('calls startAgent.mutate when Go is clicked with a prompt', async () => {
    const mutateFn = vi.fn();
    mockStartAgent.mockReturnValue(makeMutationHook({ mutate: mutateFn }));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Start')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Start'));
    const input = screen.getByPlaceholderText('Enter prompt...');
    fireEvent.change(input, { target: { value: 'Run the tests' } });
    fireEvent.click(screen.getByText('Go'));
    expect(mutateFn).toHaveBeenCalledWith(
      { id: 'agent-1', prompt: 'Run the tests' },
      expect.any(Object),
    );
  });

  it('does not call startAgent.mutate when prompt is empty', async () => {
    const mutateFn = vi.fn();
    mockStartAgent.mockReturnValue(makeMutationHook({ mutate: mutateFn }));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Start')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Start'));
    fireEvent.click(screen.getByText('Go'));
    expect(mutateFn).not.toHaveBeenCalled();
  });

  it('disables Go button when prompt is empty', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Start')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Start'));
    const goBtn = screen.getByText('Go');
    expect((goBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows Stop button for running agent', async () => {
    mockAgentQuery.mockReturnValue(makeQueryResult('agent', createAgent({ status: 'running' })));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('confirm-button')).toBeDefined();
      expect(screen.getByText('Stop')).toBeDefined();
    });
  });

  it('calls stopAgent.mutate when Stop is confirmed', async () => {
    const mutateFn = vi.fn();
    mockStopAgent.mockReturnValue(makeMutationHook({ mutate: mutateFn }));
    mockAgentQuery.mockReturnValue(makeQueryResult('agent', createAgent({ status: 'running' })));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('confirm-button')).toBeDefined();
    });
    fireEvent.click(screen.getByTestId('confirm-button'));
    expect(mutateFn).toHaveBeenCalledWith('agent-1', expect.any(Object));
  });

  it('shows "Stopping..." when stopAgent is pending', async () => {
    mockStopAgent.mockReturnValue(makeMutationHook({ isPending: true }));
    mockAgentQuery.mockReturnValue(makeQueryResult('agent', createAgent({ status: 'running' })));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Stopping...')).toBeDefined();
    });
  });

  it('shows "Starting..." when startAgent is pending', async () => {
    mockStartAgent.mockReturnValue(makeMutationHook({ isPending: true }));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Start')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Start'));
    await waitFor(() => {
      expect(screen.getByText('Starting...')).toBeDefined();
    });
  });

  // =========================================================================
  // 6. Edit agent dialog
  // =========================================================================

  it('opens edit dialog when Edit button is clicked', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Edit')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Edit'));
    await waitFor(() => {
      expect(screen.getByTestId('dialog')).toBeDefined();
      expect(screen.getByText('Edit Agent')).toBeDefined();
    });
  });

  it('populates edit dialog with agent name', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Edit')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Edit'));
    await waitFor(() => {
      const nameInput = screen.getByDisplayValue('test-agent') as HTMLInputElement;
      expect(nameInput).toBeDefined();
    });
  });

  it('populates edit dialog with model from config', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Edit')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Edit'));
    await waitFor(() => {
      const modelInput = screen.getByDisplayValue('claude-sonnet-4-20250514') as HTMLInputElement;
      expect(modelInput).toBeDefined();
    });
  });

  it('populates edit dialog with maxTurns from config', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Edit')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Edit'));
    await waitFor(() => {
      const maxTurnsInput = screen.getByDisplayValue('50') as HTMLInputElement;
      expect(maxTurnsInput).toBeDefined();
    });
  });

  it('shows Save Changes and Cancel buttons in edit dialog', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Edit')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Edit'));
    await waitFor(() => {
      expect(screen.getByText('Save Changes')).toBeDefined();
      const cancelButtons = screen.getAllByText('Cancel');
      expect(cancelButtons.length).toBeGreaterThan(0);
    });
  });

  it('calls updateAgent.mutate when Save Changes is clicked', async () => {
    const mutateFn = vi.fn();
    mockUpdateAgent.mockReturnValue(makeMutationHook({ mutate: mutateFn }));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Edit')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Edit'));
    await waitFor(() => {
      expect(screen.getByText('Save Changes')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Save Changes'));
    expect(mutateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'agent-1',
        name: 'test-agent',
      }),
      expect.any(Object),
    );
  });

  it('disables Save Changes when name is empty', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Edit')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Edit'));
    await waitFor(() => {
      expect(screen.getByDisplayValue('test-agent')).toBeDefined();
    });
    const nameInput = screen.getByDisplayValue('test-agent');
    fireEvent.change(nameInput, { target: { value: '' } });
    const saveBtn = screen.getByText('Save Changes') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  it('shows "Saving..." when updateAgent is pending', async () => {
    mockUpdateAgent.mockReturnValue(makeMutationHook({ isPending: true }));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Edit')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Edit'));
    await waitFor(() => {
      expect(screen.getByText('Saving...')).toBeDefined();
    });
  });

  it('shows schedule field when type is autonomous', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Edit')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Edit'));
    await waitFor(() => {
      expect(screen.getByLabelText('Schedule')).toBeDefined();
    });
  });

  it('shows model and max turns fields in edit dialog', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Edit')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Edit'));
    await waitFor(() => {
      expect(screen.getByLabelText('Model')).toBeDefined();
      expect(screen.getByLabelText('Max turns')).toBeDefined();
    });
  });

  // =========================================================================
  // 7. Sessions list for this agent
  // =========================================================================

  it('renders Sessions card', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Sessions')).toBeDefined();
    });
  });

  it('renders session links', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('link-/sessions/session-1')).toBeDefined();
    });
  });

  it('renders session status badges', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('status-badge-ended')).toBeDefined();
    });
  });

  it('shows empty state when no sessions exist', async () => {
    mockSessionsQuery.mockReturnValue(
      makeQueryResult('sessions', {
        sessions: [],
        total: 0,
        limit: 20,
        offset: 0,
        hasMore: false,
      }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No sessions found for this agent.')).toBeDefined();
    });
  });

  it('renders multiple sessions', async () => {
    mockSessionsQuery.mockReturnValue(
      makeQueryResult('sessions', {
        sessions: [
          createSession({ id: 'session-1', status: 'ended' }),
          createSession({ id: 'session-2', status: 'running' }),
        ],
        total: 2,
        limit: 20,
        offset: 0,
        hasMore: false,
      }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('link-/sessions/session-1')).toBeDefined();
      expect(screen.getByTestId('link-/sessions/session-2')).toBeDefined();
    });
  });

  it('shows error banner when sessions query fails', async () => {
    mockSessionsQuery.mockReturnValue(
      makeQueryResult('sessions', null, {
        queryFn: vi.fn().mockRejectedValue(new Error('Sessions fetch failed')),
      }),
    );
    renderPage();
    await waitFor(() => {
      const banners = screen.getAllByTestId('error-banner');
      const sessionBanner = banners.find((el) => el.textContent?.includes('sessions'));
      expect(sessionBanner).toBeDefined();
    });
  });

  // =========================================================================
  // 8. Recent runs table
  // =========================================================================

  it('renders Recent Runs card', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Recent Runs')).toBeDefined();
    });
  });

  it('renders runs table with column headers', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Status', { selector: 'th' })).toBeDefined();
      expect(screen.getByText('Prompt', { selector: 'th' })).toBeDefined();
      expect(screen.getByText('Duration', { selector: 'th' })).toBeDefined();
      expect(screen.getByText('Cost', { selector: 'th' })).toBeDefined();
    });
  });

  it('renders run prompt text', async () => {
    renderPage();
    await waitFor(() => {
      // Appears in both mobile card and desktop table layouts
      const matches = screen.getAllByText('Fix the bug in auth module');
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('truncates long prompts', async () => {
    const longPrompt = 'A'.repeat(80);
    mockAgentRunsQuery.mockReturnValue(
      makeQueryResult('agent-runs', [createRun({ prompt: longPrompt })]),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(`${'A'.repeat(50)}...`)).toBeDefined();
    });
  });

  it('renders run status badge', async () => {
    renderPage();
    await waitFor(() => {
      // Appears in both mobile card and desktop table layouts
      const badges = screen.getAllByTestId('status-badge-completed');
      expect(badges.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows empty state when no runs exist', async () => {
    mockAgentRunsQuery.mockReturnValue(makeQueryResult('agent-runs', []));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/No runs recorded yet/)).toBeDefined();
    });
  });

  it('renders run cost', async () => {
    renderPage();
    await waitFor(() => {
      // Cost appears in run table/cards and last-run cost card
      const costs = screen.getAllByText('$0.42');
      expect(costs.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders run error message when present', async () => {
    mockAgentRunsQuery.mockReturnValue(
      makeQueryResult('agent-runs', [createRun({ errorMessage: 'Rate limit exceeded' })]),
    );
    renderPage();
    await waitFor(() => {
      // Error appears in both mobile card and desktop table layouts
      const errors = screen.getAllByText('Rate limit exceeded');
      expect(errors.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows "In progress" for runs without endedAt', async () => {
    mockAgentRunsQuery.mockReturnValue(
      makeQueryResult('agent-runs', [createRun({ endedAt: undefined })]),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('In progress')).toBeDefined();
    });
  });

  it('shows error banner when runs query fails', async () => {
    mockAgentRunsQuery.mockReturnValue(
      makeQueryResult('agent-runs', null, {
        queryFn: vi.fn().mockRejectedValue(new Error('Runs fetch failed')),
      }),
    );
    renderPage();
    await waitFor(() => {
      const banners = screen.getAllByTestId('error-banner');
      const runsBanner = banners.find((el) => el.textContent?.includes('runs'));
      expect(runsBanner).toBeDefined();
    });
  });

  it('renders multiple runs', async () => {
    mockAgentRunsQuery.mockReturnValue(
      makeQueryResult('agent-runs', [
        createRun({ id: 'run-1', status: 'completed' }),
        createRun({ id: 'run-2', status: 'failed', errorMessage: 'Timeout' }),
      ]),
    );
    renderPage();
    await waitFor(() => {
      // Each status appears in both mobile card and desktop table
      const completed = screen.getAllByTestId('status-badge-completed');
      const failed = screen.getAllByTestId('status-badge-failed');
      expect(completed.length).toBeGreaterThanOrEqual(1);
      expect(failed.length).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // 9. Cost cards (last run, total)
  // =========================================================================

  it('renders last run cost card', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Last Run Cost')).toBeDefined();
      // $0.42 appears in cost card and run table
      const costs = screen.getAllByText('$0.42');
      expect(costs.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders total cost card', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Total Cost')).toBeDefined();
      expect(screen.getByText('$12.75')).toBeDefined();
    });
  });

  it('renders $0.00 for null lastCostUsd', async () => {
    mockAgentQuery.mockReturnValue(makeQueryResult('agent', createAgent({ lastCostUsd: null })));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Last Run Cost')).toBeDefined();
    });
    const costCards = screen.getAllByText('$0.00');
    expect(costCards.length).toBeGreaterThanOrEqual(1);
  });

  // =========================================================================
  // 10. Account selector
  // =========================================================================

  it('renders account selector', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Account')).toBeDefined();
      expect(screen.getByLabelText('Select account')).toBeDefined();
    });
  });

  it('renders account items in selector', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('select-item-account-1')).toBeDefined();
      expect(screen.getByText('Main Account')).toBeDefined();
    });
  });

  it('renders "None" option in account selector', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('select-item-__none__')).toBeDefined();
    });
  });

  it('renders multiple accounts in selector', async () => {
    mockAccountsQuery.mockReturnValue(
      makeQueryResult('accounts', [
        createAccount({ id: 'account-1', name: 'Primary' }),
        createAccount({ id: 'account-2', name: 'Backup', provider: 'bedrock' }),
      ]),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('select-item-account-1')).toBeDefined();
      expect(screen.getByTestId('select-item-account-2')).toBeDefined();
      expect(screen.getByText('Primary')).toBeDefined();
      expect(screen.getByText('Backup')).toBeDefined();
    });
  });

  it('renders separator when accounts exist', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('select-separator')).toBeDefined();
    });
  });

  it('does not render separator when no accounts exist', async () => {
    mockAccountsQuery.mockReturnValue(makeQueryResult('accounts', []));
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText('test-agent').length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByTestId('select-separator')).toBeNull();
  });

  // =========================================================================
  // 11. Error state
  // =========================================================================

  it('displays error banner when agent query fails', async () => {
    mockAgentQuery.mockReturnValue(
      makeQueryResult('agent', null, {
        queryFn: vi.fn().mockRejectedValue(new Error('Agent not found')),
      }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('error-banner')).toBeDefined();
      expect(screen.getByText(/Failed to load agent: Agent not found/)).toBeDefined();
    });
  });

  it('error state shows breadcrumb with Error label', async () => {
    mockAgentQuery.mockReturnValue(
      makeQueryResult('agent', null, {
        queryFn: vi.fn().mockRejectedValue(new Error('Network error')),
      }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('breadcrumb-Error')).toBeDefined();
    });
  });

  it('error state has retry button', async () => {
    mockAgentQuery.mockReturnValue(
      makeQueryResult('agent', null, {
        queryFn: vi.fn().mockRejectedValue(new Error('Timeout')),
      }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Retry')).toBeDefined();
    });
  });

  it('shows "Agent not found" when data is null after load', async () => {
    mockAgentQuery.mockReturnValue(makeQueryResult('agent', null));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Agent not found.')).toBeDefined();
    });
  });

  // =========================================================================
  // Additional: Refresh button and fetching bar
  // =========================================================================

  it('renders refresh button', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('refresh-button')).toBeDefined();
    });
  });

  it('renders fetching bar', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('fetching-bar')).toBeDefined();
    });
  });

  it('renders last updated timestamp', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('last-updated')).toBeDefined();
    });
  });

  it('renders runs table aria-label', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText('Recent agent runs')).toBeDefined();
    });
  });

  // =========================================================================
  // 12. Prompt input keyboard shortcuts
  // =========================================================================

  it('hides prompt input when Escape is pressed', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Start')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Start'));
    const input = await waitFor(() => screen.getByPlaceholderText('Enter prompt...'));
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Enter prompt...')).toBeNull();
    });
  });

  it('calls startAgent.mutate on Enter key in prompt input', async () => {
    const mutateFn = vi.fn();
    mockStartAgent.mockReturnValue(makeMutationHook({ mutate: mutateFn }));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Start')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Start'));
    const input = screen.getByPlaceholderText('Enter prompt...');
    fireEvent.change(input, { target: { value: 'Build feature' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mutateFn).toHaveBeenCalledWith(
      { id: 'agent-1', prompt: 'Build feature' },
      expect.any(Object),
    );
  });

  it('does not call startAgent.mutate on Enter with empty prompt', async () => {
    const mutateFn = vi.fn();
    mockStartAgent.mockReturnValue(makeMutationHook({ mutate: mutateFn }));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Start')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Start'));
    const input = screen.getByPlaceholderText('Enter prompt...');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mutateFn).not.toHaveBeenCalled();
  });

  // =========================================================================
  // 13. Edit dialog close and machine handling
  // =========================================================================

  it('closes edit dialog when Cancel button is clicked', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Edit')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Edit'));
    await waitFor(() => {
      expect(screen.getByTestId('dialog')).toBeDefined();
    });
    // Click Cancel in the dialog footer
    const cancelButtons = screen.getAllByText('Cancel');
    fireEvent.click(cancelButtons[cancelButtons.length - 1]);
    await waitFor(() => {
      expect(screen.queryByTestId('dialog')).toBeNull();
    });
  });

  it('shows "No machines available" in edit dialog when machine list is empty', async () => {
    mockMachinesQuery.mockReturnValue(makeQueryResult('machines', []));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Edit')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Edit'));
    await waitFor(() => {
      expect(screen.getByText('No machines available')).toBeDefined();
    });
  });

  it('shows machine select items when machines are available', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Edit')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Edit'));
    await waitFor(() => {
      expect(screen.getByTestId('select-item-machine-1')).toBeDefined();
    });
  });

  it('updateAgent.mutate includes config with model when provided', async () => {
    const mutateFn = vi.fn();
    mockUpdateAgent.mockReturnValue(makeMutationHook({ mutate: mutateFn }));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Edit')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Edit'));
    await waitFor(() => {
      expect(screen.getByDisplayValue('claude-sonnet-4-20250514')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Save Changes'));
    expect(mutateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          model: 'claude-sonnet-4-20250514',
          maxTurns: 50,
        }),
      }),
      expect.any(Object),
    );
  });

  it('updateAgent.mutate removes model from config when cleared', async () => {
    const mutateFn = vi.fn();
    mockUpdateAgent.mockReturnValue(makeMutationHook({ mutate: mutateFn }));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Edit')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Edit'));
    const modelInput = await waitFor(() => screen.getByDisplayValue('claude-sonnet-4-20250514'));
    fireEvent.change(modelInput, { target: { value: '' } });
    fireEvent.click(screen.getByText('Save Changes'));
    const callArgs = mutateFn.mock.calls[0][0];
    expect(callArgs.config.model).toBeUndefined();
  });

  it('updateAgent.mutate removes maxTurns from config when cleared', async () => {
    const mutateFn = vi.fn();
    mockUpdateAgent.mockReturnValue(makeMutationHook({ mutate: mutateFn }));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Edit')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Edit'));
    const maxTurnsInput = await waitFor(() => screen.getByDisplayValue('50'));
    fireEvent.change(maxTurnsInput, { target: { value: '' } });
    fireEvent.click(screen.getByText('Save Changes'));
    const callArgs = mutateFn.mock.calls[0][0];
    expect(callArgs.config.maxTurns).toBeUndefined();
  });

  it('does not call updateAgent.mutate when name is whitespace only', async () => {
    const mutateFn = vi.fn();
    mockUpdateAgent.mockReturnValue(makeMutationHook({ mutate: mutateFn }));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Edit')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Edit'));
    const nameInput = await waitFor(() => screen.getByDisplayValue('test-agent'));
    fireEvent.change(nameInput, { target: { value: '   ' } });
    fireEvent.click(screen.getByText('Save Changes'));
    expect(mutateFn).not.toHaveBeenCalled();
  });

  it('passes schedule as null when schedule input is empty', async () => {
    const mutateFn = vi.fn();
    mockUpdateAgent.mockReturnValue(makeMutationHook({ mutate: mutateFn }));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Edit')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Edit'));
    const scheduleInput = await waitFor(() => screen.getByDisplayValue('*/15 * * * *'));
    fireEvent.change(scheduleInput, { target: { value: '' } });
    fireEvent.click(screen.getByText('Save Changes'));
    expect(mutateFn).toHaveBeenCalledWith(
      expect.objectContaining({ schedule: null }),
      expect.any(Object),
    );
  });

  // =========================================================================
  // 14. Prompt input aria-label
  // =========================================================================

  it('prompt input has accessible label', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Start')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Start'));
    await waitFor(() => {
      expect(screen.getByLabelText('Prompt to start agent')).toBeDefined();
    });
  });

  // =========================================================================
  // 15. Runs and session loading skeletons
  // =========================================================================

  it('shows run skeletons when runs are loading', async () => {
    mockAgentRunsQuery.mockReturnValue(makeQueryResult('agent-runs', null, {
      queryFn: vi.fn().mockReturnValue(new Promise(() => {})),
    }));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Recent Runs')).toBeDefined();
      const skeletons = screen.getAllByTestId('skeleton');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  it('shows session skeletons when sessions are loading', async () => {
    mockSessionsQuery.mockReturnValue(makeQueryResult('sessions', null, {
      queryFn: vi.fn().mockReturnValue(new Promise(() => {})),
    }));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Sessions')).toBeDefined();
      const skeletons = screen.getAllByTestId('skeleton');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 16. Edge cases
  // =========================================================================

  it('handles agent with empty config object', async () => {
    mockAgentQuery.mockReturnValue(makeQueryResult('agent', createAgent({ config: {} })));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Edit')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Edit'));
    await waitFor(() => {
      const modelInput = screen.getByLabelText('Model') as HTMLInputElement;
      expect(modelInput.value).toBe('');
    });
  });

  it('renders session with duration when both startedAt and endedAt exist', async () => {
    mockSessionsQuery.mockReturnValue(
      makeQueryResult('sessions', {
        sessions: [
          createSession({
            startedAt: '2026-03-05T12:00:00Z',
            endedAt: '2026-03-05T12:05:00Z',
          }),
        ],
        total: 1,
        limit: 20,
        offset: 0,
        hasMore: false,
      }),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('link-/sessions/session-1')).toBeDefined();
    });
  });

  it('renders run with no prompt as dash', async () => {
    mockAgentRunsQuery.mockReturnValue(
      makeQueryResult('agent-runs', [createRun({ prompt: undefined })]),
    );
    renderPage();
    await waitFor(() => {
      const dashes = screen.getAllByText('-');
      expect(dashes.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('Go button is enabled when prompt has text', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Start')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Start'));
    const input = screen.getByPlaceholderText('Enter prompt...');
    fireEvent.change(input, { target: { value: 'Do something' } });
    const goBtn = screen.getByText('Go') as HTMLButtonElement;
    expect(goBtn.disabled).toBe(false);
  });
});
