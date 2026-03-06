import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockHealthQuery,
  mockMetricsQuery,
  mockMachinesQuery,
  mockAgentsQuery,
  mockAuditQuery,
  mockAuditSummaryQuery,
} = vi.hoisted(() => ({
  mockHealthQuery: vi.fn(),
  mockMetricsQuery: vi.fn(),
  mockMachinesQuery: vi.fn(),
  mockAgentsQuery: vi.fn(),
  mockAuditQuery: vi.fn(),
  mockAuditSummaryQuery: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

vi.mock('@/hooks/use-hotkeys', () => ({
  useHotkeys: vi.fn(),
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

vi.mock('@/components/EmptyState', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <div>{title}</div>
      {description && <div>{description}</div>}
    </div>
  ),
}));

// ---------------------------------------------------------------------------
// Mock queries
// ---------------------------------------------------------------------------

vi.mock('@/lib/queries', () => ({
  healthQuery: () => mockHealthQuery(),
  metricsQuery: () => mockMetricsQuery(),
  machinesQuery: () => mockMachinesQuery(),
  agentsQuery: () => mockAgentsQuery(),
  auditQuery: () => mockAuditQuery(),
  auditSummaryQuery: () => mockAuditSummaryQuery(),
}));

// ---------------------------------------------------------------------------
// Import component AFTER mocks
// ---------------------------------------------------------------------------

import type { AuditAction, Machine } from '@/lib/api';
import { LogsPage } from './LogsPage';

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

function createAuditAction(overrides?: Partial<AuditAction>): AuditAction {
  return {
    id: 'action-1',
    runId: 'run-1',
    timestamp: new Date().toISOString(),
    actionType: 'tool_use',
    toolName: 'Read',
    toolInput: { file_path: '/tmp/test.ts' },
    toolOutputHash: 'abc123',
    durationMs: 150,
    approvedBy: null,
    agentId: 'agent-1',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderLogsPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <LogsPage />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LogsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default successful responses
    mockHealthQuery.mockReturnValue({
      queryKey: ['health'],
      queryFn: vi.fn().mockResolvedValue({
        status: 'ok',
        timestamp: new Date().toISOString(),
        dependencies: {
          postgres: { status: 'ok', latencyMs: 10 },
          redis: { status: 'ok', latencyMs: 5 },
        },
      }),
    });

    mockMetricsQuery.mockReturnValue({
      queryKey: ['metrics'],
      queryFn: vi.fn().mockResolvedValue({
        agentctl_control_plane_up: 1,
        agentctl_agents_total: 3,
        agentctl_agents_active: 1,
        agentctl_runs_total: 10,
      }),
    });

    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([createMachine()]),
    });

    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: vi.fn().mockResolvedValue([
        { id: 'agent-1', name: 'test-agent' },
      ]),
    });

    mockAuditQuery.mockReturnValue({
      queryKey: ['audit'],
      queryFn: vi.fn().mockResolvedValue({
        actions: [createAuditAction()],
        total: 1,
        hasMore: false,
      }),
    });

    mockAuditSummaryQuery.mockReturnValue({
      queryKey: ['audit-summary'],
      queryFn: vi.fn().mockResolvedValue({
        totalActions: 42,
        toolBreakdown: { Read: 20, Write: 15, Bash: 7 },
        actionTypeBreakdown: { tool_use: 30, tool_result: 10, error: 2 },
        avgDurationMs: 250,
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Rendering & Layout
  // =========================================================================

  it('renders page heading and description', async () => {
    renderLogsPage();
    expect(screen.getByText('Logs & Metrics')).toBeDefined();
    expect(screen.getByText('System health, audit trail, and runtime metrics.')).toBeDefined();
  });

  it('renders Overview and Audit Trail tabs', () => {
    renderLogsPage();
    expect(screen.getByText('Overview')).toBeDefined();
    expect(screen.getByText(/Audit Trail/)).toBeDefined();
  });

  it('renders refresh button', () => {
    renderLogsPage();
    expect(screen.getByTestId('refresh-button')).toBeDefined();
  });

  it('renders last updated component', () => {
    renderLogsPage();
    expect(screen.getByTestId('last-updated')).toBeDefined();
  });

  // =========================================================================
  // Loading Skeleton State
  // =========================================================================

  it('shows loading skeletons when health query is loading', async () => {
    mockHealthQuery.mockReturnValue({
      queryKey: ['health'],
      queryFn: vi.fn().mockReturnValue(new Promise(() => {})),
    });

    renderLogsPage();
    await waitFor(() => {
      const skeletons = screen.getAllByTestId('skeleton');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  it('shows loading skeletons when metrics query is loading', async () => {
    mockMetricsQuery.mockReturnValue({
      queryKey: ['metrics'],
      queryFn: vi.fn().mockReturnValue(new Promise(() => {})),
    });

    renderLogsPage();
    await waitFor(() => {
      const skeletons = screen.getAllByTestId('skeleton');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Overview Tab — Control Plane Status
  // =========================================================================

  it('displays "All Systems Operational" when health is ok', async () => {
    renderLogsPage();
    await waitFor(() => {
      expect(screen.getByText('All Systems Operational')).toBeDefined();
    });
  });

  it('displays "Degraded Performance" when health is degraded', async () => {
    mockHealthQuery.mockReturnValue({
      queryKey: ['health'],
      queryFn: vi.fn().mockResolvedValue({
        status: 'degraded',
        timestamp: new Date().toISOString(),
        dependencies: {},
      }),
    });

    renderLogsPage();
    await waitFor(() => {
      expect(screen.getByText('Degraded Performance')).toBeDefined();
    });
  });

  it('displays "Unavailable" when health status is error', async () => {
    mockHealthQuery.mockReturnValue({
      queryKey: ['health'],
      queryFn: vi.fn().mockResolvedValue({
        status: 'error',
        timestamp: new Date().toISOString(),
        dependencies: {},
      }),
    });

    renderLogsPage();
    await waitFor(() => {
      expect(screen.getByText('Unavailable')).toBeDefined();
    });
  });

  // =========================================================================
  // Overview Tab — Dependencies
  // =========================================================================

  it('renders dependency cards', async () => {
    renderLogsPage();
    await waitFor(() => {
      expect(screen.getByText('postgres')).toBeDefined();
      expect(screen.getByText('redis')).toBeDefined();
    });
  });

  it('shows dependency latency', async () => {
    renderLogsPage();
    await waitFor(() => {
      expect(screen.getByText(/Latency: 10ms/)).toBeDefined();
      expect(screen.getByText(/Latency: 5ms/)).toBeDefined();
    });
  });

  // =========================================================================
  // Overview Tab — Metrics
  // =========================================================================

  it('displays metric cards after data loads', async () => {
    renderLogsPage();
    await waitFor(() => {
      // "Control Plane" appears as both section heading and metric label
      expect(screen.getAllByText('Control Plane').length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText('Agents Total')).toBeDefined();
      expect(screen.getByText('Agents Active')).toBeDefined();
      expect(screen.getByText('Runs Total')).toBeDefined();
      expect(screen.getByText('Machines Online')).toBeDefined();
      expect(screen.getByText('Health Status')).toBeDefined();
    });
  });

  it('shows UP when control plane is up', async () => {
    renderLogsPage();
    await waitFor(() => {
      expect(screen.getByText('UP')).toBeDefined();
    });
  });

  it('shows DOWN when control plane is down', async () => {
    mockMetricsQuery.mockReturnValue({
      queryKey: ['metrics'],
      queryFn: vi.fn().mockResolvedValue({
        agentctl_control_plane_up: 0,
        agentctl_agents_total: 0,
        agentctl_agents_active: 0,
        agentctl_runs_total: 0,
      }),
    });

    renderLogsPage();
    await waitFor(() => {
      expect(screen.getByText('DOWN')).toBeDefined();
    });
  });

  // =========================================================================
  // Overview Tab — Worker Health Table
  // =========================================================================

  it('renders worker machines table', async () => {
    renderLogsPage();
    await waitFor(() => {
      expect(screen.getByText('test-machine')).toBeDefined();
    });
  });

  it('shows worker table columns', async () => {
    renderLogsPage();
    await waitFor(() => {
      expect(screen.getByText('Hostname')).toBeDefined();
      expect(screen.getByText('Status')).toBeDefined();
      expect(screen.getByText('Last Heartbeat')).toBeDefined();
    });
  });

  it('shows empty state when no workers registered', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([]),
    });

    renderLogsPage();
    await waitFor(() => {
      expect(screen.getByText('No workers registered')).toBeDefined();
    });
  });

  it('displays multiple machines in worker table', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([
        createMachine({ id: 'machine-1', hostname: 'host-alpha' }),
        createMachine({ id: 'machine-2', hostname: 'host-beta', status: 'offline' }),
      ]),
    });

    renderLogsPage();
    await waitFor(() => {
      expect(screen.getByText('host-alpha')).toBeDefined();
      expect(screen.getByText('host-beta')).toBeDefined();
    });
  });

  // =========================================================================
  // Auto-Refresh Toggle
  // =========================================================================

  it('shows Live label when auto-refresh is on (default)', () => {
    renderLogsPage();
    expect(screen.getByText('Live')).toBeDefined();
  });

  it('toggles to Paused when auto-refresh button is clicked', () => {
    renderLogsPage();
    const liveButton = screen.getByText('Live');
    fireEvent.click(liveButton);
    expect(screen.getByText('Paused')).toBeDefined();
  });

  it('toggles back to Live when clicked again', () => {
    renderLogsPage();
    const liveButton = screen.getByText('Live');
    fireEvent.click(liveButton);
    expect(screen.getByText('Paused')).toBeDefined();
    const pausedButton = screen.getByText('Paused');
    fireEvent.click(pausedButton);
    expect(screen.getByText('Live')).toBeDefined();
  });

  // =========================================================================
  // Audit Trail Tab — Switching
  // =========================================================================

  it('switches to audit trail tab when clicked', async () => {
    renderLogsPage();
    const auditTab = screen.getByText(/Audit Trail/);
    fireEvent.click(auditTab);

    await waitFor(() => {
      // Audit-specific elements should appear
      expect(screen.getByPlaceholderText('Search actions, tools, agents...')).toBeDefined();
    });
  });

  // =========================================================================
  // Audit Trail Tab — Filter Tabs
  // =========================================================================

  it('renders action type filter tabs in audit view', async () => {
    renderLogsPage();
    fireEvent.click(screen.getByText(/Audit Trail/));

    await waitFor(() => {
      expect(screen.getByText('All')).toBeDefined();
      expect(screen.getByText('Tool Use')).toBeDefined();
      expect(screen.getByText('Tool Result')).toBeDefined();
      expect(screen.getByText('Text')).toBeDefined();
      expect(screen.getByText('Error')).toBeDefined();
    });
  });

  it('clicking a filter tab changes the active filter', async () => {
    renderLogsPage();
    fireEvent.click(screen.getByText(/Audit Trail/));

    await waitFor(() => {
      expect(screen.getByText('Tool Use')).toBeDefined();
    });

    // Click on "Error" filter tab
    const errorTab = screen.getByText('Error');
    fireEvent.click(errorTab);

    // The action with actionType "tool_use" should be filtered out
    // Since our single action is tool_use, we should see the empty state
    await waitFor(() => {
      expect(screen.getByText('No audit actions found')).toBeDefined();
    });
  });

  // =========================================================================
  // Audit Trail Tab — Search
  // =========================================================================

  it('renders search input in audit view', async () => {
    renderLogsPage();
    fireEvent.click(screen.getByText(/Audit Trail/));

    await waitFor(() => {
      const searchInput = screen.getByPlaceholderText('Search actions, tools, agents...') as HTMLInputElement;
      expect(searchInput).toBeDefined();
    });
  });

  it('filters audit actions by search query', async () => {
    // Use unique tool names that don't conflict with tool breakdown
    mockAuditQuery.mockReturnValue({
      queryKey: ['audit'],
      queryFn: vi.fn().mockResolvedValue({
        actions: [
          createAuditAction({ id: 'action-1', toolName: 'FetchUrl', agentId: 'agent-fetch' }),
          createAuditAction({ id: 'action-2', toolName: 'Compile', agentId: 'agent-compile' }),
        ],
        total: 2,
        hasMore: false,
      }),
    });

    renderLogsPage();
    fireEvent.click(screen.getByText(/Audit Trail/));

    await waitFor(() => {
      expect(screen.getByText('FetchUrl')).toBeDefined();
      expect(screen.getByText('Compile')).toBeDefined();
    });

    const searchInput = screen.getByPlaceholderText('Search actions, tools, agents...') as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: 'Compile' } });

    await waitFor(() => {
      // "FetchUrl" row should be filtered out
      expect(screen.queryByText('FetchUrl')).toBeNull();
      expect(screen.getByText('Compile')).toBeDefined();
    });
  });

  it('shows empty state when search matches nothing', async () => {
    renderLogsPage();
    fireEvent.click(screen.getByText(/Audit Trail/));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search actions, tools, agents...')).toBeDefined();
    });

    const searchInput = screen.getByPlaceholderText('Search actions, tools, agents...') as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: 'nonexistenttool' } });

    await waitFor(() => {
      expect(screen.getByText('No audit actions found')).toBeDefined();
      expect(screen.getByText('Try adjusting your filters or search query.')).toBeDefined();
    });
  });

  // =========================================================================
  // Audit Trail Tab — Log Entry Rendering
  // =========================================================================

  it('renders audit action rows', async () => {
    renderLogsPage();
    fireEvent.click(screen.getByText(/Audit Trail/));

    await waitFor(() => {
      expect(screen.getByText('tool_use')).toBeDefined();
      // "Read" appears in: action row, tool filter dropdown option, and tool breakdown card
      expect(screen.getAllByText('Read').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders multiple audit actions', async () => {
    mockAuditQuery.mockReturnValue({
      queryKey: ['audit'],
      queryFn: vi.fn().mockResolvedValue({
        actions: [
          createAuditAction({ id: 'action-1', actionType: 'tool_use', toolName: 'Grep' }),
          createAuditAction({ id: 'action-2', actionType: 'tool_result', toolName: 'Edit' }),
          createAuditAction({ id: 'action-3', actionType: 'error', toolName: null }),
        ],
        total: 3,
        hasMore: false,
      }),
    });

    renderLogsPage();
    fireEvent.click(screen.getByText(/Audit Trail/));

    await waitFor(() => {
      expect(screen.getByText('Grep')).toBeDefined();
      expect(screen.getByText('Edit')).toBeDefined();
      const actionTypes = screen.getAllByText('tool_use');
      expect(actionTypes.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Audit Trail Tab — Log Entry Expansion
  // =========================================================================

  it('expands audit action to show details when clicked', async () => {
    renderLogsPage();
    fireEvent.click(screen.getByText(/Audit Trail/));

    await waitFor(() => {
      expect(screen.getByText('tool_use')).toBeDefined();
    });

    // Click on the action row to expand it
    const actionRow = screen.getByText('tool_use').closest('button')!;
    fireEvent.click(actionRow);

    await waitFor(() => {
      // DetailRow renders labels with ":" suffix
      expect(screen.getByText('ID:')).toBeDefined();
      expect(screen.getByText('Run ID:')).toBeDefined();
      expect(screen.getByText('Action Type:')).toBeDefined();
      expect(screen.getByText('Tool:')).toBeDefined();
      expect(screen.getByText('Duration:')).toBeDefined();
    });
  });

  it('shows tool input JSON in expanded view', async () => {
    renderLogsPage();
    fireEvent.click(screen.getByText(/Audit Trail/));

    await waitFor(() => {
      expect(screen.getByText('tool_use')).toBeDefined();
    });

    const actionRow = screen.getByText('tool_use').closest('button')!;
    fireEvent.click(actionRow);

    await waitFor(() => {
      expect(screen.getByText('Tool Input:')).toBeDefined();
      // Check the JSON content is rendered
      expect(screen.getByText(/file_path/)).toBeDefined();
    });
  });

  it('collapses expanded action when clicked again', async () => {
    renderLogsPage();
    fireEvent.click(screen.getByText(/Audit Trail/));

    await waitFor(() => {
      expect(screen.getByText('tool_use')).toBeDefined();
    });

    const actionRow = screen.getByText('tool_use').closest('button')!;

    // Expand
    fireEvent.click(actionRow);
    await waitFor(() => {
      expect(screen.getByText('Tool Input:')).toBeDefined();
    });

    // Collapse
    fireEvent.click(actionRow);
    await waitFor(() => {
      expect(screen.queryByText('Tool Input:')).toBeNull();
    });
  });

  it('shows output hash in expanded view', async () => {
    renderLogsPage();
    fireEvent.click(screen.getByText(/Audit Trail/));

    await waitFor(() => {
      expect(screen.getByText('tool_use')).toBeDefined();
    });

    const actionRow = screen.getByText('tool_use').closest('button')!;
    fireEvent.click(actionRow);

    await waitFor(() => {
      expect(screen.getByText('Output Hash:')).toBeDefined();
      expect(screen.getByText('abc123')).toBeDefined();
    });
  });

  // =========================================================================
  // Audit Trail Tab — Summary Cards
  // =========================================================================

  it('renders audit summary stat cards', async () => {
    renderLogsPage();
    fireEvent.click(screen.getByText(/Audit Trail/));

    await waitFor(() => {
      expect(screen.getByTestId('stat-card-Total Actions')).toBeDefined();
      expect(screen.getByTestId('stat-card-Unique Tools')).toBeDefined();
      expect(screen.getByTestId('stat-card-Avg Duration')).toBeDefined();
      expect(screen.getByTestId('stat-card-Action Types')).toBeDefined();
    });
  });

  // =========================================================================
  // Audit Trail Tab — Tool Usage Breakdown
  // =========================================================================

  it('renders tool usage breakdown section', async () => {
    renderLogsPage();
    fireEvent.click(screen.getByText(/Audit Trail/));

    await waitFor(() => {
      expect(screen.getByText('Tool Usage Breakdown')).toBeDefined();
      // Tool names appear in both breakdown cards and filter dropdown
      expect(screen.getAllByText('Read').length).toBeGreaterThanOrEqual(2);
      expect(screen.getAllByText('Write').length).toBeGreaterThanOrEqual(2);
      expect(screen.getAllByText('Bash').length).toBeGreaterThanOrEqual(2);
    });
  });

  it('shows call counts in tool breakdown', async () => {
    renderLogsPage();
    fireEvent.click(screen.getByText(/Audit Trail/));

    await waitFor(() => {
      expect(screen.getByText('20 calls')).toBeDefined();
      expect(screen.getByText('15 calls')).toBeDefined();
      expect(screen.getByText('7 calls')).toBeDefined();
    });
  });

  // =========================================================================
  // Audit Trail Tab — Empty State
  // =========================================================================

  it('shows empty state when no audit actions exist', async () => {
    mockAuditQuery.mockReturnValue({
      queryKey: ['audit'],
      queryFn: vi.fn().mockResolvedValue({
        actions: [],
        total: 0,
        hasMore: false,
      }),
    });

    renderLogsPage();
    fireEvent.click(screen.getByText(/Audit Trail/));

    await waitFor(() => {
      expect(screen.getByText('No audit actions found')).toBeDefined();
      expect(
        screen.getByText('Agent actions will appear here once agents start running.'),
      ).toBeDefined();
    });
  });

  // =========================================================================
  // Audit Trail Tab — Pagination
  // =========================================================================

  it('shows pagination when total exceeds page size', async () => {
    mockAuditQuery.mockReturnValue({
      queryKey: ['audit'],
      queryFn: vi.fn().mockResolvedValue({
        actions: Array.from({ length: 50 }, (_, i) =>
          createAuditAction({ id: `action-${String(i)}` }),
        ),
        total: 120,
        hasMore: true,
      }),
    });

    renderLogsPage();
    fireEvent.click(screen.getByText(/Audit Trail/));

    await waitFor(() => {
      expect(screen.getByText('Previous')).toBeDefined();
      expect(screen.getByText('Next')).toBeDefined();
      expect(screen.getByText(/Showing 1/)).toBeDefined();
      expect(screen.getByText(/of 120/)).toBeDefined();
    });
  });

  it('disables Previous button on first page', async () => {
    mockAuditQuery.mockReturnValue({
      queryKey: ['audit'],
      queryFn: vi.fn().mockResolvedValue({
        actions: Array.from({ length: 50 }, (_, i) =>
          createAuditAction({ id: `action-${String(i)}` }),
        ),
        total: 120,
        hasMore: true,
      }),
    });

    renderLogsPage();
    fireEvent.click(screen.getByText(/Audit Trail/));

    await waitFor(() => {
      const prevButton = screen.getByText('Previous') as HTMLButtonElement;
      expect(prevButton.disabled).toBe(true);
    });
  });

  // =========================================================================
  // Error Handling
  // =========================================================================

  it('displays error banner when health query fails', async () => {
    const error = new Error('Health check failed');
    mockHealthQuery.mockReturnValue({
      queryKey: ['health'],
      queryFn: vi.fn().mockRejectedValue(error),
    });

    renderLogsPage();
    await waitFor(() => {
      expect(screen.getByTestId('error-banner')).toBeDefined();
    });
  });

  it('displays error banner when metrics query fails', async () => {
    const error = new Error('Metrics fetch failed');
    mockMetricsQuery.mockReturnValue({
      queryKey: ['metrics'],
      queryFn: vi.fn().mockRejectedValue(error),
    });

    renderLogsPage();
    await waitFor(() => {
      expect(screen.getByTestId('error-banner')).toBeDefined();
    });
  });

  // =========================================================================
  // Fetching Bar
  // =========================================================================

  it('renders the fetching bar component', () => {
    renderLogsPage();
    expect(screen.getByTestId('fetching-bar')).toBeDefined();
  });

  // =========================================================================
  // Overview Tab — Raw Metrics Collapsible
  // =========================================================================

  it('shows Raw Metrics collapsible button after data loads', async () => {
    renderLogsPage();
    await waitFor(() => {
      expect(screen.getByText('Raw Metrics')).toBeDefined();
    });
  });

  it('expands raw metrics when clicked', async () => {
    renderLogsPage();
    await waitFor(() => {
      expect(screen.getByText('Raw Metrics')).toBeDefined();
    });

    const rawMetricsButton = screen.getByText('Raw Metrics').closest('button')!;
    fireEvent.click(rawMetricsButton);

    await waitFor(() => {
      expect(screen.getByText(/agentctl_control_plane_up/)).toBeDefined();
    });
  });

  // =========================================================================
  // Audit Trail Tab — Agent and Tool Filters
  // =========================================================================

  it('renders agent filter dropdown in audit view', async () => {
    renderLogsPage();
    fireEvent.click(screen.getByText(/Audit Trail/));

    await waitFor(() => {
      expect(screen.getByText('All Agents')).toBeDefined();
    });
  });

  it('renders tool filter dropdown in audit view', async () => {
    renderLogsPage();
    fireEvent.click(screen.getByText(/Audit Trail/));

    await waitFor(() => {
      expect(screen.getByText('All Tools')).toBeDefined();
    });
  });

  // =========================================================================
  // Audit Trail Tab — Audit count in tab label
  // =========================================================================

  it('shows audit total count in Audit Trail tab', async () => {
    renderLogsPage();
    await waitFor(() => {
      // The tab shows "(1)" from the audit.data.total
      const auditTab = screen.getByText(/Audit Trail/);
      expect(auditTab.textContent).toContain('(1)');
    });
  });

  // =========================================================================
  // Overview Tab — Dependency error expand
  // =========================================================================

  it('shows Show error link for failed dependency', async () => {
    mockHealthQuery.mockReturnValue({
      queryKey: ['health'],
      queryFn: vi.fn().mockResolvedValue({
        status: 'degraded',
        timestamp: new Date().toISOString(),
        dependencies: {
          postgres: { status: 'error', latencyMs: 0, error: 'Connection refused' },
        },
      }),
    });

    renderLogsPage();
    await waitFor(() => {
      expect(screen.getByText('Show error')).toBeDefined();
    });
  });

  it('expands dependency error when Show error is clicked', async () => {
    mockHealthQuery.mockReturnValue({
      queryKey: ['health'],
      queryFn: vi.fn().mockResolvedValue({
        status: 'degraded',
        timestamp: new Date().toISOString(),
        dependencies: {
          postgres: { status: 'error', latencyMs: 0, error: 'Connection refused' },
        },
      }),
    });

    renderLogsPage();
    await waitFor(() => {
      expect(screen.getByText('Show error')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Show error'));
    await waitFor(() => {
      expect(screen.getByText('Connection refused')).toBeDefined();
      expect(screen.getByText('Hide error')).toBeDefined();
    });
  });
});
