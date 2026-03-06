import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Agent, Machine } from '@/lib/api';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockAgentsQuery,
  mockMachinesQuery,
  mockSessionsQuery,
  mockCreateAgent,
  mockStartAgent,
  mockStopAgent,
  mockUpdateAgent,
} = vi.hoisted(() => ({
  mockAgentsQuery: vi.fn(),
  mockMachinesQuery: vi.fn(),
  mockSessionsQuery: vi.fn(),
  mockCreateAgent: vi.fn(),
  mockStartAgent: vi.fn(),
  mockStopAgent: vi.fn(),
  mockUpdateAgent: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock dependencies
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
  Select: ({ children, value, onValueChange }: { children: React.ReactNode; value?: string; onValueChange?: (v: string) => void }) => (
    <div data-testid="select" data-value={value} onClick={() => onValueChange?.('')}>
      {children}
    </div>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <div data-testid={`select-item-${value}`}>{children}</div>
  ),
  SelectValue: ({ children, placeholder }: { children?: React.ReactNode; placeholder?: string }) => (
    <span>{children ?? placeholder}</span>
  ),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
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

vi.mock('@/components/StatCard', () => ({
  StatCard: ({ label, value }: { label: string; value: string }) => (
    <div data-testid={`stat-card-${label}`}>
      <div>{label}</div>
      <div data-testid={`stat-value-${label}`}>{value}</div>
    </div>
  ),
}));

vi.mock('@/components/StatusBadge', () => ({
  StatusBadge: ({ status }: { status: string }) => (
    <span data-testid={`status-badge-${status}`}>{status}</span>
  ),
}));

vi.mock('@/components/ConfirmButton', () => ({
  ConfirmButton: ({ label, onConfirm, disabled }: { label: string; onConfirm: () => void; disabled?: boolean }) => (
    <button type="button" data-testid="confirm-button" onClick={onConfirm} disabled={disabled}>
      {label}
    </button>
  ),
}));

vi.mock('@/components/EmptyState', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <span>{title}</span>
      {description && <span>{description}</span>}
    </div>
  ),
}));

vi.mock('@/components/CopyableText', () => ({
  CopyableText: ({ value }: { value: string }) => <span data-testid="copyable-text">{value}</span>,
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@/lib/queries', () => ({
  agentsQuery: () => mockAgentsQuery(),
  machinesQuery: () => mockMachinesQuery(),
  sessionsQuery: (params?: Record<string, unknown>) => mockSessionsQuery(params),
  useCreateAgent: () => mockCreateAgent(),
  useStartAgent: () => mockStartAgent(),
  useStopAgent: () => mockStopAgent(),
  useUpdateAgent: () => mockUpdateAgent(),
}));

// ---------------------------------------------------------------------------
// Import component AFTER mocks
// ---------------------------------------------------------------------------

import { AgentsPage } from './AgentsPage';

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

