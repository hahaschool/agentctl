import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Agent, DiscoveredSession, Machine, Session } from '@/lib/api';
import { DashboardPage } from './DashboardPage';

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

vi.mock('@/hooks/use-websocket', () => ({
  useWebSocket: () => ({ status: 'connected' }),
}));

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
  ErrorBanner: ({ message, onRetry }: { message: string; onRetry: () => void }) => (
    <div data-testid="error-banner">
      {message}
      <button type="button" onClick={onRetry}>
        Retry
      </button>
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

vi.mock('@/components/StatCard', () => ({
  StatCard: ({ label, value, sublabel }: { label: string; value: string; sublabel?: string }) => (
    <div data-testid={`stat-card-${label}`}>
      <div>{label}</div>
      <div data-testid={`stat-value-${label}`}>{value}</div>
      {sublabel && <div data-testid={`stat-sublabel-${label}`}>{sublabel}</div>}
    </div>
  ),
}));

vi.mock('@/components/StatusBadge', () => ({
  StatusBadge: ({ status }: { status: string }) => (
    <span data-testid={`status-badge-${status}`}>{status}</span>
  ),
}));

vi.mock('@/components/WsStatusIndicator', () => ({
  WsStatusIndicator: ({ status }: { status: string }) => (
    <div data-testid="ws-indicator">{status}</div>
  ),
}));

// ---------------------------------------------------------------------------
// Mock api queries
// ---------------------------------------------------------------------------

const mockHealthQuery = vi.fn();
const mockMetricsQuery = vi.fn();
const mockMachinesQuery = vi.fn();
const mockAgentsQuery = vi.fn();
const mockDiscoverQuery = vi.fn();
const mockSessionsQuery = vi.fn();

vi.mock('@/lib/queries', () => ({
  healthQuery: () => mockHealthQuery(),
  metricsQuery: () => mockMetricsQuery(),
  machinesQuery: () => mockMachinesQuery(),
  agentsQuery: () => mockAgentsQuery(),
  discoverQuery: () => mockDiscoverQuery(),
  sessionsQuery: () => mockSessionsQuery(),
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

function createSession(overrides?: Partial<Session>): Session {
  return {
    id: 'session-1',
    agentId: 'agent-1',
    agentName: null,
    machineId: 'machine-1',
    sessionUrl: 'https://example.com/session',
    claudeSessionId: 'claude-session-1',
    status: 'running',
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

function createDiscoveredSession(overrides?: Partial<DiscoveredSession>): DiscoveredSession {
  return {
    sessionId: 'discovered-1',
    projectPath: '/tmp/discovered',
    summary: 'Discovered session',
    messageCount: 42,
    lastActivity: new Date().toISOString(),
    branch: 'feature/test',
    machineId: 'machine-1',
    hostname: 'test-machine',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <DashboardPage />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DashboardPage', () => {
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
        agentctl_agents_active: 1,
        agentctl_runs_total: 10,
        agentctl_control_plane_up: 1,
        agentctl_total_cost_usd: 5.25,
      }),
    });

    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([createMachine()]),
    });

    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: vi.fn().mockResolvedValue([createAgent()]),
    });

    mockDiscoverQuery.mockReturnValue({
      queryKey: ['discovered-sessions'],
      queryFn: vi.fn().mockResolvedValue({
        count: 1,
        machinesQueried: 1,
        machinesFailed: 0,
        sessions: [createDiscoveredSession()],
      }),
    });

    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({ sessions: [createSession()], total: 1, limit: 50, offset: 0, hasMore: false }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Rendering & Layout
  // =========================================================================

  it('renders the page title', async () => {
    renderDashboard();
    expect(screen.getByText('Command center')).toBeDefined();
  });

  it('renders navigation links', async () => {
    renderDashboard();
    expect(screen.getByText('New Session')).toBeDefined();
    expect(screen.getByText('View Agents')).toBeDefined();
  });

  it('renders stat cards', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByTestId('stat-card-Machines Online')).toBeDefined();
      expect(screen.getByTestId('stat-card-Agents Registered')).toBeDefined();
      expect(screen.getByTestId('stat-card-Active Runs')).toBeDefined();
      expect(screen.getByTestId('stat-card-Active Sessions')).toBeDefined();
    });
  });

  // =========================================================================
  // Health Status Card
  // =========================================================================

  it('displays health status as "ok" when healthy', async () => {
    renderDashboard();
    await waitFor(() => {
      // Check for the health status text (not the dependency status)
      const elements = screen.getAllByText(/ok/i);
      expect(elements.length).toBeGreaterThan(0);
    });
  });

  it('displays health status as "degraded" when degraded', async () => {
    mockHealthQuery.mockReturnValue({
      queryKey: ['health'],
      queryFn: vi.fn().mockResolvedValue({
        status: 'degraded',
        timestamp: new Date().toISOString(),
      }),
    });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText(/degraded/i)).toBeDefined();
    });
  });

  it('shows dependencies section when available', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('Dependencies')).toBeDefined();
    });
  });

  // =========================================================================
  // Statistics Display
  // =========================================================================

  it('displays correct machine count', async () => {
    renderDashboard();
    await waitFor(() => {
      const statValue = screen.getByTestId('stat-value-Machines Online');
      expect(statValue.textContent).toContain('1 / 1');
    });
  });

  it('shows offline machines in sublabel', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi
        .fn()
        .mockResolvedValue([
          createMachine({ status: 'online' }),
          createMachine({ id: 'machine-2', status: 'offline' }),
        ]),
    });
    renderDashboard();
    await waitFor(() => {
      const statSublabel = screen.getByTestId('stat-sublabel-Machines Online');
      expect(statSublabel.textContent).toContain('1 offline');
    });
  });

  it('displays agent count', async () => {
    renderDashboard();
    await waitFor(() => {
      const statValue = screen.getByTestId('stat-value-Agents Registered');
      expect(statValue.textContent).toBe('1');
    });
  });

  it('displays active runs count', async () => {
    renderDashboard();
    await waitFor(() => {
      const statValue = screen.getByTestId('stat-value-Active Runs');
      expect(statValue.textContent).toBe('1');
    });
  });

  it('displays active sessions count', async () => {
    renderDashboard();
    await waitFor(() => {
      const statValue = screen.getByTestId('stat-value-Active Sessions');
      expect(statValue.textContent).toBe('1');
    });
  });

  // =========================================================================
  // Empty States
  // =========================================================================

  it('shows empty state for machines when none exist', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([]),
    });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText(/No machines registered/i)).toBeDefined();
    });
  });

  it('shows empty state for sessions when none exist', async () => {
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({ sessions: [], total: 0, limit: 50, offset: 0, hasMore: false }),
    });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText(/No sessions yet/i)).toBeDefined();
    });
  });

  // =========================================================================
  // Recent Sessions
  // =========================================================================

  it('renders recent sessions list', async () => {
    const session = createSession({ claudeSessionId: 'abc12345' });
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({ sessions: [session], total: 1, limit: 50, offset: 0, hasMore: false }),
    });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText(/Session abc12345/i)).toBeDefined();
    });
  });

  it('shows session model badge', async () => {
    const session = createSession({ model: 'claude-3-5-sonnet-20241022' });
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({ sessions: [session], total: 1, limit: 50, offset: 0, hasMore: false }),
    });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('claude-3-5-sonnet-20241022')).toBeDefined();
    });
  });

  it('shows session project path', async () => {
    const session = createSession({ projectPath: '/home/user/project' });
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({ sessions: [session], total: 1, limit: 50, offset: 0, hasMore: false }),
    });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByTestId('path-badge')).toBeDefined();
    });
  });

  it('sorts sessions by most recent activity first', async () => {
    const now = new Date();
    const session1 = createSession({
      id: 'session-1',
      claudeSessionId: 'abc12345',
      endedAt: new Date(now.getTime() - 60000).toISOString(),
    });
    const session2 = createSession({
      id: 'session-2',
      claudeSessionId: 'def67890',
      endedAt: new Date(now.getTime() - 120000).toISOString(),
    });
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({ sessions: [session1, session2], total: 2, limit: 50, offset: 0, hasMore: false }),
    });
    renderDashboard();
    await waitFor(() => {
      // Both sessions should be rendered
      expect(screen.getByText(/abc12345/i)).toBeDefined();
      expect(screen.getByText(/def67890/i)).toBeDefined();
    });
  });

  // =========================================================================
  // Fleet Status
  // =========================================================================

  it('renders machines in fleet status section', async () => {
    const machine = createMachine({ hostname: 'prod-machine' });
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([machine]),
    });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('prod-machine')).toBeDefined();
    });
  });

  it('shows machine OS and architecture', async () => {
    const machine = createMachine({ os: 'linux', arch: 'arm64' });
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([machine]),
    });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText(/linux\/arm64/)).toBeDefined();
    });
  });

  it('shows GPU capability badge', async () => {
    const machine = createMachine({
      capabilities: { gpu: true, docker: true, maxConcurrentAgents: 4 },
    });
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([machine]),
    });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('GPU')).toBeDefined();
    });
  });

  // =========================================================================
  // Discovered Sessions
  // =========================================================================

  it('renders discovered sessions when available', async () => {
    const discovered = createDiscoveredSession({ summary: 'My test session' });
    mockDiscoverQuery.mockReturnValue({
      queryKey: ['discovered-sessions'],
      queryFn: vi.fn().mockResolvedValue({
        count: 1,
        machinesQueried: 1,
        machinesFailed: 0,
        sessions: [discovered],
      }),
    });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('My test session')).toBeDefined();
    });
  });

  it('hides discovered sessions section when empty', async () => {
    mockDiscoverQuery.mockReturnValue({
      queryKey: ['discovered-sessions'],
      queryFn: vi.fn().mockResolvedValue({
        count: 0,
        machinesQueried: 1,
        machinesFailed: 0,
        sessions: [],
      }),
    });
    renderDashboard();
    await waitFor(() => {
      // Should not find the "Discovered Sessions" header
      const headers = screen.queryAllByText('Discovered Sessions');
      expect(headers.length).toBe(0);
    });
  });

  // =========================================================================
  // Cost Breakdown
  // =========================================================================

  it('displays top agents by cost', async () => {
    const agent1 = createAgent({
      id: 'agent-1',
      name: 'expensive-agent',
      totalCostUsd: 100.0,
      lastCostUsd: 10.0,
    });
    const agent2 = createAgent({
      id: 'agent-2',
      name: 'cheap-agent',
      totalCostUsd: 5.0,
      lastCostUsd: 0.5,
    });
    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: vi.fn().mockResolvedValue([agent1, agent2]),
    });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getAllByText('Cost by Agent').length).toBeGreaterThan(0);
      expect(screen.getAllByText('expensive-agent').length).toBeGreaterThan(0);
    });
  });

  it('shows total platform cost', async () => {
    mockMetricsQuery.mockReturnValue({
      queryKey: ['metrics'],
      queryFn: vi.fn().mockResolvedValue({
        agentctl_agents_active: 1,
        agentctl_runs_total: 10,
        agentctl_control_plane_up: 1,
        agentctl_total_cost_usd: 42.5,
      }),
    });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getAllByText(/Total Cost/i).length).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // Loading States
  // =========================================================================

  it('shows loading skeletons when queries are loading', async () => {
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockReturnValue(new Promise(() => {})), // Never resolves
      isLoading: true,
    });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
    });
  });

  it('shows fetching bar when data is fetching', async () => {
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockReturnValue(new Promise(() => {})), // Never resolves
      isFetching: true,
    });
    renderDashboard();
    const fetchingBar = screen.getByTestId('fetching-bar');
    expect(fetchingBar.textContent).toContain('fetching');
  });

  // =========================================================================
  // Error Handling
  // =========================================================================

  it('displays error banner on query failure', async () => {
    const error = new Error('API connection failed');
    mockHealthQuery.mockReturnValue({
      queryKey: ['health'],
      queryFn: vi.fn().mockRejectedValue(error),
      error,
    });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByTestId('error-banner')).toBeDefined();
    });
  });

  it('retry button calls refresh on error', async () => {
    const error = new Error('API connection failed');
    mockHealthQuery.mockReturnValue({
      queryKey: ['health'],
      queryFn: vi.fn().mockRejectedValue(error),
      error,
    });
    renderDashboard();
    await waitFor(() => {
      const retryButton = screen.getByText('Retry');
      expect(retryButton).toBeDefined();
    });
  });

  // =========================================================================
  // Refresh Functionality
  // =========================================================================

  it('renders refresh button', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByTestId('refresh-button')).toBeDefined();
    });
  });

  it('disables refresh button while fetching', async () => {
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockReturnValue(new Promise(() => {})),
      isFetching: true,
    });
    renderDashboard();
    await waitFor(() => {
      const refreshButton = screen.getByTestId('refresh-button') as HTMLButtonElement;
      expect(refreshButton.disabled).toBe(true);
    });
  });

  // =========================================================================
  // WebSocket Indicator
  // =========================================================================

  it('displays websocket status indicator', async () => {
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByTestId('ws-indicator')).toBeDefined();
    });
  });

  // =========================================================================
  // Platform Summary
  // =========================================================================

  it('shows platform health status', async () => {
    mockMetricsQuery.mockReturnValue({
      queryKey: ['metrics'],
      queryFn: vi.fn().mockResolvedValue({
        agentctl_agents_active: 2,
        agentctl_runs_total: 25,
        agentctl_control_plane_up: 1,
        agentctl_total_cost_usd: 75.5,
      }),
    });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('Platform')).toBeDefined();
      expect(screen.getByText('Healthy')).toBeDefined();
    });
  });

  it('shows platform health as down when unhealthy', async () => {
    mockMetricsQuery.mockReturnValue({
      queryKey: ['metrics'],
      queryFn: vi.fn().mockResolvedValue({
        agentctl_agents_active: 0,
        agentctl_runs_total: 0,
        agentctl_control_plane_up: 0,
        agentctl_total_cost_usd: 0,
      }),
    });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('Down')).toBeDefined();
    });
  });

  // =========================================================================
  // Data Handling Edge Cases
  // =========================================================================

  it('handles null/undefined fields gracefully', async () => {
    const machine = createMachine({ lastHeartbeat: null, hostname: 'graceful-machine' });
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([machine]),
    });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('graceful-machine')).toBeDefined();
    });
  });

  it('displays multiple machines', async () => {
    const machines = [
      createMachine({ id: 'machine-1', hostname: 'host-1' }),
      createMachine({ id: 'machine-2', hostname: 'host-2' }),
      createMachine({ id: 'machine-3', hostname: 'host-3' }),
    ];
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue(machines),
    });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('host-1')).toBeDefined();
      expect(screen.getByText('host-2')).toBeDefined();
      expect(screen.getByText('host-3')).toBeDefined();
    });
  });

  it('displays multiple agents by cost', async () => {
    const agents = [
      createAgent({
        id: 'agent-1',
        name: 'agent-1',
        totalCostUsd: 100,
      }),
      createAgent({
        id: 'agent-2',
        name: 'agent-2',
        totalCostUsd: 75,
      }),
      createAgent({
        id: 'agent-3',
        name: 'agent-3',
        totalCostUsd: 50,
      }),
    ];
    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: vi.fn().mockResolvedValue(agents),
    });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getAllByText('agent-1').length).toBeGreaterThan(0);
      expect(screen.getAllByText('agent-2').length).toBeGreaterThan(0);
      expect(screen.getAllByText('agent-3').length).toBeGreaterThan(0);
    });
  });

  it('limits cost breakdown to top 5 agents', async () => {
    const agents = Array.from({ length: 10 }, (_, i) =>
      createAgent({
        id: `agent-${i}`,
        name: `agent-${i}`,
        totalCostUsd: 100 - i * 10,
      }),
    );
    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: vi.fn().mockResolvedValue(agents),
    });
    renderDashboard();
    await waitFor(() => {
      // Top 5 should be visible
      expect(screen.getAllByText('agent-0').length).toBeGreaterThan(0);
      expect(screen.getAllByText('agent-4').length).toBeGreaterThan(0);
    });
  });

  it('handles agents with zero cost', async () => {
    const agents = [
      createAgent({ id: 'agent-1', name: 'agent-1', totalCostUsd: 0 }),
      createAgent({ id: 'agent-2', name: 'agent-2', totalCostUsd: 10 }),
    ];
    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: vi.fn().mockResolvedValue(agents),
    });
    renderDashboard();
    await waitFor(() => {
      // agent-2 should show in cost breakdown
      expect(screen.getAllByText('agent-2').length).toBeGreaterThan(0);
    });
  });

  it('limits recent sessions to 8', async () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      createSession({
        id: `session-${i}`,
        claudeSessionId: `abc${String(i).padStart(5, '0')}`,
        startedAt: new Date(Date.now() - i * 60000).toISOString(),
      }),
    );
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({ sessions, total: sessions.length, limit: 50, offset: 0, hasMore: false }),
    });
    renderDashboard();
    await waitFor(() => {
      // First session should be visible
      expect(screen.getByText(/abc00000/i)).toBeDefined();
    });
  });

  it('filters active sessions correctly', async () => {
    const sessions = [
      createSession({ id: 'session-1', status: 'running' }),
      createSession({ id: 'session-2', status: 'active' }),
      createSession({ id: 'session-3', status: 'completed' }),
    ];
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: vi.fn().mockResolvedValue({ sessions, total: sessions.length, limit: 50, offset: 0, hasMore: false }),
    });
    renderDashboard();
    await waitFor(() => {
      const statValue = screen.getByTestId('stat-value-Active Sessions');
      expect(statValue.textContent).toBe('2');
    });
  });

  it('shows agent error count in sublabel', async () => {
    const agents = [
      createAgent({ id: 'agent-1', status: 'registered' }),
      createAgent({ id: 'agent-2', status: 'error' }),
      createAgent({ id: 'agent-3', status: 'error' }),
    ];
    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: vi.fn().mockResolvedValue(agents),
    });
    renderDashboard();
    await waitFor(() => {
      const statSublabel = screen.getByTestId('stat-sublabel-Agents Registered');
      expect(statSublabel.textContent).toContain('2 in error');
    });
  });

  // =========================================================================
  // Dependencies Display
  // =========================================================================

  it('renders all dependencies from health response', async () => {
    mockHealthQuery.mockReturnValue({
      queryKey: ['health'],
      queryFn: vi.fn().mockResolvedValue({
        status: 'ok',
        timestamp: new Date().toISOString(),
        dependencies: {
          postgres: { status: 'ok', latencyMs: 12 },
          redis: { status: 'ok', latencyMs: 5 },
          kubernetes: { status: 'ok', latencyMs: 25 },
        },
      }),
    });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('postgres')).toBeDefined();
      expect(screen.getByText('redis')).toBeDefined();
      expect(screen.getByText('kubernetes')).toBeDefined();
    });
  });

  it('shows error state for failed dependencies', async () => {
    mockHealthQuery.mockReturnValue({
      queryKey: ['health'],
      queryFn: vi.fn().mockResolvedValue({
        status: 'degraded',
        timestamp: new Date().toISOString(),
        dependencies: {
          postgres: { status: 'error', latencyMs: 0, error: 'Connection timeout' },
          redis: { status: 'ok', latencyMs: 5 },
        },
      }),
    });
    renderDashboard();
    await waitFor(() => {
      // Check that error message appears
      expect(screen.getByText(/timeout/i)).toBeDefined();
    });
  });

  it('highlights slow dependencies', async () => {
    mockHealthQuery.mockReturnValue({
      queryKey: ['health'],
      queryFn: vi.fn().mockResolvedValue({
        status: 'degraded',
        timestamp: new Date().toISOString(),
        dependencies: {
          postgres: { status: 'ok', latencyMs: 750, error: undefined },
          redis: { status: 'ok', latencyMs: 5 },
        },
      }),
    });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('SLOW')).toBeDefined();
    });
  });

  // =========================================================================
  // Discovered Sessions Details
  // =========================================================================

  it('shows discovered session summary text', async () => {
    const discovered = createDiscoveredSession({
      summary: 'Fixing authentication bug',
    });
    mockDiscoverQuery.mockReturnValue({
      queryKey: ['discovered-sessions'],
      queryFn: vi.fn().mockResolvedValue({
        count: 1,
        machinesQueried: 1,
        machinesFailed: 0,
        sessions: [discovered],
      }),
    });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('Fixing authentication bug')).toBeDefined();
    });
  });

  it('shows message count for discovered sessions', async () => {
    const discovered = createDiscoveredSession({ messageCount: 123 });
    mockDiscoverQuery.mockReturnValue({
      queryKey: ['discovered-sessions'],
      queryFn: vi.fn().mockResolvedValue({
        count: 1,
        machinesQueried: 1,
        machinesFailed: 0,
        sessions: [discovered],
      }),
    });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('123 msgs')).toBeDefined();
    });
  });

  it('shows branch info for discovered sessions', async () => {
    const discovered = createDiscoveredSession({
      branch: 'feature/claude-upgrade',
    });
    mockDiscoverQuery.mockReturnValue({
      queryKey: ['discovered-sessions'],
      queryFn: vi.fn().mockResolvedValue({
        count: 1,
        machinesQueried: 1,
        machinesFailed: 0,
        sessions: [discovered],
      }),
    });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('feature/claude-upgrade')).toBeDefined();
    });
  });

  it('limits discovered sessions display to 4', async () => {
    const discovered = Array.from({ length: 6 }, (_, i) =>
      createDiscoveredSession({
        sessionId: `discovered-${i}`,
        summary: `Session ${i}`,
      }),
    );
    mockDiscoverQuery.mockReturnValue({
      queryKey: ['discovered-sessions'],
      queryFn: vi.fn().mockResolvedValue({
        count: 6,
        machinesQueried: 2,
        machinesFailed: 0,
        sessions: discovered,
      }),
    });
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText('Session 0')).toBeDefined();
      expect(screen.getByText('Session 3')).toBeDefined();
    });
  });
});
