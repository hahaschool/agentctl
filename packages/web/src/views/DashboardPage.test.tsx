import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Agent, DiscoveredSession, Machine, Session } from '@/lib/api';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockHealthQuery,
  mockMetricsQuery,
  mockMachinesQuery,
  mockAgentsQuery,
  mockDiscoverQuery,
  mockSessionsQuery,
  mockUseWebSocket,
  mockUseHotkeys,
} = vi.hoisted(() => ({
  mockHealthQuery: vi.fn(),
  mockMetricsQuery: vi.fn(),
  mockMachinesQuery: vi.fn(),
  mockAgentsQuery: vi.fn(),
  mockDiscoverQuery: vi.fn(),
  mockSessionsQuery: vi.fn(),
  mockUseWebSocket: vi.fn(),
  mockUseHotkeys: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock dependencies — BEFORE the component import
// ---------------------------------------------------------------------------

vi.mock('@/hooks/use-hotkeys', () => ({
  useHotkeys: (...args: unknown[]) => mockUseHotkeys(...args),
}));

vi.mock('@/hooks/use-websocket', () => ({
  useWebSocket: () => mockUseWebSocket(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href} data-testid={`link-${href}`}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
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

vi.mock('@/components/KeyboardHelpOverlay', () => ({
  KeyboardHelpOverlay: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? (
      <div data-testid="keyboard-help-overlay">
        <button type="button" onClick={onClose} data-testid="close-help">
          Close Help
        </button>
      </div>
    ) : null,
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
  SimpleTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/StatCard', () => ({
  StatCard: ({
    label,
    value,
    sublabel,
    accent,
    tooltip,
  }: {
    label: string;
    value: string;
    sublabel?: string;
    accent?: string;
    tooltip?: string;
  }) => (
    <div data-testid={`stat-card-${label}`} data-accent={accent} title={tooltip}>
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
    <span data-testid="ws-status-indicator">{status}</span>
  ),
}));

vi.mock('@/lib/queries', () => ({
  healthQuery: () => mockHealthQuery(),
  metricsQuery: () => mockMetricsQuery(),
  machinesQuery: () => mockMachinesQuery(),
  agentsQuery: () => mockAgentsQuery(),
  discoverQuery: () => mockDiscoverQuery(),
  sessionsQuery: () => mockSessionsQuery(),
}));

// ---------------------------------------------------------------------------
// Component import — AFTER mocks
// ---------------------------------------------------------------------------

import { DashboardPage } from './DashboardPage';

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

function setupDefaultMocks(overrides?: {
  healthData?: unknown;
  metricsData?: unknown;
  machinesData?: Machine[];
  agentsData?: Agent[];
  discoverData?: {
    sessions: DiscoveredSession[];
    count: number;
    machinesQueried: number;
    machinesFailed: number;
  };
  sessionsData?: {
    sessions: Session[];
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
  wsStatus?: string;
  neverResolve?: ('health' | 'metrics' | 'machines' | 'agents' | 'discover' | 'sessions')[];
}) {
  const neverResolve = new Set(overrides?.neverResolve ?? []);

  mockHealthQuery.mockReturnValue({
    queryKey: ['health'],
    queryFn: neverResolve.has('health')
      ? vi.fn().mockReturnValue(new Promise(() => {}))
      : vi.fn().mockResolvedValue(
          overrides?.healthData ?? {
            status: 'ok',
            timestamp: new Date().toISOString(),
            dependencies: {
              postgres: { status: 'ok', latencyMs: 10 },
              redis: { status: 'ok', latencyMs: 5 },
            },
          },
        ),
  });

  mockMetricsQuery.mockReturnValue({
    queryKey: ['metrics'],
    queryFn: neverResolve.has('metrics')
      ? vi.fn().mockReturnValue(new Promise(() => {}))
      : vi.fn().mockResolvedValue(
          overrides?.metricsData ?? {
            agentctl_agents_active: 1,
            agentctl_runs_total: 10,
            agentctl_control_plane_up: 1,
            agentctl_total_cost_usd: 5.25,
          },
        ),
  });

  mockMachinesQuery.mockReturnValue({
    queryKey: ['machines'],
    queryFn: neverResolve.has('machines')
      ? vi.fn().mockReturnValue(new Promise(() => {}))
      : vi.fn().mockResolvedValue(overrides?.machinesData ?? [createMachine()]),
  });

  mockAgentsQuery.mockReturnValue({
    queryKey: ['agents'],
    queryFn: neverResolve.has('agents')
      ? vi.fn().mockReturnValue(new Promise(() => {}))
      : vi.fn().mockResolvedValue(overrides?.agentsData ?? [createAgent()]),
  });

  mockDiscoverQuery.mockReturnValue({
    queryKey: ['discovered-sessions'],
    queryFn: neverResolve.has('discover')
      ? vi.fn().mockReturnValue(new Promise(() => {}))
      : vi.fn().mockResolvedValue(
          overrides?.discoverData ?? {
            count: 1,
            machinesQueried: 1,
            machinesFailed: 0,
            sessions: [createDiscoveredSession()],
          },
        ),
  });

  mockSessionsQuery.mockReturnValue({
    queryKey: ['sessions'],
    queryFn: neverResolve.has('sessions')
      ? vi.fn().mockReturnValue(new Promise(() => {}))
      : vi.fn().mockResolvedValue(
          overrides?.sessionsData ?? {
            sessions: [createSession()],
            total: 1,
            limit: 50,
            offset: 0,
            hasMore: false,
          },
        ),
  });

  mockUseWebSocket.mockReturnValue({ status: overrides?.wsStatus ?? 'connected' });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Header rendering
  // =========================================================================

  describe('Header', () => {
    it('renders the "Command center" heading', () => {
      renderDashboard();
      expect(screen.getByText('Command center')).toBeDefined();
    });

    it('renders keyboard help button with correct aria-label', () => {
      renderDashboard();
      expect(screen.getByLabelText('Show keyboard shortcuts')).toBeDefined();
    });

    it('renders "New Session" quick action link to /sessions', () => {
      renderDashboard();
      expect(screen.getByText('New Session')).toBeDefined();
      expect(screen.getAllByTestId('link-/sessions').length).toBeGreaterThan(0);
    });

    it('renders "View Agents" quick action link to /agents', () => {
      renderDashboard();
      expect(screen.getByText('View Agents')).toBeDefined();
      expect(screen.getByTestId('link-/agents')).toBeDefined();
    });

    it('renders last-updated component', () => {
      renderDashboard();
      expect(screen.getByTestId('last-updated')).toBeDefined();
    });

    it('renders refresh button', () => {
      renderDashboard();
      expect(screen.getByTestId('refresh-button')).toBeDefined();
    });
  });

  // =========================================================================
  // 2. System health display
  // =========================================================================

  describe('Health status', () => {
    it('shows "Control Plane:" label', async () => {
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText(/Control Plane:/)).toBeDefined();
      });
    });

    it('shows health status "ok" when CP is healthy', async () => {
      renderDashboard();
      await waitFor(() => {
        const elements = screen.getAllByText('ok');
        expect(elements.length).toBeGreaterThan(0);
      });
    });

    it('shows health status "degraded" when CP is degraded', async () => {
      setupDefaultMocks({
        healthData: { status: 'degraded', timestamp: new Date().toISOString() },
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getAllByText(/degraded/i).length).toBeGreaterThan(0);
      });
    });

    it('shows "unknown" when health data is not available', async () => {
      setupDefaultMocks({ healthData: undefined });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('unknown')).toBeDefined();
      });
    });

    it('shows "Last checked:" with LiveTimeAgo when health timestamp is present', async () => {
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText(/Last checked:/)).toBeDefined();
      });
    });
  });

  // =========================================================================
  // 3. System health summary text
  // =========================================================================

  describe('System health summary', () => {
    it('displays "CP up" when health is ok', async () => {
      renderDashboard();
      await waitFor(() => {
        const summary = screen.getByTestId('system-health-summary');
        expect(summary.textContent).toContain('CP up');
      });
    });

    it('displays "CP degraded" when health is degraded', async () => {
      setupDefaultMocks({
        healthData: { status: 'degraded', timestamp: new Date().toISOString() },
      });
      renderDashboard();
      await waitFor(() => {
        const summary = screen.getByTestId('system-health-summary');
        expect(summary.textContent).toContain('CP degraded');
      });
    });

    it('displays "CP unknown" when health data is absent', async () => {
      setupDefaultMocks({ healthData: undefined });
      renderDashboard();
      await waitFor(() => {
        const summary = screen.getByTestId('system-health-summary');
        expect(summary.textContent).toContain('CP unknown');
      });
    });

    it('displays "WS connected" when websocket is connected', async () => {
      renderDashboard();
      await waitFor(() => {
        const summary = screen.getByTestId('system-health-summary');
        expect(summary.textContent).toContain('WS connected');
      });
    });

    it('displays "WS disconnected" when websocket is disconnected', async () => {
      setupDefaultMocks({ wsStatus: 'disconnected' });
      renderDashboard();
      await waitFor(() => {
        const summary = screen.getByTestId('system-health-summary');
        expect(summary.textContent).toContain('WS disconnected');
      });
    });

    it('displays "WS connecting" when websocket is connecting', async () => {
      setupDefaultMocks({ wsStatus: 'connecting' });
      renderDashboard();
      await waitFor(() => {
        const summary = screen.getByTestId('system-health-summary');
        expect(summary.textContent).toContain('WS connecting');
      });
    });

    it('displays "1 machine online" for single online machine', async () => {
      renderDashboard();
      await waitFor(() => {
        const summary = screen.getByTestId('system-health-summary');
        expect(summary.textContent).toContain('1 machine online');
      });
    });

    it('displays "2 machines online" (plural) for multiple online machines', async () => {
      setupDefaultMocks({
        machinesData: [
          createMachine({ id: 'm1', status: 'online' }),
          createMachine({ id: 'm2', status: 'online' }),
        ],
      });
      renderDashboard();
      await waitFor(() => {
        const summary = screen.getByTestId('system-health-summary');
        expect(summary.textContent).toContain('2 machines online');
      });
    });

    it('displays "no machines" when all machines are offline', async () => {
      setupDefaultMocks({
        machinesData: [createMachine({ status: 'offline' })],
      });
      renderDashboard();
      await waitFor(() => {
        const summary = screen.getByTestId('system-health-summary');
        expect(summary.textContent).toContain('no machines');
      });
    });

    it('displays "no machines" when machine list is empty', async () => {
      setupDefaultMocks({ machinesData: [] });
      renderDashboard();
      await waitFor(() => {
        const summary = screen.getByTestId('system-health-summary');
        expect(summary.textContent).toContain('no machines');
      });
    });
  });

  // =========================================================================
  // 4. WebSocket status indicator
  // =========================================================================

  describe('WebSocket status indicator', () => {
    it('renders WS indicator with connected status', () => {
      renderDashboard();
      const indicator = screen.getByTestId('ws-status-indicator');
      expect(indicator.textContent).toBe('connected');
    });

    it('renders WS indicator with disconnected status', () => {
      setupDefaultMocks({ wsStatus: 'disconnected' });
      renderDashboard();
      const indicator = screen.getByTestId('ws-status-indicator');
      expect(indicator.textContent).toBe('disconnected');
    });

    it('renders WS indicator with connecting status', () => {
      setupDefaultMocks({ wsStatus: 'connecting' });
      renderDashboard();
      const indicator = screen.getByTestId('ws-status-indicator');
      expect(indicator.textContent).toBe('connecting');
    });
  });

  // =========================================================================
  // 5. StatCard values
  // =========================================================================

  describe('StatCards', () => {
    it('renders all six stat cards', async () => {
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByTestId('stat-card-Machines Online')).toBeDefined();
        expect(screen.getByTestId('stat-card-Sessions Discovered')).toBeDefined();
        expect(screen.getByTestId('stat-card-Agents Registered')).toBeDefined();
        expect(screen.getByTestId('stat-card-Active Runs')).toBeDefined();
        expect(screen.getByTestId('stat-card-Active Sessions')).toBeDefined();
        expect(screen.getByTestId('stat-card-Total Cost')).toBeDefined();
      });
    });

    it('displays correct Machines Online value: online / total', async () => {
      setupDefaultMocks({
        machinesData: [
          createMachine({ id: 'm1', status: 'online' }),
          createMachine({ id: 'm2', status: 'offline' }),
          createMachine({ id: 'm3', status: 'online' }),
        ],
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByTestId('stat-value-Machines Online').textContent).toBe('2 / 3');
      });
    });

    it('displays offline count in Machines Online sublabel', async () => {
      setupDefaultMocks({
        machinesData: [
          createMachine({ id: 'm1', status: 'online' }),
          createMachine({ id: 'm2', status: 'offline' }),
        ],
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByTestId('stat-sublabel-Machines Online').textContent).toBe('1 offline');
      });
    });

    it('displays correct Sessions Discovered value and sublabel', async () => {
      setupDefaultMocks({
        discoverData: {
          sessions: [],
          count: 5,
          machinesQueried: 3,
          machinesFailed: 1,
        },
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByTestId('stat-value-Sessions Discovered').textContent).toBe('5');
        expect(screen.getByTestId('stat-sublabel-Sessions Discovered').textContent).toBe(
          '3 queried, 1 failed',
        );
      });
    });

    it('displays correct Agents Registered value', async () => {
      setupDefaultMocks({
        agentsData: [
          createAgent({ id: 'a1' }),
          createAgent({ id: 'a2' }),
          createAgent({ id: 'a3' }),
        ],
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByTestId('stat-value-Agents Registered').textContent).toBe('3');
      });
    });

    it('shows agent error count in Agents Registered sublabel', async () => {
      setupDefaultMocks({
        agentsData: [
          createAgent({ id: 'a1', status: 'registered' }),
          createAgent({ id: 'a2', status: 'error' }),
          createAgent({ id: 'a3', status: 'error' }),
        ],
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByTestId('stat-sublabel-Agents Registered').textContent).toBe(
          '2 in error',
        );
      });
    });

    it('displays correct Active Runs value from metrics', async () => {
      setupDefaultMocks({
        metricsData: {
          agentctl_agents_active: 7,
          agentctl_runs_total: 100,
          agentctl_control_plane_up: 1,
          agentctl_total_cost_usd: 50,
        },
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByTestId('stat-value-Active Runs').textContent).toBe('7');
        expect(screen.getByTestId('stat-sublabel-Active Runs').textContent).toBe('100 total');
      });
    });

    it('displays correct Active Sessions value (running + active only)', async () => {
      setupDefaultMocks({
        sessionsData: {
          sessions: [
            createSession({ id: 's1', status: 'running' }),
            createSession({ id: 's2', status: 'active' }),
            createSession({ id: 's3', status: 'ended' }),
            createSession({ id: 's4', status: 'error' }),
          ],
          total: 4,
          limit: 100,
          offset: 0,
          hasMore: false,
        },
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByTestId('stat-value-Active Sessions').textContent).toBe('2');
        expect(screen.getByTestId('stat-sublabel-Active Sessions').textContent).toBe('4 total');
      });
    });

    it('displays correct Total Cost value from agent costs', async () => {
      setupDefaultMocks({
        agentsData: [
          createAgent({ id: 'a1', totalCostUsd: 5.0, name: 'expensive-agent' }),
          createAgent({ id: 'a2', totalCostUsd: 3.0, name: 'cheap-agent' }),
        ],
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByTestId('stat-value-Total Cost').textContent).toBe('$8.00');
      });
    });

    it('shows top spender name in Total Cost sublabel', async () => {
      setupDefaultMocks({
        agentsData: [
          createAgent({ id: 'a1', totalCostUsd: 10.0, name: 'big-spender' }),
          createAgent({ id: 'a2', totalCostUsd: 2.0, name: 'frugal-bot' }),
        ],
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByTestId('stat-sublabel-Total Cost').textContent).toBe('top: big-spender');
      });
    });

    it('does not show Total Cost sublabel when no agents have cost', async () => {
      setupDefaultMocks({
        agentsData: [createAgent({ totalCostUsd: 0 })],
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByTestId('stat-card-Total Cost')).toBeDefined();
        expect(screen.queryByTestId('stat-sublabel-Total Cost')).toBeNull();
      });
    });
  });

  // =========================================================================
  // 6. Recent sessions list
  // =========================================================================

  describe('Recent sessions', () => {
    it('renders "Recent Sessions" section header', async () => {
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('Recent Sessions')).toBeDefined();
      });
    });

    it('renders session items as links to session detail', async () => {
      setupDefaultMocks({
        sessionsData: {
          sessions: [createSession({ id: 'session-abc' })],
          total: 1,
          limit: 50,
          offset: 0,
          hasMore: false,
        },
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByTestId('link-/sessions/session-abc')).toBeDefined();
      });
    });

    it('displays claude session ID in session name', async () => {
      setupDefaultMocks({
        sessionsData: {
          sessions: [createSession({ claudeSessionId: 'abc12345-long-id' })],
          total: 1,
          limit: 50,
          offset: 0,
          hasMore: false,
        },
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText(/Session abc12345/)).toBeDefined();
      });
    });

    it('falls back to session ID when claudeSessionId is null', async () => {
      setupDefaultMocks({
        sessionsData: {
          sessions: [createSession({ id: 'deadbeef-1234', claudeSessionId: null })],
          total: 1,
          limit: 50,
          offset: 0,
          hasMore: false,
        },
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText(/Session deadbeef/)).toBeDefined();
      });
    });

    it('shows StatusBadge for each session', async () => {
      setupDefaultMocks({
        sessionsData: {
          sessions: [createSession({ status: 'running' })],
          total: 1,
          limit: 50,
          offset: 0,
          hasMore: false,
        },
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByTestId('status-badge-running')).toBeDefined();
      });
    });

    it('shows model badge on session', async () => {
      setupDefaultMocks({
        sessionsData: {
          sessions: [createSession({ model: 'claude-opus-4-20250514' })],
          total: 1,
          limit: 50,
          offset: 0,
          hasMore: false,
        },
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('claude-opus-4-20250514')).toBeDefined();
      });
    });

    it('shows project path badge on session', async () => {
      setupDefaultMocks({
        sessionsData: {
          sessions: [createSession({ projectPath: '/home/user/project' })],
          total: 1,
          limit: 50,
          offset: 0,
          hasMore: false,
        },
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByTestId('path-badge')).toBeDefined();
        expect(screen.getByTestId('path-badge').textContent).toBe('/home/user/project');
      });
    });

    it('shows "ended" text for sessions with endedAt', async () => {
      setupDefaultMocks({
        sessionsData: {
          sessions: [createSession({ endedAt: new Date().toISOString() })],
          total: 1,
          limit: 50,
          offset: 0,
          hasMore: false,
        },
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText(/ended/)).toBeDefined();
      });
    });

    it('shows "started" text for sessions without endedAt', async () => {
      setupDefaultMocks({
        sessionsData: {
          sessions: [createSession({ endedAt: null })],
          total: 1,
          limit: 50,
          offset: 0,
          hasMore: false,
        },
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText(/started/)).toBeDefined();
      });
    });

    it('sorts sessions by most recent activity first', async () => {
      const now = Date.now();
      setupDefaultMocks({
        sessionsData: {
          sessions: [
            createSession({
              id: 'old',
              claudeSessionId: 'old11111',
              endedAt: new Date(now - 120000).toISOString(),
            }),
            createSession({
              id: 'new',
              claudeSessionId: 'new22222',
              endedAt: new Date(now - 10000).toISOString(),
            }),
          ],
          total: 2,
          limit: 50,
          offset: 0,
          hasMore: false,
        },
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText(/Session new22222/)).toBeDefined();
        expect(screen.getByText(/Session old11111/)).toBeDefined();
      });
    });

    it('limits displayed sessions to 8', async () => {
      const sessions = Array.from({ length: 12 }, (_, i) =>
        createSession({
          id: `session-${i}`,
          claudeSessionId: `cs-${String(i).padStart(5, '0')}`,
          startedAt: new Date(Date.now() - i * 60000).toISOString(),
        }),
      );
      setupDefaultMocks({
        sessionsData: {
          sessions,
          total: sessions.length,
          limit: 50,
          offset: 0,
          hasMore: false,
        },
      });
      renderDashboard();
      await waitFor(() => {
        // First 8 should be visible (sorted by most recent)
        expect(screen.getByText(/Session cs-00000/)).toBeDefined();
        expect(screen.getByText(/Session cs-00007/)).toBeDefined();
        // 9th and beyond should not appear
        expect(screen.queryByText(/Session cs-00008/)).toBeNull();
      });
    });

    it('shows "View All" link for sessions pointing to /sessions', async () => {
      renderDashboard();
      await waitFor(() => {
        // Multiple links to /sessions exist (header + section "View All")
        expect(screen.getAllByTestId('link-/sessions').length).toBeGreaterThanOrEqual(2);
      });
    });
  });

  // =========================================================================
  // 7. Fleet Status (Machine list)
  // =========================================================================

  describe('Fleet Status', () => {
    it('renders "Fleet Status" section header', async () => {
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('Fleet Status')).toBeDefined();
      });
    });

    it('renders machines with hostname', async () => {
      setupDefaultMocks({
        machinesData: [createMachine({ hostname: 'prod-ec2' })],
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('prod-ec2')).toBeDefined();
      });
    });

    it('renders machine tailscale IP', async () => {
      setupDefaultMocks({
        machinesData: [createMachine({ tailscaleIp: '100.64.1.5' })],
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('100.64.1.5')).toBeDefined();
      });
    });

    it('renders StatusBadge for online machine', async () => {
      setupDefaultMocks({
        machinesData: [createMachine({ status: 'online' })],
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByTestId('status-badge-online')).toBeDefined();
      });
    });

    it('renders StatusBadge for offline machine', async () => {
      setupDefaultMocks({
        machinesData: [createMachine({ status: 'offline' })],
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByTestId('status-badge-offline')).toBeDefined();
      });
    });

    it('renders mixed online and offline status badges', async () => {
      setupDefaultMocks({
        machinesData: [
          createMachine({ id: 'm1', status: 'online' }),
          createMachine({ id: 'm2', status: 'offline' }),
        ],
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByTestId('status-badge-online')).toBeDefined();
        expect(screen.getByTestId('status-badge-offline')).toBeDefined();
      });
    });

    it('renders machine OS/arch info', async () => {
      setupDefaultMocks({
        machinesData: [createMachine({ os: 'darwin', arch: 'arm64' })],
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('darwin/arm64')).toBeDefined();
      });
    });

    it('shows "unknown/unknown" for missing OS/arch', async () => {
      setupDefaultMocks({
        machinesData: [
          createMachine({
            os: undefined as unknown as string,
            arch: undefined as unknown as string,
          }),
        ],
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('unknown/unknown')).toBeDefined();
      });
    });

    it('renders GPU badge when machine has GPU', async () => {
      setupDefaultMocks({
        machinesData: [
          createMachine({
            capabilities: { gpu: true, docker: false, maxConcurrentAgents: 4 },
          }),
        ],
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('GPU')).toBeDefined();
      });
    });

    it('does not render GPU badge when machine has no GPU', async () => {
      setupDefaultMocks({
        machinesData: [
          createMachine({
            hostname: 'no-gpu-host',
            capabilities: { gpu: false, docker: true, maxConcurrentAgents: 4 },
          }),
        ],
        // Clear discovered sessions to avoid hostname conflicts
        discoverData: { sessions: [], count: 0, machinesQueried: 0, machinesFailed: 0 },
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('no-gpu-host')).toBeDefined();
      });
      expect(screen.queryByText('GPU')).toBeNull();
    });

    it('renders machine link to detail page', async () => {
      setupDefaultMocks({
        machinesData: [createMachine({ id: 'machine-42' })],
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByTestId('link-/machines/machine-42')).toBeDefined();
      });
    });

    it('renders multiple machines', async () => {
      setupDefaultMocks({
        machinesData: [
          createMachine({ id: 'm1', hostname: 'host-alpha' }),
          createMachine({ id: 'm2', hostname: 'host-beta' }),
          createMachine({ id: 'm3', hostname: 'host-gamma' }),
        ],
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('host-alpha')).toBeDefined();
        expect(screen.getByText('host-beta')).toBeDefined();
        expect(screen.getByText('host-gamma')).toBeDefined();
      });
    });

    it('renders "View All" link for machines pointing to /machines', () => {
      renderDashboard();
      expect(screen.getByTestId('link-/machines')).toBeDefined();
    });

    it('handles null lastHeartbeat gracefully', async () => {
      setupDefaultMocks({
        machinesData: [createMachine({ lastHeartbeat: null, hostname: 'no-heartbeat' })],
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('no-heartbeat')).toBeDefined();
      });
    });
  });

  // =========================================================================
  // 8. Discovered sessions section
  // =========================================================================

  describe('Discovered Sessions', () => {
    it('renders section when discovered sessions exist', async () => {
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('Discovered Sessions')).toBeDefined();
      });
    });

    it('shows empty state when no discovered sessions', async () => {
      setupDefaultMocks({
        discoverData: { sessions: [], count: 0, machinesQueried: 1, machinesFailed: 0 },
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('Discovered Sessions')).toBeDefined();
        expect(screen.getByText('No sessions discovered yet.')).toBeDefined();
        expect(screen.getByText(/Scan fleet/)).toBeDefined();
      });
    });

    it('shows discovered session summary text', async () => {
      setupDefaultMocks({
        discoverData: {
          sessions: [createDiscoveredSession({ summary: 'Fixing authentication bug' })],
          count: 1,
          machinesQueried: 1,
          machinesFailed: 0,
        },
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('Fixing authentication bug')).toBeDefined();
      });
    });

    it('shows "Untitled session" for empty summary', async () => {
      setupDefaultMocks({
        discoverData: {
          sessions: [createDiscoveredSession({ summary: '' })],
          count: 1,
          machinesQueried: 1,
          machinesFailed: 0,
        },
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('Untitled session')).toBeDefined();
      });
    });

    it('shows hostname badge', async () => {
      setupDefaultMocks({
        discoverData: {
          sessions: [createDiscoveredSession({ hostname: 'ec2-prod' })],
          count: 1,
          machinesQueried: 1,
          machinesFailed: 0,
        },
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('ec2-prod')).toBeDefined();
      });
    });

    it('shows branch info', async () => {
      setupDefaultMocks({
        discoverData: {
          sessions: [createDiscoveredSession({ branch: 'feature/claude-upgrade' })],
          count: 1,
          machinesQueried: 1,
          machinesFailed: 0,
        },
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('feature/claude-upgrade')).toBeDefined();
      });
    });

    it('shows message count', async () => {
      setupDefaultMocks({
        discoverData: {
          sessions: [createDiscoveredSession({ messageCount: 123 })],
          count: 1,
          machinesQueried: 1,
          machinesFailed: 0,
        },
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('123 msgs')).toBeDefined();
      });
    });

    it('limits discovered sessions display to 4', async () => {
      const sessions = Array.from({ length: 6 }, (_, i) =>
        createDiscoveredSession({
          sessionId: `discovered-${i}`,
          summary: `Disc Session ${i}`,
        }),
      );
      setupDefaultMocks({
        discoverData: {
          sessions,
          count: 6,
          machinesQueried: 2,
          machinesFailed: 0,
        },
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('Disc Session 0')).toBeDefined();
        expect(screen.getByText('Disc Session 3')).toBeDefined();
        expect(screen.queryByText('Disc Session 4')).toBeNull();
      });
    });

    it('links discovered sessions to /discover', async () => {
      renderDashboard();
      await waitFor(() => {
        // Multiple discovered sessions each link to /discover, plus View All
        expect(screen.getAllByTestId('link-/discover').length).toBeGreaterThan(0);
      });
    });
  });

  // =========================================================================
  // 9. Empty states
  // =========================================================================

  describe('Empty states', () => {
    it('shows empty message for sessions when no sessions exist', async () => {
      setupDefaultMocks({
        sessionsData: { sessions: [], total: 0, limit: 50, offset: 0, hasMore: false },
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('No sessions yet. Create a session to get started.')).toBeDefined();
      });
    });

    it('shows empty message for machines when none registered', async () => {
      setupDefaultMocks({ machinesData: [] });
      renderDashboard();
      await waitFor(() => {
        expect(
          screen.getByText(
            'No machines registered. Run setup-machine.sh on a host to register it.',
          ),
        ).toBeDefined();
      });
    });
  });

  // =========================================================================
  // 10. Loading states (skeletons)
  // =========================================================================

  describe('Loading states', () => {
    it('shows loading skeletons for sessions when loading', async () => {
      setupDefaultMocks({ neverResolve: ['sessions'] });
      renderDashboard();
      await waitFor(() => {
        const skeletons = screen.getAllByTestId('skeleton');
        expect(skeletons.length).toBeGreaterThan(0);
      });
    });

    it('shows loading skeletons for machines when loading', async () => {
      setupDefaultMocks({ neverResolve: ['machines'] });
      renderDashboard();
      await waitFor(() => {
        const skeletons = screen.getAllByTestId('skeleton');
        expect(skeletons.length).toBeGreaterThan(0);
      });
    });

    it('renders fetching bar component', () => {
      renderDashboard();
      expect(screen.getByTestId('fetching-bar')).toBeDefined();
    });

    it('shows fetching bar as fetching when data is loading', () => {
      setupDefaultMocks({ neverResolve: ['sessions'] });
      renderDashboard();
      const fetchingBar = screen.getByTestId('fetching-bar');
      expect(fetchingBar.textContent).toContain('fetching');
    });
  });

  // =========================================================================
  // 11. Error handling
  // =========================================================================

  describe('Error handling', () => {
    it('displays error banner on health query failure', async () => {
      mockHealthQuery.mockReturnValue({
        queryKey: ['health'],
        queryFn: vi.fn().mockRejectedValue(new Error('Network error')),
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByTestId('error-banner')).toBeDefined();
        expect(screen.getByText(/Control plane: Network error/)).toBeDefined();
      });
    });

    it('displays error banner on sessions query failure', async () => {
      mockSessionsQuery.mockReturnValue({
        queryKey: ['sessions'],
        queryFn: vi.fn().mockRejectedValue(new Error('Sessions fetch failed')),
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByTestId('error-banner')).toBeDefined();
        expect(screen.getByText(/Sessions: Sessions fetch failed/)).toBeDefined();
      });
    });

    it('shows retry button in error banner', async () => {
      mockHealthQuery.mockReturnValue({
        queryKey: ['health'],
        queryFn: vi.fn().mockRejectedValue(new Error('fail')),
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('Retry')).toBeDefined();
      });
    });
  });

  // =========================================================================
  // 12. Keyboard help overlay
  // =========================================================================

  describe('Keyboard help overlay', () => {
    it('does not show overlay by default', () => {
      renderDashboard();
      expect(screen.queryByTestId('keyboard-help-overlay')).toBeNull();
    });

    it('opens overlay when keyboard shortcuts button is clicked', async () => {
      renderDashboard();
      fireEvent.click(screen.getByLabelText('Show keyboard shortcuts'));
      await waitFor(() => {
        expect(screen.getByTestId('keyboard-help-overlay')).toBeDefined();
      });
    });

    it('closes overlay when close button is clicked', async () => {
      renderDashboard();
      fireEvent.click(screen.getByLabelText('Show keyboard shortcuts'));
      await waitFor(() => {
        expect(screen.getByTestId('keyboard-help-overlay')).toBeDefined();
      });
      fireEvent.click(screen.getByTestId('close-help'));
      await waitFor(() => {
        expect(screen.queryByTestId('keyboard-help-overlay')).toBeNull();
      });
    });

    it('registers ? hotkey via useHotkeys', () => {
      renderDashboard();
      expect(mockUseHotkeys).toHaveBeenCalled();
      const hotkeyMap = mockUseHotkeys.mock.calls[0]?.[0];
      expect(hotkeyMap).toHaveProperty('?');
      expect(typeof hotkeyMap['?']).toBe('function');
    });

    it('registers r hotkey for refresh via useHotkeys', () => {
      renderDashboard();
      const hotkeyMap = mockUseHotkeys.mock.calls[0]?.[0];
      expect(hotkeyMap).toHaveProperty('r');
      expect(typeof hotkeyMap.r).toBe('function');
    });
  });

  // =========================================================================
  // 13. Action buttons in health card
  // =========================================================================

  describe('Action buttons', () => {
    it('renders "Discover Sessions" action button', () => {
      renderDashboard();
      expect(screen.getByText('Discover Sessions')).toBeDefined();
    });

    it('renders "Refresh All" action button', () => {
      renderDashboard();
      expect(screen.getByText('Refresh All')).toBeDefined();
    });
  });

  // =========================================================================
  // 14. Platform summary bar
  // =========================================================================

  describe('Platform summary bar', () => {
    it('renders "Platform" label', async () => {
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('Platform')).toBeDefined();
      });
    });

    it('shows "Healthy" when control plane is up', async () => {
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('Healthy')).toBeDefined();
      });
    });

    it('shows "Down" when control plane is not up', async () => {
      setupDefaultMocks({
        metricsData: {
          agentctl_agents_active: 0,
          agentctl_runs_total: 0,
          agentctl_control_plane_up: 0,
          agentctl_total_cost_usd: 0,
        },
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('Down')).toBeDefined();
      });
    });

    it('shows total cost from metrics in platform bar', async () => {
      setupDefaultMocks({
        metricsData: {
          agentctl_agents_active: 0,
          agentctl_runs_total: 0,
          agentctl_control_plane_up: 1,
          agentctl_total_cost_usd: 42.5,
        },
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('$42.50')).toBeDefined();
      });
    });

    it('shows runs count in platform bar', async () => {
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('10')).toBeDefined();
      });
    });

    it('shows active sessions count in platform bar', async () => {
      renderDashboard();
      await waitFor(() => {
        // Active Sessions in the platform bar
        expect(screen.getByText(/Active Sessions:/)).toBeDefined();
      });
    });
  });

  // =========================================================================
  // 15. Cost by Agent (platform bar)
  // =========================================================================

  describe('Cost by Agent', () => {
    it('renders cost breakdown by agent when agents have costs', async () => {
      setupDefaultMocks({
        agentsData: [
          createAgent({ id: 'a1', name: 'expensive-bot', totalCostUsd: 10.0 }),
          createAgent({ id: 'a2', name: 'cheap-bot', totalCostUsd: 2.0 }),
        ],
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getAllByText('Cost by Agent').length).toBeGreaterThan(0);
        expect(screen.getAllByText('expensive-bot').length).toBeGreaterThan(0);
        expect(screen.getAllByText('cheap-bot').length).toBeGreaterThan(0);
      });
    });

    it('shows "No cost data recorded yet" when no agents have cost', async () => {
      setupDefaultMocks({
        agentsData: [createAgent({ totalCostUsd: 0 })],
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('No cost data recorded yet')).toBeDefined();
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
      setupDefaultMocks({ agentsData: agents });
      renderDashboard();
      await waitFor(() => {
        // Top 5 should be visible
        expect(screen.getAllByText('agent-0').length).toBeGreaterThan(0);
        expect(screen.getAllByText('agent-4').length).toBeGreaterThan(0);
      });
    });

    it('shows lastCostUsd for agents when available and positive', async () => {
      setupDefaultMocks({
        agentsData: [
          createAgent({ id: 'a1', name: 'bot-with-last', totalCostUsd: 10.0, lastCostUsd: 2.5 }),
        ],
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('(last: $2.50)')).toBeDefined();
      });
    });

    it('renders agent cost links pointing to agent detail', async () => {
      setupDefaultMocks({
        agentsData: [createAgent({ id: 'agent-42', name: 'my-agent', totalCostUsd: 5.0 })],
      });
      renderDashboard();
      await waitFor(() => {
        // Agent appears in both platform bar and cost overview sections
        expect(screen.getAllByTestId('link-/agents/agent-42').length).toBeGreaterThan(0);
      });
    });
  });

  // =========================================================================
  // 16. Cost Overview section
  // =========================================================================

  describe('Cost Overview', () => {
    it('renders when sessions have costs', async () => {
      setupDefaultMocks({
        sessionsData: {
          sessions: [
            createSession({ id: 's1', metadata: { costUsd: 3.0 } }),
            createSession({ id: 's2', metadata: { costUsd: 2.0 } }),
          ],
          total: 2,
          limit: 100,
          offset: 0,
          hasMore: false,
        },
        agentsData: [createAgent({ totalCostUsd: 5.0 })],
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('Cost Overview')).toBeDefined();
        expect(screen.getByText('Total Session Cost')).toBeDefined();
      });
    });

    it('does not render when no cost data exists', async () => {
      setupDefaultMocks({
        sessionsData: {
          sessions: [createSession({ metadata: {} })],
          total: 1,
          limit: 100,
          offset: 0,
          hasMore: false,
        },
        agentsData: [createAgent({ totalCostUsd: 0 })],
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.queryByText('Cost Overview')).toBeNull();
      });
    });

    it('renders Most Expensive Sessions list', async () => {
      setupDefaultMocks({
        sessionsData: {
          sessions: [
            createSession({ id: 's1', agentName: 'big-spender', metadata: { costUsd: 10.0 } }),
            createSession({ id: 's2', agentName: 'moderate', metadata: { costUsd: 5.0 } }),
          ],
          total: 2,
          limit: 100,
          offset: 0,
          hasMore: false,
        },
        agentsData: [createAgent({ totalCostUsd: 15.0 })],
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('Most Expensive Sessions')).toBeDefined();
        expect(screen.getByText('big-spender')).toBeDefined();
      });
    });

    it('shows "No session cost data yet" when no sessions have costs', async () => {
      // We need agents with costs so the Cost Overview renders,
      // but sessions without costs
      setupDefaultMocks({
        sessionsData: {
          sessions: [createSession({ metadata: {} })],
          total: 1,
          limit: 100,
          offset: 0,
          hasMore: false,
        },
        agentsData: [createAgent({ totalCostUsd: 5.0 })],
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('No session cost data yet')).toBeDefined();
      });
    });

    it('shows cost bar chart for agents', async () => {
      setupDefaultMocks({
        sessionsData: {
          sessions: [createSession({ metadata: { costUsd: 1.0 } })],
          total: 1,
          limit: 100,
          offset: 0,
          hasMore: false,
        },
        agentsData: [
          createAgent({ id: 'a1', name: 'alpha', totalCostUsd: 10.0 }),
          createAgent({ id: 'a2', name: 'beta', totalCostUsd: 5.0 }),
        ],
      });
      renderDashboard();
      await waitFor(() => {
        // Check that cost overview renders agent bars
        expect(screen.getAllByText('alpha').length).toBeGreaterThan(0);
        expect(screen.getAllByText('beta').length).toBeGreaterThan(0);
      });
    });
  });

  // =========================================================================
  // 17. Dependencies section
  // =========================================================================

  describe('Dependencies', () => {
    it('renders Dependencies section when health has dependencies', async () => {
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('Dependencies')).toBeDefined();
        expect(screen.getByText('postgres')).toBeDefined();
        expect(screen.getByText('redis')).toBeDefined();
      });
    });

    it('does not render Dependencies section when no dependencies', async () => {
      setupDefaultMocks({
        healthData: {
          status: 'ok',
          timestamp: new Date().toISOString(),
        },
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.queryByText('Dependencies')).toBeNull();
      });
    });

    it('shows OK status for healthy dependencies', async () => {
      renderDashboard();
      await waitFor(() => {
        const okElements = screen.getAllByText('OK');
        expect(okElements.length).toBeGreaterThan(0);
      });
    });

    it('shows ERR status for errored dependencies', async () => {
      setupDefaultMocks({
        healthData: {
          status: 'degraded',
          timestamp: new Date().toISOString(),
          dependencies: {
            redis: { status: 'error', latencyMs: 0, error: 'Connection refused' },
          },
        },
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('ERR')).toBeDefined();
      });
    });

    it('shows error message for errored dependencies', async () => {
      setupDefaultMocks({
        healthData: {
          status: 'degraded',
          timestamp: new Date().toISOString(),
          dependencies: {
            redis: { status: 'error', latencyMs: 0, error: 'Connection refused' },
          },
        },
      });
      renderDashboard();
      await waitFor(() => {
        // Error text is split across elements: "<span>redis</span>: Connection refused"
        // Parent and child both match textContent, so use getAllByText
        const matches = screen.getAllByText((_content, element) => {
          return element?.textContent === 'redis: Connection refused';
        });
        expect(matches.length).toBeGreaterThan(0);
      });
    });

    it('shows SLOW label for high-latency dependencies (>500ms)', async () => {
      setupDefaultMocks({
        healthData: {
          status: 'ok',
          timestamp: new Date().toISOString(),
          dependencies: {
            redis: { status: 'ok', latencyMs: 800 },
          },
        },
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('SLOW')).toBeDefined();
        expect(screen.getByText('800ms')).toBeDefined();
      });
    });

    it('shows latency in ms for dependencies with positive latency', async () => {
      setupDefaultMocks({
        healthData: {
          status: 'ok',
          timestamp: new Date().toISOString(),
          dependencies: {
            redis: { status: 'ok', latencyMs: 12 },
          },
        },
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('12ms')).toBeDefined();
      });
    });

    it('shows dash for dependencies with zero latency', async () => {
      setupDefaultMocks({
        healthData: {
          status: 'ok',
          timestamp: new Date().toISOString(),
          dependencies: {
            redis: { status: 'ok', latencyMs: 0 },
          },
        },
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('-')).toBeDefined();
      });
    });

    it('renders all dependency names', async () => {
      setupDefaultMocks({
        healthData: {
          status: 'ok',
          timestamp: new Date().toISOString(),
          dependencies: {
            postgres: { status: 'ok', latencyMs: 12 },
            redis: { status: 'ok', latencyMs: 5 },
            kubernetes: { status: 'ok', latencyMs: 25 },
          },
        },
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('postgres')).toBeDefined();
        expect(screen.getByText('redis')).toBeDefined();
        expect(screen.getByText('kubernetes')).toBeDefined();
      });
    });
  });

  // =========================================================================
  // 18. Refresh functionality
  // =========================================================================

  describe('Refresh', () => {
    it('renders refresh button', () => {
      renderDashboard();
      expect(screen.getByTestId('refresh-button')).toBeDefined();
    });

    it('disables refresh button while data is being fetched', () => {
      setupDefaultMocks({ neverResolve: ['sessions'] });
      renderDashboard();
      const refreshButton = screen.getByTestId('refresh-button') as HTMLButtonElement;
      expect(refreshButton.disabled).toBe(true);
    });
  });

  // =========================================================================
  // 19. Data handling edge cases
  // =========================================================================

  describe('Edge cases', () => {
    it('handles empty metrics data gracefully', async () => {
      setupDefaultMocks({ metricsData: {} });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByTestId('stat-value-Active Runs').textContent).toBe('0');
      });
    });

    it('handles sessions with null model gracefully', async () => {
      setupDefaultMocks({
        sessionsData: {
          sessions: [createSession({ model: null })],
          total: 1,
          limit: 50,
          offset: 0,
          hasMore: false,
        },
      });
      renderDashboard();
      await waitFor(() => {
        // Should render without crashing
        expect(screen.getByText('Recent Sessions')).toBeDefined();
      });
    });

    it('handles sessions with null projectPath gracefully', async () => {
      setupDefaultMocks({
        sessionsData: {
          sessions: [createSession({ projectPath: null })],
          total: 1,
          limit: 50,
          offset: 0,
          hasMore: false,
        },
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.queryByTestId('path-badge')).toBeNull();
      });
    });

    it('handles agents with zero totalCostUsd (excluded from breakdown)', async () => {
      setupDefaultMocks({
        agentsData: [
          createAgent({ id: 'a1', name: 'zero-cost', totalCostUsd: 0 }),
          createAgent({ id: 'a2', name: 'has-cost', totalCostUsd: 10 }),
        ],
      });
      renderDashboard();
      await waitFor(() => {
        // has-cost should appear in cost breakdown, zero-cost should not
        expect(screen.getAllByText('has-cost').length).toBeGreaterThan(0);
      });
    });

    it('handles all queries returning empty data', async () => {
      setupDefaultMocks({
        healthData: undefined,
        metricsData: {},
        machinesData: [],
        agentsData: [],
        discoverData: { sessions: [], count: 0, machinesQueried: 0, machinesFailed: 0 },
        sessionsData: { sessions: [], total: 0, limit: 50, offset: 0, hasMore: false },
      });
      renderDashboard();
      await waitFor(() => {
        expect(screen.getByText('Command center')).toBeDefined();
        expect(screen.getByText('No sessions yet. Create a session to get started.')).toBeDefined();
      });
    });
  });
});