function createAgent(overrides?: Partial<Agent>): Agent {
  return {
    id: 'agent-1',
    machineId: 'machine-1',
    name: 'test-agent',
    type: 'manual',
    status: 'registered',
    schedule: null,
    projectPath: '/tmp/project',
    worktreeBranch: 'main',
    currentSessionId: null,
    config: {},
    lastRunAt: null,
    lastCostUsd: 0.01,
    totalCostUsd: 1.5,
    accountId: 'account-1',
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

function renderAgentsPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AgentsPage />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: vi.fn().mockResolvedValue([createAgent()]),
    });

    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([createMachine()]),
    });

    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({ sessions: [], total: 0, limit: 100, offset: 0, hasMore: false }),
    });

    mockCreateAgent.mockReturnValue(makeMutationHook());
    mockStartAgent.mockReturnValue(makeMutationHook());
    mockStopAgent.mockReturnValue(makeMutationHook());
    mockUpdateAgent.mockReturnValue(makeMutationHook());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Renders page heading and description
  // =========================================================================

  it('renders page heading', async () => {
    renderAgentsPage();
    expect(screen.getByText('Agents')).toBeDefined();
  });

  it('renders agent count description', async () => {
    renderAgentsPage();
    await waitFor(() => {
      expect(screen.getByText(/1 agent registered/)).toBeDefined();
    });
  });

  it('renders pluralized description for multiple agents', async () => {
    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: vi.fn().mockResolvedValue([
        createAgent({ id: 'agent-1', name: 'agent-1' }),
        createAgent({ id: 'agent-2', name: 'agent-2' }),
      ]),
    });
    renderAgentsPage();
    await waitFor(() => {
      expect(screen.getByText(/2 agents registered/)).toBeDefined();
    });
  });

  it('renders New Task button', () => {
    renderAgentsPage();
    expect(screen.getByText('New Task')).toBeDefined();
  });

  it('renders refresh button', () => {
    renderAgentsPage();
    expect(screen.getByTestId('refresh-button')).toBeDefined();
  });

  it('renders last updated timestamp', () => {
    renderAgentsPage();
    expect(screen.getByTestId('last-updated')).toBeDefined();
  });

  // =========================================================================
  // 2. Shows loading skeleton state
  // =========================================================================

  it('shows loading skeletons when agents are loading', async () => {
    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: vi.fn().mockReturnValue(new Promise(() => {})),
    });
    renderAgentsPage();
    await waitFor(() => {
      const skeletons = screen.getAllByTestId('skeleton');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  it('renders fetching bar component', () => {
    renderAgentsPage();
    expect(screen.getByTestId('fetching-bar')).toBeDefined();
  });

  // =========================================================================
  // 3. Renders agent cards with correct data
  // =========================================================================

  it('renders agent name as link', async () => {
    renderAgentsPage();
    await waitFor(() => {
      expect(screen.getByText('test-agent')).toBeDefined();
      expect(screen.getByTestId('link-/agents/agent-1')).toBeDefined();
    });
  });

  it('renders agent type', async () => {
    renderAgentsPage();
    await waitFor(() => {
      expect(screen.getByText('manual')).toBeDefined();
    });
  });

  it('renders agent ID as copyable text', async () => {
    renderAgentsPage();
    await waitFor(() => {
      const copyables = screen.getAllByTestId('copyable-text');
      const idCopyable = copyables.find((el) => el.textContent === 'agent-1');
      expect(idCopyable).toBeDefined();
    });
  });

  it('renders agent machine ID as copyable text', async () => {
    renderAgentsPage();
    await waitFor(() => {
      const copyables = screen.getAllByTestId('copyable-text');
      const machineCopyable = copyables.find((el) => el.textContent === 'machine-1');
      expect(machineCopyable).toBeDefined();
    });
  });

  it('renders agent cost info', async () => {
    renderAgentsPage();
    await waitFor(() => {
      expect(screen.getByText(/Last: \$0\.01/)).toBeDefined();
      expect(screen.getByText(/Total: \$1\.50/)).toBeDefined();
    });
  });

  it('shows "never run" for agents without lastRunAt', async () => {
    renderAgentsPage();
    await waitFor(() => {
      expect(screen.getByText('never run')).toBeDefined();
    });
  });

  it('shows LiveTimeAgo for agents with lastRunAt', async () => {
    const lastRun = new Date().toISOString();
    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: vi.fn().mockResolvedValue([createAgent({ lastRunAt: lastRun })]),
    });
    renderAgentsPage();
    await waitFor(() => {
      expect(screen.getByTestId('time-ago')).toBeDefined();
    });
  });

  it('renders project path when present', async () => {
    renderAgentsPage();
    await waitFor(() => {
      expect(screen.getByText('/tmp/project')).toBeDefined();
    });
  });

  it('renders worktree branch when present', async () => {
    renderAgentsPage();
    await waitFor(() => {
      expect(screen.getByText('main')).toBeDefined();
    });
  });

  it('renders schedule when present', async () => {
    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: vi.fn().mockResolvedValue([
        createAgent({ schedule: '*/30 * * * *' }),
      ]),
    });
    renderAgentsPage();
    await waitFor(() => {
      expect(screen.getByText('*/30 * * * *')).toBeDefined();
    });
  });

  it('renders multiple agent cards', async () => {
    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: vi.fn().mockResolvedValue([
        createAgent({ id: 'agent-1', name: 'alpha-agent' }),
        createAgent({ id: 'agent-2', name: 'beta-agent' }),
        createAgent({ id: 'agent-3', name: 'gamma-agent' }),
      ]),
    });
    renderAgentsPage();
    await waitFor(() => {
      expect(screen.getByText('alpha-agent')).toBeDefined();
      expect(screen.getByText('beta-agent')).toBeDefined();
      expect(screen.getByText('gamma-agent')).toBeDefined();
    });
  });

  // =========================================================================
  // 4. Create new agent dialog
  // =========================================================================

  it('opens create dialog when New Task button is clicked', async () => {
    renderAgentsPage();
    const newTaskBtn = screen.getByText('New Task');
    fireEvent.click(newTaskBtn);
    await waitFor(() => {
      expect(screen.getByText('New Task', { selector: 'h2' })).toBeDefined();
    });
  });

  it('shows prompt textarea in create dialog', async () => {
    renderAgentsPage();
    fireEvent.click(screen.getByText('New Task'));
    await waitFor(() => {
      expect(screen.getByPlaceholderText('What do you want the agent to do?')).toBeDefined();
    });
  });

  it('shows project input in create dialog', async () => {
    renderAgentsPage();
    fireEvent.click(screen.getByText('New Task'));
    await waitFor(() => {
      expect(screen.getByLabelText('Project')).toBeDefined();
    });
  });

  it('shows machine selector in create dialog', async () => {
    renderAgentsPage();
    fireEvent.click(screen.getByText('New Task'));
    await waitFor(() => {
      // The Machine label is associated with a Radix Select (not a native input),
      // so we look for the label text directly.
      expect(screen.getByText('Machine')).toBeDefined();
    });
  });

  it('shows Advanced toggle in create dialog', async () => {
    renderAgentsPage();
    fireEvent.click(screen.getByText('New Task'));
    await waitFor(() => {
      expect(screen.getByText('Advanced')).toBeDefined();
    });
  });

  it('shows Start Agent and Cancel buttons in create dialog', async () => {
    renderAgentsPage();
    fireEvent.click(screen.getByText('New Task'));
    await waitFor(() => {
      expect(screen.getByText('Start Agent')).toBeDefined();
      expect(screen.getByText('Cancel')).toBeDefined();
    });
  });

  // =========================================================================
  // 5. Edit agent functionality
  // =========================================================================

  it('opens edit dialog when Edit button is clicked', async () => {
    renderAgentsPage();
    await waitFor(() => {
      expect(screen.getByLabelText('Edit agent test-agent')).toBeDefined();
    });
    fireEvent.click(screen.getByLabelText('Edit agent test-agent'));
    await waitFor(() => {
      expect(screen.getByText('Edit Agent')).toBeDefined();
    });
  });

  it('populates edit dialog with agent data', async () => {
    renderAgentsPage();
    await waitFor(() => {
      expect(screen.getByLabelText('Edit agent test-agent')).toBeDefined();
    });
    fireEvent.click(screen.getByLabelText('Edit agent test-agent'));
    await waitFor(() => {
      const nameInput = screen.getByDisplayValue('test-agent') as HTMLInputElement;
      expect(nameInput).toBeDefined();
    });
  });

  it('shows Save Changes button in edit dialog', async () => {
    renderAgentsPage();
    await waitFor(() => {
      expect(screen.getByLabelText('Edit agent test-agent')).toBeDefined();
    });
    fireEvent.click(screen.getByLabelText('Edit agent test-agent'));
    await waitFor(() => {
      expect(screen.getByText('Save Changes')).toBeDefined();
    });
  });

  it('shows Cancel button in edit dialog', async () => {
    renderAgentsPage();
    await waitFor(() => {
      expect(screen.getByLabelText('Edit agent test-agent')).toBeDefined();
    });
    fireEvent.click(screen.getByLabelText('Edit agent test-agent'));
    await waitFor(() => {
      // There will be a Cancel in the edit dialog
      const cancelButtons = screen.getAllByText('Cancel');
      expect(cancelButtons.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 6. Status badges for running/stopped/error agents
  // =========================================================================

  it('renders status badge for registered agent', async () => {
    renderAgentsPage();
    await waitFor(() => {
      expect(screen.getByTestId('status-badge-registered')).toBeDefined();
    });
  });

  it('renders status badge for running agent', async () => {
    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: vi.fn().mockResolvedValue([createAgent({ status: 'running' })]),
    });
    renderAgentsPage();
    await waitFor(() => {
      expect(screen.getByTestId('status-badge-running')).toBeDefined();
    });
  });

  it('renders status badge for error agent', async () => {
    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: vi.fn().mockResolvedValue([createAgent({ status: 'error' })]),
    });
    renderAgentsPage();
    await waitFor(() => {
      expect(screen.getByTestId('status-badge-error')).toBeDefined();
    });
  });

  it('renders status badge for stopped agent', async () => {
    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: vi.fn().mockResolvedValue([createAgent({ status: 'stopped' })]),
    });
    renderAgentsPage();
    await waitFor(() => {
      expect(screen.getByTestId('status-badge-stopped')).toBeDefined();
    });
  });

  it('renders mixed status badges', async () => {
    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: vi.fn().mockResolvedValue([
        createAgent({ id: 'a1', name: 'a1', status: 'running' }),
        createAgent({ id: 'a2', name: 'a2', status: 'error' }),
        createAgent({ id: 'a3', name: 'a3', status: 'registered' }),
      ]),
    });
    renderAgentsPage();
    await waitFor(() => {
      expect(screen.getByTestId('status-badge-running')).toBeDefined();
      expect(screen.getByTestId('status-badge-error')).toBeDefined();
      expect(screen.getByTestId('status-badge-registered')).toBeDefined();
    });
  });

  // =========================================================================
  // 7. Agent actions (start, stop)
  // =========================================================================

  it('shows Start button for non-running agents', async () => {
    renderAgentsPage();
    await waitFor(() => {
      expect(screen.getByText('Start')).toBeDefined();
    });
  });

  it('shows Stop button for running agents', async () => {
    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: vi.fn().mockResolvedValue([createAgent({ status: 'running' })]),
    });
    renderAgentsPage();
    await waitFor(() => {
      expect(screen.getByTestId('confirm-button')).toBeDefined();
      expect(screen.getByText('Stop')).toBeDefined();
    });
  });

  it('shows prompt input when Start is clicked', async () => {
    renderAgentsPage();
    await waitFor(() => {
      expect(screen.getByText('Start')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Start'));
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Enter prompt...')).toBeDefined();
    });
  });

  it('shows Go and Cancel buttons when prompt input is visible', async () => {
    renderAgentsPage();
    await waitFor(() => {
      expect(screen.getByText('Start')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Start'));
    await waitFor(() => {
      expect(screen.getByText('Go')).toBeDefined();
      expect(screen.getByLabelText('Cancel agent start')).toBeDefined();
    });
  });

  it('hides prompt input when Cancel is clicked', async () => {
    renderAgentsPage();
    await waitFor(() => {
      expect(screen.getByText('Start')).toBeDefined();
    });
    fireEvent.click(screen.getByText('Start'));
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Enter prompt...')).toBeDefined();
    });
    fireEvent.click(screen.getByLabelText('Cancel agent start'));
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Enter prompt...')).toBeNull();
    });
  });

  it('calls stopAgent.mutate when Stop is confirmed', async () => {
    const mutateFn = vi.fn();
    mockStopAgent.mockReturnValue(makeMutationHook({ mutate: mutateFn }));
    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: vi.fn().mockResolvedValue([createAgent({ status: 'running' })]),
    });
    renderAgentsPage();
    await waitFor(() => {
      expect(screen.getByTestId('confirm-button')).toBeDefined();
    });
    fireEvent.click(screen.getByTestId('confirm-button'));
    expect(mutateFn).toHaveBeenCalled();
  });

  // =========================================================================
  // 8. Search / filter
  // =========================================================================

  it('renders search input', () => {
    renderAgentsPage();
    expect(screen.getByPlaceholderText('Search agents...')).toBeDefined();
  });

  it('renders status filter dropdown', () => {
    renderAgentsPage();
    const filterSelect = screen.getByLabelText('Filter by status') as HTMLSelectElement;
    expect(filterSelect).toBeDefined();
    expect(filterSelect.value).toBe('all');
  });

  it('renders sort order dropdown', () => {
    renderAgentsPage();
    const sortSelect = screen.getByLabelText('Sort order') as HTMLSelectElement;
    expect(sortSelect).toBeDefined();
    expect(sortSelect.value).toBe('name');
  });

  it('filters agents by search text', async () => {
    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: vi.fn().mockResolvedValue([
        createAgent({ id: 'agent-1', name: 'alpha-agent' }),
        createAgent({ id: 'agent-2', name: 'beta-agent' }),
      ]),
    });
    renderAgentsPage();
    await waitFor(() => {
      expect(screen.getByText('alpha-agent')).toBeDefined();
      expect(screen.getByText('beta-agent')).toBeDefined();
    });
    const searchInput = screen.getByPlaceholderText('Search agents...');
    fireEvent.change(searchInput, { target: { value: 'alpha' } });
    await waitFor(() => {
      expect(screen.getByText('alpha-agent')).toBeDefined();
      expect(screen.queryByText('beta-agent')).toBeNull();
    });
  });

  it('filters agents by status', async () => {
    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: vi.fn().mockResolvedValue([
        createAgent({ id: 'agent-1', name: 'running-agent', status: 'running' }),
        createAgent({ id: 'agent-2', name: 'stopped-agent', status: 'stopped' }),
      ]),
    });
    renderAgentsPage();
    await waitFor(() => {
      expect(screen.getByText('running-agent')).toBeDefined();
      expect(screen.getByText('stopped-agent')).toBeDefined();
    });
    const filterSelect = screen.getByLabelText('Filter by status');
    fireEvent.change(filterSelect, { target: { value: 'running' } });
    await waitFor(() => {
      expect(screen.getByText('running-agent')).toBeDefined();
      expect(screen.queryByText('stopped-agent')).toBeNull();
    });
  });

  it('shows agent count after filtering', async () => {
    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: vi.fn().mockResolvedValue([
        createAgent({ id: 'agent-1', name: 'alpha' }),
        createAgent({ id: 'agent-2', name: 'beta' }),
        createAgent({ id: 'agent-3', name: 'gamma' }),
      ]),
    });
    renderAgentsPage();
    await waitFor(() => {
      expect(screen.getByText('3/3 agents')).toBeDefined();
    });
    const searchInput = screen.getByPlaceholderText('Search agents...');
    fireEvent.change(searchInput, { target: { value: 'alpha' } });
    await waitFor(() => {
      expect(screen.getByText('1/3 agents')).toBeDefined();
    });
  });

  it('changes sort order', () => {
    renderAgentsPage();
    const sortSelect = screen.getByLabelText('Sort order') as HTMLSelectElement;
    fireEvent.change(sortSelect, { target: { value: 'cost' } });
    expect(sortSelect.value).toBe('cost');
  });

  // =========================================================================
  // Summary stat cards
  // =========================================================================

  it('renders total agents stat card', async () => {
    renderAgentsPage();
    await waitFor(() => {
      expect(screen.getByTestId('stat-card-Total Agents')).toBeDefined();
      expect(screen.getByTestId('stat-value-Total Agents').textContent).toBe('1');
    });
  });

  it('renders per-status stat cards', async () => {
    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: vi.fn().mockResolvedValue([
        createAgent({ id: 'a1', status: 'running' }),
        createAgent({ id: 'a2', status: 'running' }),
        createAgent({ id: 'a3', status: 'error' }),
      ]),
    });
    renderAgentsPage();
    await waitFor(() => {
      expect(screen.getByTestId('stat-card-Running')).toBeDefined();
      expect(screen.getByTestId('stat-value-Running').textContent).toBe('2');
      expect(screen.getByTestId('stat-card-Error')).toBeDefined();
      expect(screen.getByTestId('stat-value-Error').textContent).toBe('1');
    });
  });

  // =========================================================================
  // Empty states
  // =========================================================================

  it('shows empty state when no agents exist', async () => {
    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: vi.fn().mockResolvedValue([]),
    });
    renderAgentsPage();
    await waitFor(() => {
      expect(screen.getByText('No agents registered')).toBeDefined();
    });
  });

  it('shows filter empty state when filters match nothing', async () => {
    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: vi.fn().mockResolvedValue([
        createAgent({ id: 'agent-1', name: 'test-agent', status: 'registered' }),
      ]),
    });
    renderAgentsPage();
    const filterSelect = screen.getByLabelText('Filter by status');
    fireEvent.change(filterSelect, { target: { value: 'running' } });
    await waitFor(() => {
      expect(screen.getByText('No agents match the current filters')).toBeDefined();
    });
  });

  // =========================================================================
  // Error handling
  // =========================================================================

  it('displays error banner on query failure', async () => {
    const error = new Error('API connection failed');
    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: vi.fn().mockRejectedValue(error),
    });
    renderAgentsPage();
    await waitFor(() => {
      expect(screen.getByTestId('error-banner')).toBeDefined();
      expect(screen.getByText('API connection failed')).toBeDefined();
    });
  });

  it('shows retry button in error banner', async () => {
    const error = new Error('fail');
    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: vi.fn().mockRejectedValue(error),
    });
    renderAgentsPage();
    await waitFor(() => {
      expect(screen.getByText('Retry')).toBeDefined();
    });
  });

  // =========================================================================
  // Status description in header
  // =========================================================================

  it('shows status counts in description', async () => {
    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: vi.fn().mockResolvedValue([
        createAgent({ id: 'a1', status: 'running' }),
        createAgent({ id: 'a2', status: 'running' }),
        createAgent({ id: 'a3', status: 'error' }),
      ]),
    });
    renderAgentsPage();
    await waitFor(() => {
      expect(screen.getByText(/2 running/)).toBeDefined();
      expect(screen.getByText(/1 error/)).toBeDefined();
    });
  });
});
