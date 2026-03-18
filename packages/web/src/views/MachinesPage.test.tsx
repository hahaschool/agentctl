import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Machine } from '@/lib/api';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockMachinesQuery } = vi.hoisted(() => ({
  mockMachinesQuery: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock dependencies — BEFORE the component import
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

vi.mock('@/components/RefreshButton', () => ({
  RefreshButton: ({ onClick, isFetching }: { onClick: () => void; isFetching: boolean }) => (
    <button type="button" data-testid="refresh-button" disabled={isFetching} onClick={onClick}>
      Refresh
    </button>
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

vi.mock('@/components/CopyableText', () => ({
  CopyableText: ({ value, maxDisplay }: { value: string; maxDisplay?: number }) => (
    <span data-testid="copyable-text">{value.slice(0, maxDisplay ?? 8)}</span>
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

vi.mock('@/components/SimpleTooltip', () => ({
  SimpleTooltip: ({ children }: { children: React.ReactNode; content?: string }) => (
    <span data-testid="simple-tooltip">{children}</span>
  ),
}));

vi.mock('@/lib/queries', () => ({
  machinesQuery: () => mockMachinesQuery(),
}));

// ---------------------------------------------------------------------------
// Component import — AFTER mocks
// ---------------------------------------------------------------------------

import { MachinesPage } from './MachinesPage';

// ---------------------------------------------------------------------------
// Test data factory
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderMachines() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MachinesPage />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MachinesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: one online machine
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([createMachine()]),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Rendering & Layout
  // =========================================================================

  it('renders the page heading', async () => {
    renderMachines();
    expect(screen.getByText('Fleet Machines')).toBeDefined();
  });

  it('renders the page description', async () => {
    renderMachines();
    expect(
      screen.getByText('Machines connected via Tailscale mesh. Auto-refreshes every 10s.'),
    ).toBeDefined();
  });

  it('renders total count badge next to heading', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi
        .fn()
        .mockResolvedValue([
          createMachine({ id: 'machine-1' }),
          createMachine({ id: 'machine-2' }),
        ]),
    });
    renderMachines();
    await waitFor(() => {
      // The count badge is rendered as a span next to the heading
      const heading = screen.getByText('Fleet Machines');
      const badge = heading.parentElement?.querySelector('span');
      expect(badge).toBeDefined();
      expect(badge?.textContent).toBe('2');
    });
  });

  it('renders refresh button', () => {
    renderMachines();
    expect(screen.getByTestId('refresh-button')).toBeDefined();
  });

  // =========================================================================
  // Loading State
  // =========================================================================

  it('shows loading skeletons when data is loading', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockReturnValue(new Promise(() => {})), // Never resolves
    });
    renderMachines();
    await waitFor(() => {
      const skeletons = screen.getAllByTestId('skeleton');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Machine Cards
  // =========================================================================

  it('renders machine cards with hostname', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([createMachine({ hostname: 'prod-ec2' })]),
    });
    renderMachines();
    await waitFor(() => {
      expect(screen.getByText('prod-ec2')).toBeDefined();
    });
  });

  it('renders multiple machine cards', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi
        .fn()
        .mockResolvedValue([
          createMachine({ id: 'machine-1', hostname: 'host-alpha' }),
          createMachine({ id: 'machine-2', hostname: 'host-beta' }),
          createMachine({ id: 'machine-3', hostname: 'host-gamma' }),
        ]),
    });
    renderMachines();
    await waitFor(() => {
      expect(screen.getByText('host-alpha')).toBeDefined();
      expect(screen.getByText('host-beta')).toBeDefined();
      expect(screen.getByText('host-gamma')).toBeDefined();
    });
  });

  it('renders machine link to detail page', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([createMachine({ id: 'machine-42' })]),
    });
    renderMachines();
    await waitFor(() => {
      expect(screen.getByTestId('link-/machines/machine-42')).toBeDefined();
    });
  });

  it('renders Tailscale IP in machine card', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([createMachine({ tailscaleIp: '100.64.1.5' })]),
    });
    renderMachines();
    await waitFor(() => {
      expect(screen.getByText('100.64.1.5')).toBeDefined();
    });
  });

  it('renders OS and architecture', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([createMachine({ os: 'darwin', arch: 'arm64' })]),
    });
    renderMachines();
    await waitFor(() => {
      expect(screen.getByText('darwin / arm64')).toBeDefined();
    });
  });

  it('renders status badge for each machine', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([createMachine({ status: 'online' })]),
    });
    renderMachines();
    await waitFor(() => {
      expect(screen.getByTestId('status-badge-online')).toBeDefined();
    });
  });

  it('renders copyable machine id', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([createMachine({ id: 'machine-abcdef123' })]),
    });
    renderMachines();
    await waitFor(() => {
      expect(screen.getByTestId('copyable-text')).toBeDefined();
    });
  });

  // =========================================================================
  // Stat Summary Cards
  // =========================================================================

  it('shows Total inline machine count', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi
        .fn()
        .mockResolvedValue([
          createMachine({ id: 'machine-1', status: 'online' }),
          createMachine({ id: 'machine-2', status: 'offline' }),
        ]),
    });
    renderMachines();
    await waitFor(() => {
      const inline = screen.getByTestId('machines-inline-stat-total');
      expect(inline.textContent).toContain('2');
    });
  });

  it('shows Online Machines stat card with online/total ratio', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi
        .fn()
        .mockResolvedValue([
          createMachine({ id: 'machine-1', status: 'online' }),
          createMachine({ id: 'machine-2', status: 'online' }),
          createMachine({ id: 'machine-3', status: 'offline' }),
        ]),
    });
    renderMachines();
    await waitFor(() => {
      const statValue = screen.getByTestId('stat-value-Online Machines');
      expect(statValue.textContent).toBe('2 / 3');
    });
  });

  it('shows Offline inline stat with correct count', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi
        .fn()
        .mockResolvedValue([
          createMachine({ id: 'machine-1', status: 'online' }),
          createMachine({ id: 'machine-2', status: 'offline' }),
          createMachine({ id: 'machine-3', status: 'offline' }),
        ]),
    });
    renderMachines();
    await waitFor(() => {
      const inline = screen.getByTestId('machines-inline-stat-offline');
      expect(inline.textContent).toContain('2');
    });
  });

  it('shows "Needs attention" sublabel when offline machines exist', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([createMachine({ id: 'machine-1', status: 'offline' })]),
    });
    renderMachines();
    await waitFor(() => {
      const inline = screen.getByTestId('machines-inline-stat-offline');
      expect(inline.textContent).toContain('Needs attention');
    });
  });

  it('shows "All clear" sublabel when no offline machines', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([createMachine({ id: 'machine-1', status: 'online' })]),
    });
    renderMachines();
    await waitFor(() => {
      const inline = screen.getByTestId('machines-inline-stat-offline');
      expect(inline.textContent).toContain('All clear');
    });
  });

  it('shows Degraded inline stat with correct count', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi
        .fn()
        .mockResolvedValue([
          createMachine({ id: 'machine-1', status: 'degraded' }),
          createMachine({ id: 'machine-2', status: 'online' }),
        ]),
    });
    renderMachines();
    await waitFor(() => {
      const inline = screen.getByTestId('machines-inline-stat-degraded');
      expect(inline.textContent).toContain('1');
    });
  });

  it('shows "Partial issues" sublabel when degraded machines exist', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([createMachine({ id: 'machine-1', status: 'degraded' })]),
    });
    renderMachines();
    await waitFor(() => {
      const inline = screen.getByTestId('machines-inline-stat-degraded');
      expect(inline.textContent).toContain('Partial issues');
    });
  });

  it('shows "Healthy" sublabel when no degraded machines', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([createMachine({ id: 'machine-1', status: 'online' })]),
    });
    renderMachines();
    await waitFor(() => {
      const inline = screen.getByTestId('machines-inline-stat-degraded');
      expect(inline.textContent).toContain('Healthy');
    });
  });

  // =========================================================================
  // Search / Filter Functionality
  // =========================================================================

  it('renders search input', () => {
    renderMachines();
    const searchInput = screen.getByLabelText('Search machines') as HTMLInputElement;
    expect(searchInput).toBeDefined();
    expect(searchInput.value).toBe('');
  });

  it('renders status filter dropdown', () => {
    renderMachines();
    const filterSelect = screen.getByLabelText('Filter by status') as HTMLSelectElement;
    expect(filterSelect).toBeDefined();
    expect(filterSelect.value).toBe('all');
  });

  it('filters machines by search text (hostname)', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi
        .fn()
        .mockResolvedValue([
          createMachine({ id: 'machine-1', hostname: 'prod-server' }),
          createMachine({ id: 'machine-2', hostname: 'dev-laptop' }),
        ]),
    });
    renderMachines();
    await waitFor(() => {
      expect(screen.getByText('prod-server')).toBeDefined();
      expect(screen.getByText('dev-laptop')).toBeDefined();
    });

    const searchInput = screen.getByLabelText('Search machines') as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: 'prod' } });

    await waitFor(() => {
      expect(screen.getByText('prod-server')).toBeDefined();
      expect(screen.queryByText('dev-laptop')).toBeNull();
    });
  });

  it('filters machines by search text (OS)', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi
        .fn()
        .mockResolvedValue([
          createMachine({ id: 'machine-1', hostname: 'mac-mini', os: 'darwin' }),
          createMachine({ id: 'machine-2', hostname: 'ec2-box', os: 'linux' }),
        ]),
    });
    renderMachines();
    await waitFor(() => {
      expect(screen.getByText('mac-mini')).toBeDefined();
      expect(screen.getByText('ec2-box')).toBeDefined();
    });

    const searchInput = screen.getByLabelText('Search machines') as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: 'darwin' } });

    await waitFor(() => {
      expect(screen.getByText('mac-mini')).toBeDefined();
      expect(screen.queryByText('ec2-box')).toBeNull();
    });
  });

  it('filters machines by status dropdown', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi
        .fn()
        .mockResolvedValue([
          createMachine({ id: 'machine-1', hostname: 'online-host', status: 'online' }),
          createMachine({ id: 'machine-2', hostname: 'offline-host', status: 'offline' }),
        ]),
    });
    renderMachines();
    await waitFor(() => {
      expect(screen.getByText('online-host')).toBeDefined();
      expect(screen.getByText('offline-host')).toBeDefined();
    });

    const filterSelect = screen.getByLabelText('Filter by status') as HTMLSelectElement;
    fireEvent.change(filterSelect, { target: { value: 'online' } });

    await waitFor(() => {
      expect(screen.getByText('online-host')).toBeDefined();
      expect(screen.queryByText('offline-host')).toBeNull();
    });
  });

  it('displays filtered/total machine count', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi
        .fn()
        .mockResolvedValue([
          createMachine({ id: 'machine-1', hostname: 'prod-1', status: 'online' }),
          createMachine({ id: 'machine-2', hostname: 'prod-2', status: 'offline' }),
          createMachine({ id: 'machine-3', hostname: 'dev-1', status: 'online' }),
        ]),
    });
    renderMachines();
    await waitFor(() => {
      expect(screen.getByText('3/3 machines')).toBeDefined();
    });

    const filterSelect = screen.getByLabelText('Filter by status') as HTMLSelectElement;
    fireEvent.change(filterSelect, { target: { value: 'online' } });

    await waitFor(() => {
      expect(screen.getByText('2/3 machines')).toBeDefined();
    });
  });

  it('shows filter empty state when no machines match filter', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi
        .fn()
        .mockResolvedValue([
          createMachine({ id: 'machine-1', hostname: 'prod', status: 'online' }),
        ]),
    });
    renderMachines();
    await waitFor(() => {
      expect(screen.getByText('prod')).toBeDefined();
    });

    const filterSelect = screen.getByLabelText('Filter by status') as HTMLSelectElement;
    fireEvent.change(filterSelect, { target: { value: 'offline' } });

    await waitFor(() => {
      expect(screen.getByText('No machines match the current filters')).toBeDefined();
    });
  });

  // =========================================================================
  // Empty State
  // =========================================================================

  it('shows empty state when no machines registered', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([]),
    });
    renderMachines();
    await waitFor(() => {
      expect(screen.getByText('No machines registered')).toBeDefined();
      expect(
        screen.getByText(
          'Register a machine by running ./scripts/setup-machine.sh on the target host.',
        ),
      ).toBeDefined();
    });
  });

  // =========================================================================
  // Stale Heartbeat Badge
  // =========================================================================

  it('shows Offline badge for machines with stale heartbeat', async () => {
    const staleDate = new Date(Date.now() - 120_000).toISOString(); // 2 minutes ago
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([
        createMachine({
          id: 'machine-1',
          hostname: 'stale-host',
          lastHeartbeat: staleDate,
        }),
      ]),
    });
    renderMachines();
    await waitFor(() => {
      // The stale heartbeat badge says "Offline"
      const offlineBadges = screen.getAllByText('Offline');
      expect(offlineBadges.length).toBeGreaterThan(0);
      // Verify it has the expected title
      const badge = offlineBadges.find(
        (el) => el.getAttribute('title') === 'Last heartbeat was more than 60 seconds ago',
      );
      expect(badge).toBeDefined();
    });
  });

  it('does not show stale badge for fresh heartbeat', async () => {
    const freshDate = new Date().toISOString(); // just now
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([
        createMachine({
          id: 'machine-1',
          hostname: 'fresh-host',
          lastHeartbeat: freshDate,
        }),
      ]),
    });
    renderMachines();
    await waitFor(() => {
      expect(screen.getByText('fresh-host')).toBeDefined();
    });
    // Should NOT find an "Offline" badge element with the stale heartbeat title
    const offlineElements = screen.queryAllByText('Offline');
    const staleBadge = offlineElements.find(
      (el) => el.getAttribute('title') === 'Last heartbeat was more than 60 seconds ago',
    );
    expect(staleBadge).toBeUndefined();
  });

  it('does not show stale badge when lastHeartbeat is null', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([
        createMachine({
          id: 'machine-1',
          hostname: 'no-heartbeat-host',
          lastHeartbeat: null,
        }),
      ]),
    });
    renderMachines();
    await waitFor(() => {
      expect(screen.getByText('no-heartbeat-host')).toBeDefined();
    });
    const offlineElements = screen.queryAllByText('Offline');
    const staleBadge = offlineElements.find(
      (el) => el.getAttribute('title') === 'Last heartbeat was more than 60 seconds ago',
    );
    expect(staleBadge).toBeUndefined();
  });

  // =========================================================================
  // Capability Badges
  // =========================================================================

  it('renders GPU capability badge', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([
        createMachine({
          capabilities: { gpu: true, docker: false, maxConcurrentAgents: 2 },
        }),
      ]),
    });
    renderMachines();
    await waitFor(() => {
      expect(screen.getByText('GPU')).toBeDefined();
    });
  });

  it('renders Docker capability badge', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([
        createMachine({
          capabilities: { gpu: false, docker: true, maxConcurrentAgents: 4 },
        }),
      ]),
    });
    renderMachines();
    await waitFor(() => {
      expect(screen.getByText('Docker')).toBeDefined();
    });
  });

  it('renders max concurrent agents count', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([
        createMachine({
          capabilities: { gpu: false, docker: false, maxConcurrentAgents: 8 },
        }),
      ]),
    });
    renderMachines();
    await waitFor(() => {
      expect(screen.getByText('8 max agents')).toBeDefined();
    });
  });

  it('renders both GPU and Docker badges when both enabled', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([
        createMachine({
          capabilities: { gpu: true, docker: true, maxConcurrentAgents: 4 },
        }),
      ]),
    });
    renderMachines();
    await waitFor(() => {
      expect(screen.getByText('GPU')).toBeDefined();
      expect(screen.getByText('Docker')).toBeDefined();
      expect(screen.getByText('Capabilities')).toBeDefined();
    });
  });

  it('does not render capabilities section when capabilities is undefined', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([createMachine({ capabilities: undefined })]),
    });
    renderMachines();
    await waitFor(() => {
      expect(screen.getByText('test-machine')).toBeDefined();
    });
    expect(screen.queryByText('Capabilities')).toBeNull();
  });

  // =========================================================================
  // Detail Fields
  // =========================================================================

  it('shows "Never" when lastHeartbeat is null', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([createMachine({ lastHeartbeat: null })]),
    });
    renderMachines();
    await waitFor(() => {
      expect(screen.getByText('Never')).toBeDefined();
    });
  });

  it('shows dash for missing tailscaleIp', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi
        .fn()
        .mockResolvedValue([createMachine({ tailscaleIp: undefined as unknown as string })]),
    });
    renderMachines();
    await waitFor(() => {
      expect(screen.getByText('-')).toBeDefined();
    });
  });

  // =========================================================================
  // Error State
  // =========================================================================

  it('displays error banner on query failure', async () => {
    const error = new Error('Network error');
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockRejectedValue(error),
    });
    renderMachines();
    await waitFor(() => {
      expect(screen.getByTestId('error-banner')).toBeDefined();
    });
  });

  // =========================================================================
  // Compact View Toggle
  // =========================================================================

  it('renders Compact toggle button', async () => {
    renderMachines();
    await waitFor(() => {
      expect(screen.getByText('Compact')).toBeDefined();
    });
  });

  it('switches to compact view when Compact is clicked', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([createMachine()]),
    });
    renderMachines();
    await waitFor(() => {
      expect(screen.getByText('test-machine')).toBeDefined();
    });
    // Toggle to compact
    fireEvent.click(screen.getByText('Compact'));
    // Button text changes to "Detailed"
    await waitFor(() => {
      expect(screen.getByText('Detailed')).toBeDefined();
    });
    // Hostname is still shown
    expect(screen.getByText('test-machine')).toBeDefined();
  });

  it('hides detail fields in compact mode', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi.fn().mockResolvedValue([createMachine({ tailscaleIp: '100.64.0.1' })]),
    });
    renderMachines();
    await waitFor(() => {
      expect(screen.getByText('100.64.0.1')).toBeDefined();
    });
    // Toggle to compact
    fireEvent.click(screen.getByText('Compact'));
    await waitFor(() => {
      expect(screen.getByText('Detailed')).toBeDefined();
    });
    // Tailscale IP should be hidden in compact mode
    expect(screen.queryByText('100.64.0.1')).toBeNull();
  });

  // =========================================================================
  // Sorting
  // =========================================================================

  it('renders sort dropdown', async () => {
    renderMachines();
    await waitFor(() => {
      expect(screen.getByLabelText('Sort by')).toBeDefined();
    });
  });

  it('sorts machines by hostname when Name sort is selected', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi
        .fn()
        .mockResolvedValue([
          createMachine({ id: 'm1', hostname: 'zebra' }),
          createMachine({ id: 'm2', hostname: 'alpha' }),
        ]),
    });
    renderMachines();
    await waitFor(() => {
      expect(screen.getByText('alpha')).toBeDefined();
    });
    // Default sort is by name, so alpha should come before zebra
    const links = screen.getAllByRole('link');
    const hostnames = links.map((l) => l.textContent).filter(Boolean);
    expect(hostnames.indexOf('alpha')).toBeLessThan(hostnames.indexOf('zebra'));
  });

  // =========================================================================
  // Capability Tooltips
  // =========================================================================

  it('wraps capability badges with SimpleTooltip', async () => {
    mockMachinesQuery.mockReturnValue({
      queryKey: ['machines'],
      queryFn: vi
        .fn()
        .mockResolvedValue([
          createMachine({ capabilities: { gpu: true, docker: true, maxConcurrentAgents: 8 } }),
        ]),
    });
    renderMachines();
    await waitFor(() => {
      const tooltips = screen.getAllByTestId('simple-tooltip');
      expect(tooltips.length).toBeGreaterThanOrEqual(3);
    });
  });
});
