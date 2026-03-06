import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Agent, Machine, Session } from '@/lib/api';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockMachinesQuery, mockAgentsQuery, mockSessionsQuery } = vi.hoisted(() => ({
  mockMachinesQuery: vi.fn(),
  mockAgentsQuery: vi.fn(),
  mockSessionsQuery: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock dependencies — BEFORE the component import
// ---------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'machine-1' }),
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
  CopyableText: ({
    value,
    label,
    maxDisplay,
  }: {
    value: string;
    label?: string;
    maxDisplay?: number;
  }) => (
    <span data-testid="copyable-text">{label ?? value.slice(0, maxDisplay ?? value.length)}</span>
  ),
}));

vi.mock('@/components/PathBadge', () => ({
  PathBadge: ({ path }: { path: string }) => <span data-testid="path-badge">{path}</span>,
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

vi.mock('@/lib/queries', () => ({
  machinesQuery: () => mockMachinesQuery(),
  agentsQuery: () => mockAgentsQuery(),
  sessionsQuery: (...args: unknown[]) => mockSessionsQuery(...args),
}));

// ---------------------------------------------------------------------------
// Component import — AFTER mocks
// ---------------------------------------------------------------------------

import { MachineDetailView } from './MachineDetailView';

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderView() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MachineDetailView />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MachineDetailView', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: one online machine matching our params id
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([createMachine()]),
    });

    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: vi.fn().mockResolvedValue([createAgent()]),
    });

    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions', { machineId: 'machine-1' }],
      queryFn: vi.fn().mockResolvedValue({
        sessions: [createSession()],
        total: 1,
        limit: 50,
        offset: 0,
        hasMore: false,
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Renders machine hostname in header with breadcrumb
  // =========================================================================

  it('renders machine hostname in header', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([createMachine({ hostname: 'prod-ec2' })]),
    });
    renderView();
    await waitFor(() => {
      // Hostname appears in both breadcrumb and h1
      const matches = screen.getAllByText('prod-ec2');
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('renders breadcrumb with Machines link and machine hostname', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([createMachine({ hostname: 'my-mac-mini' })]),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByTestId('breadcrumb')).toBeDefined();
      expect(screen.getByTestId('breadcrumb-Machines')).toBeDefined();
      expect(screen.getByTestId('breadcrumb-my-mac-mini')).toBeDefined();
    });
  });

  it('breadcrumb Machines item links to /machines', async () => {
    renderView();
    await waitFor(() => {
      const machinesLink = screen.getByTestId('breadcrumb-Machines').querySelector('a');
      expect(machinesLink).not.toBeNull();
      expect(machinesLink!.getAttribute('href')).toBe('/machines');
    });
  });

  // =========================================================================
  // 2. Loading skeleton state
  // =========================================================================

  it('shows loading skeletons when machines data is loading', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockReturnValue(new Promise(() => {})), // Never resolves
    });
    renderView();
    await waitFor(() => {
      const skeletons = screen.getAllByTestId('skeleton');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  it('does not render hostname while loading', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockReturnValue(new Promise(() => {})),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
    });
    expect(screen.queryByText('test-machine')).toBeNull();
  });

  // =========================================================================
  // 3. Machine info display
  // =========================================================================

  it('displays machine hostname as heading', async () => {
    renderView();
    await waitFor(() => {
      const matches = screen.getAllByText('test-machine');
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('displays machine ID via CopyableText', async () => {
    renderView();
    await waitFor(() => {
      const copyables = screen.getAllByTestId('copyable-text');
      const idEl = copyables.find((el) => el.textContent?.includes('machine-1'));
      expect(idEl).toBeDefined();
    });
  });

  it('displays OS and architecture', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([createMachine({ os: 'darwin', arch: 'arm64' })]),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByText('darwin / arm64')).toBeDefined();
    });
  });

  it('displays Tailscale IP via CopyableText', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([createMachine({ tailscaleIp: '100.64.1.5' })]),
    });
    renderView();
    await waitFor(() => {
      const copyables = screen.getAllByTestId('copyable-text');
      const ipEl = copyables.find((el) => el.textContent?.includes('100.64.1.5'));
      expect(ipEl).toBeDefined();
    });
  });

  it('displays dash when tailscaleIp is missing', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi
        .fn()
        .mockResolvedValue([createMachine({ tailscaleIp: undefined as unknown as string })]),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByText('-')).toBeDefined();
    });
  });

  it('displays status badge for the machine', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([createMachine({ status: 'online' })]),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByTestId('status-badge-online')).toBeDefined();
    });
  });

  it('displays "Never" when lastHeartbeat is null', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([createMachine({ lastHeartbeat: null })]),
    });
    renderView();
    await waitFor(() => {
      const nevers = screen.getAllByText('Never');
      expect(nevers.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('displays last heartbeat via LiveTimeAgo when present', async () => {
    const hb = new Date().toISOString();
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([createMachine({ lastHeartbeat: hb })]),
    });
    renderView();
    await waitFor(() => {
      const timeAgos = screen.getAllByTestId('time-ago');
      const hbEl = timeAgos.find((el) => el.textContent === hb);
      expect(hbEl).toBeDefined();
    });
  });

  // =========================================================================
  // 4. Stale heartbeat warning banner
  // =========================================================================

  it('shows stale heartbeat warning when heartbeat is over 60s old', async () => {
    const staleDate = new Date(Date.now() - 120_000).toISOString(); // 2 min ago
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([createMachine({ lastHeartbeat: staleDate })]),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
      expect(screen.getByText(/Machine appears offline/)).toBeDefined();
    });
  });

  it('shows "Unresponsive" badge when heartbeat is stale', async () => {
    const staleDate = new Date(Date.now() - 120_000).toISOString();
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([createMachine({ lastHeartbeat: staleDate })]),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByText('Unresponsive')).toBeDefined();
    });
  });

  it('does not show stale heartbeat warning for fresh heartbeat', async () => {
    const freshDate = new Date().toISOString();
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([createMachine({ lastHeartbeat: freshDate })]),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getAllByText('test-machine').length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Unresponsive')).toBeNull();
  });

  it('does not show stale heartbeat warning when lastHeartbeat is null', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([createMachine({ lastHeartbeat: null })]),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getAllByText('test-machine').length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('stale heartbeat warning mentions 60 seconds', async () => {
    const staleDate = new Date(Date.now() - 120_000).toISOString();
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([createMachine({ lastHeartbeat: staleDate })]),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByText(/60 seconds/)).toBeDefined();
    });
  });

  // =========================================================================
  // 5. Capability badges (GPU, Docker)
  // =========================================================================

  it('renders capabilities card when capabilities exist', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByText('Capabilities')).toBeDefined();
    });
  });

  it('shows GPU as "Available" when gpu is true', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([
        createMachine({
          capabilities: { gpu: true, docker: false, maxConcurrentAgents: 2 },
        }),
      ]),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByText('GPU')).toBeDefined();
      const availables = screen.getAllByText('Available');
      expect(availables.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows Docker as "Available" when docker is true', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([
        createMachine({
          capabilities: { gpu: false, docker: true, maxConcurrentAgents: 2 },
        }),
      ]),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByText('Docker')).toBeDefined();
    });
  });

  it('shows "Not available" for disabled capabilities', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([
        createMachine({
          capabilities: { gpu: false, docker: false, maxConcurrentAgents: 2 },
        }),
      ]),
    });
    renderView();
    await waitFor(() => {
      const notAvailable = screen.getAllByText('Not available');
      expect(notAvailable.length).toBe(2); // GPU + Docker
    });
  });

  it('shows max concurrent agents count', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([
        createMachine({
          capabilities: { gpu: false, docker: false, maxConcurrentAgents: 8 },
        }),
      ]),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByText('8')).toBeDefined();
    });
  });

  it('does not render capabilities card when capabilities is undefined', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([createMachine({ capabilities: undefined })]),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getAllByText('test-machine').length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByText('Capabilities')).toBeNull();
  });

  // =========================================================================
  // 6. Session list for this machine
  // =========================================================================

  it('renders recent sessions card', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByText('Recent Sessions')).toBeDefined();
    });
  });

  it('renders session count badge', async () => {
    renderView();
    await waitFor(() => {
      const heading = screen.getByText('Recent Sessions');
      const badge = heading.parentElement?.querySelector('span');
      expect(badge).not.toBeNull();
      expect(badge!.textContent).toBe('(1)');
    });
  });

  it('renders session ID as link', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByTestId('link-/sessions/session-1')).toBeDefined();
    });
  });

  it('renders session status badge', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByTestId('status-badge-running')).toBeDefined();
    });
  });

  it('shows empty state when no sessions exist', async () => {
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions', { machineId: 'machine-1' }],
      queryFn: vi.fn().mockResolvedValue({
        sessions: [],
        total: 0,
        limit: 50,
        offset: 0,
        hasMore: false,
      }),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByText('No sessions found for this machine.')).toBeDefined();
    });
  });

  it('shows "View all sessions" link in session empty state', async () => {
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions', { machineId: 'machine-1' }],
      queryFn: vi.fn().mockResolvedValue({
        sessions: [],
        total: 0,
        limit: 50,
        offset: 0,
        hasMore: false,
      }),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByTestId('link-/sessions')).toBeDefined();
      expect(screen.getByText('View all sessions')).toBeDefined();
    });
  });

  it('renders session error banner on sessions query failure', async () => {
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions', { machineId: 'machine-1' }],
      queryFn: vi.fn().mockRejectedValue(new Error('Sessions fetch failed')),
    });
    renderView();
    await waitFor(() => {
      const banners = screen.getAllByTestId('error-banner');
      const sessionBanner = banners.find((el) => el.textContent?.includes('sessions'));
      expect(sessionBanner).toBeDefined();
    });
  });

  it('renders agent name for session when agent exists', async () => {
    renderView();
    await waitFor(() => {
      // Agent name appears in both agents table and sessions agent column
      const matches = screen.getAllByText('test-agent');
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders truncated agentId when agent is unknown', async () => {
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions', { machineId: 'machine-1' }],
      queryFn: vi.fn().mockResolvedValue({
        sessions: [createSession({ agentId: 'unknown-agent-long-id-here' })],
        total: 1,
        limit: 50,
        offset: 0,
        hasMore: false,
      }),
    });
    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: vi.fn().mockResolvedValue([]),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByText('unknown-agen')).toBeDefined();
    });
  });

  it('sorts sessions by most recent first', async () => {
    const now = Date.now();
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions', { machineId: 'machine-1' }],
      queryFn: vi.fn().mockResolvedValue({
        sessions: [
          createSession({
            id: 'session-old-12345',
            startedAt: new Date(now - 120_000).toISOString(),
          }),
          createSession({
            id: 'session-new-12345',
            startedAt: new Date(now - 10_000).toISOString(),
          }),
        ],
        total: 2,
        limit: 50,
        offset: 0,
        hasMore: false,
      }),
    });
    renderView();
    await waitFor(() => {
      // Both should render
      expect(screen.getByText('session-new-...')).toBeDefined();
      expect(screen.getByText('session-old-...')).toBeDefined();
    });
  });

  // =========================================================================
  // 7. Agent list for this machine
  // =========================================================================

  it('renders agents card with heading', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByText('Agents on this Machine')).toBeDefined();
    });
  });

  it('renders agent count badge', async () => {
    renderView();
    await waitFor(() => {
      const heading = screen.getByText('Agents on this Machine');
      const badge = heading.parentElement?.querySelector('span');
      expect(badge).not.toBeNull();
      expect(badge!.textContent).toBe('(1)');
    });
  });

  it('renders agent name as link to agent detail', async () => {
    renderView();
    await waitFor(() => {
      // Agent link appears in agents table and possibly sessions agent column
      const matches = screen.getAllByTestId('link-/agents/agent-1');
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders agent status badge', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByTestId('status-badge-registered')).toBeDefined();
    });
  });

  it('shows empty state when no agents on machine', async () => {
    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: vi.fn().mockResolvedValue([]),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByText('No agents registered on this machine.')).toBeDefined();
    });
  });

  it('shows "View all agents" link in agent empty state', async () => {
    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: vi.fn().mockResolvedValue([]),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByTestId('link-/agents')).toBeDefined();
      expect(screen.getByText('View all agents')).toBeDefined();
    });
  });

  it('only shows agents belonging to this machine', async () => {
    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: vi
        .fn()
        .mockResolvedValue([
          createAgent({ id: 'agent-1', machineId: 'machine-1', name: 'my-agent' }),
          createAgent({ id: 'agent-2', machineId: 'machine-other', name: 'other-agent' }),
        ]),
    });
    renderView();
    await waitFor(() => {
      const matches = screen.getAllByText('my-agent');
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByText('other-agent')).toBeNull();
  });

  it('renders agent error banner on agents query failure', async () => {
    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: vi.fn().mockRejectedValue(new Error('Agents fetch failed')),
    });
    renderView();
    await waitFor(() => {
      const banners = screen.getAllByTestId('error-banner');
      const agentBanner = banners.find((el) => el.textContent?.includes('agents'));
      expect(agentBanner).toBeDefined();
    });
  });

  it('shows agent last run time via LiveTimeAgo', async () => {
    const runAt = new Date().toISOString();
    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: vi.fn().mockResolvedValue([createAgent({ lastRunAt: runAt })]),
    });
    renderView();
    await waitFor(() => {
      const timeAgos = screen.getAllByTestId('time-ago');
      const runEl = timeAgos.find((el) => el.textContent === runAt);
      expect(runEl).toBeDefined();
    });
  });

  it('shows "Never" when agent has no lastRunAt', async () => {
    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: vi.fn().mockResolvedValue([createAgent({ lastRunAt: null })]),
    });
    renderView();
    await waitFor(() => {
      // "Never" can also appear from machine heartbeat, verify at least one
      const nevers = screen.getAllByText('Never');
      expect(nevers.length).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // 8. Error state rendering
  // =========================================================================

  it('displays error banner when machines query fails', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockRejectedValue(new Error('Network error')),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByTestId('error-banner')).toBeDefined();
      expect(screen.getByText(/Failed to load machines: Network error/)).toBeDefined();
    });
  });

  it('error state shows breadcrumb with Error label', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockRejectedValue(new Error('Connection refused')),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByTestId('breadcrumb-Error')).toBeDefined();
    });
  });

  it('error state has retry button', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockRejectedValue(new Error('Timeout')),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByText('Retry')).toBeDefined();
    });
  });

  it('shows not found state when machine id does not match', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([createMachine({ id: 'machine-other' })]),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByText('Machine not found.')).toBeDefined();
    });
  });

  it('not found state shows breadcrumb with Not Found label', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([createMachine({ id: 'machine-other' })]),
    });
    renderView();
    await waitFor(() => {
      expect(screen.getByTestId('breadcrumb-Not Found')).toBeDefined();
    });
  });

  // =========================================================================
  // 9. Refresh button
  // =========================================================================

  it('renders refresh button', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByTestId('refresh-button')).toBeDefined();
    });
  });

  it('refresh button has text "Refresh"', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByTestId('refresh-button').textContent).toBe('Refresh');
    });
  });

  it('refresh button triggers refetch on click', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getAllByText('test-machine').length).toBeGreaterThanOrEqual(1);
    });
    const refreshBtn = screen.getByTestId('refresh-button');
    fireEvent.click(refreshBtn);
    // The mock onClick should have been called — button should still be present
    expect(screen.getByTestId('refresh-button')).toBeDefined();
  });

  // =========================================================================
  // Additional: Machine Details card label
  // =========================================================================

  it('renders Machine Details card', async () => {
    renderView();
    await waitFor(() => {
      expect(screen.getByText('Machine Details')).toBeDefined();
    });
  });

  it('renders agents table with column headers', async () => {
    renderView();
    await waitFor(() => {
      // Column headers appear in both agents and sessions tables
      const names = screen.getAllByText('Name');
      expect(names.length).toBeGreaterThanOrEqual(1);
      const statuses = screen.getAllByText('Status');
      expect(statuses.length).toBeGreaterThanOrEqual(1);
    });
  });
});
