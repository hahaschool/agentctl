import { fireEvent, render, screen } from '@testing-library/react';
import type { DeploymentPromotionRecord, DeploymentTierStatus } from '@/lib/api';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockUseQuery = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  queryOptions: (opts: unknown) => opts,
}));

vi.mock('@/lib/queries', () => ({
  deploymentTiersQuery: () => ({
    queryKey: ['deployment-tiers'],
    queryFn: vi.fn(),
  }),
  promotionHistoryQuery: () => ({
    queryKey: ['promotion-history'],
    queryFn: vi.fn(),
  }),
}));

vi.mock('@/components/deployment/TierGrid', () => ({
  TierGrid: ({ tiers, loading }: { tiers: DeploymentTierStatus[]; loading: boolean }) => (
    <div data-testid="tier-grid" data-loading={String(loading)}>
      {tiers.map((t) => (
        <div key={t.name} data-testid={`tier-${t.name}`}>
          {t.label}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('@/components/deployment/PromoteGate', () => ({
  PromoteGate: ({
    tiers,
    onPromoteStarted,
  }: {
    tiers: DeploymentTierStatus[];
    onPromoteStarted: (id: string) => void;
  }) => (
    <div data-testid="promote-gate" data-tier-count={tiers.length}>
      <button type="button" onClick={() => onPromoteStarted('promo-42')}>
        Trigger Promote
      </button>
    </div>
  ),
}));

vi.mock('@/components/deployment/PromotionProgress', () => ({
  PromotionProgress: ({ promotionId, onClose }: { promotionId: string; onClose: () => void }) => (
    <div data-testid="promotion-progress" data-promotion-id={promotionId}>
      <button type="button" onClick={onClose}>
        Close Progress
      </button>
    </div>
  ),
}));

vi.mock('@/components/deployment/PromotionHistory', () => ({
  PromotionHistory: ({ records }: { records: DeploymentPromotionRecord[] }) => (
    <div data-testid="promotion-history" data-record-count={records.length}>
      Promotion History
    </div>
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

// ---------------------------------------------------------------------------
// Component import (after mocks)
// ---------------------------------------------------------------------------

import { DeploymentView } from './DeploymentView';

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function makeTier(overrides: Partial<DeploymentTierStatus> = {}): DeploymentTierStatus {
  return {
    name: 'dev-1',
    label: 'Development 1',
    status: 'running',
    services: [
      { name: 'control-plane', port: 8180, healthy: true },
      { name: 'worker', port: 9100, healthy: true },
      { name: 'web', port: 5273, healthy: true },
    ],
    config: {
      cpPort: 8180,
      workerPort: 9100,
      webPort: 5273,
      database: 'agentctl_dev1',
      redisDb: 1,
    },
    ...overrides,
  };
}

function makeRecord(overrides: Partial<DeploymentPromotionRecord> = {}): DeploymentPromotionRecord {
  return {
    id: 'promo-1',
    sourceTier: 'dev-1',
    targetTier: 'beta',
    status: 'success',
    checks: [{ name: 'Build', status: 'pass' }],
    startedAt: '2026-04-15T12:00:00.000Z',
    durationMs: 12000,
    triggeredBy: 'operator',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupQueries(opts: {
  tiers?: DeploymentTierStatus[];
  tiersLoading?: boolean;
  tiersError?: Error | null;
  records?: DeploymentPromotionRecord[];
}): void {
  const { tiers, tiersLoading = false, tiersError = null, records } = opts;

  mockUseQuery.mockImplementation((queryOpts: { queryKey: readonly string[] }) => {
    if (queryOpts.queryKey[0] === 'deployment-tiers') {
      return {
        data: tiers ? { tiers } : null,
        isLoading: tiersLoading,
        error: tiersError,
      };
    }
    if (queryOpts.queryKey[0] === 'promotion-history') {
      return {
        data: records ? { records } : null,
        isLoading: false,
        error: null,
      };
    }
    return { data: null, isLoading: false, error: null };
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DeploymentView', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: two tiers loaded, some history
    setupQueries({
      tiers: [
        makeTier({ name: 'beta', label: 'Beta' }),
        makeTier({ name: 'dev-1', label: 'Development 1' }),
      ],
      records: [makeRecord()],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Heading
  // =========================================================================

  it('renders the page heading', () => {
    render(<DeploymentView />);
    expect(screen.getByRole('heading', { level: 1 })).toBeDefined();
    expect(screen.getByText('Deployment')).toBeDefined();
  });

  // =========================================================================
  // Loading state
  // =========================================================================

  it('passes loading=true to TierGrid while tiers are loading', () => {
    setupQueries({ tiersLoading: true });

    render(<DeploymentView />);

    const tierGrid = screen.getByTestId('tier-grid');
    expect(tierGrid.getAttribute('data-loading')).toBe('true');
  });

  it('does not show empty state while loading', () => {
    setupQueries({ tiersLoading: true });

    render(<DeploymentView />);

    expect(screen.queryByTestId('empty-state')).toBeNull();
  });

  // =========================================================================
  // Error state
  // =========================================================================

  it('shows error banner when tiers query fails', () => {
    setupQueries({ tiersError: new Error('Connection refused') });

    render(<DeploymentView />);

    expect(
      screen.getByText('Failed to load tier status. Is the control plane running?'),
    ).toBeDefined();
  });

  it('does not show error banner when tiers load successfully', () => {
    render(<DeploymentView />);

    expect(
      screen.queryByText('Failed to load tier status. Is the control plane running?'),
    ).toBeNull();
  });

  // =========================================================================
  // Empty state
  // =========================================================================

  it('shows empty state when no tiers are configured', () => {
    setupQueries({ tiers: [] });

    render(<DeploymentView />);

    const emptyState = screen.getByTestId('empty-state');
    expect(emptyState).toBeDefined();
    expect(screen.getByText('No deployment tiers configured')).toBeDefined();
  });

  it('does not show TierGrid or PromoteGate in empty state', () => {
    setupQueries({ tiers: [] });

    render(<DeploymentView />);

    expect(screen.queryByTestId('tier-grid')).toBeNull();
    expect(screen.queryByTestId('promote-gate')).toBeNull();
  });

  // =========================================================================
  // Tier display
  // =========================================================================

  it('renders TierGrid with loaded tiers', () => {
    render(<DeploymentView />);

    const tierGrid = screen.getByTestId('tier-grid');
    expect(tierGrid.getAttribute('data-loading')).toBe('false');
    expect(screen.getByTestId('tier-beta')).toBeDefined();
    expect(screen.getByTestId('tier-dev-1')).toBeDefined();
  });

  it('passes tiers to TierGrid showing correct labels', () => {
    render(<DeploymentView />);

    expect(screen.getByText('Beta')).toBeDefined();
    expect(screen.getByText('Development 1')).toBeDefined();
  });

  // =========================================================================
  // PromoteGate wiring
  // =========================================================================

  it('renders PromoteGate with tiers', () => {
    render(<DeploymentView />);

    const gate = screen.getByTestId('promote-gate');
    expect(gate).toBeDefined();
    expect(gate.getAttribute('data-tier-count')).toBe('2');
  });

  it('shows PromotionProgress after PromoteGate triggers a promotion', () => {
    render(<DeploymentView />);

    // PromotionProgress should NOT be visible before triggering
    expect(screen.queryByTestId('promotion-progress')).toBeNull();

    // Click the button in our mocked PromoteGate which calls onPromoteStarted
    fireEvent.click(screen.getByText('Trigger Promote'));

    // PromotionProgress should now be visible with the promotion ID
    const progress = screen.getByTestId('promotion-progress');
    expect(progress).toBeDefined();
    expect(progress.getAttribute('data-promotion-id')).toBe('promo-42');
  });

  // =========================================================================
  // PromotionHistory integration
  // =========================================================================

  it('renders PromotionHistory with records from the query', () => {
    render(<DeploymentView />);

    const history = screen.getByTestId('promotion-history');
    expect(history).toBeDefined();
    expect(history.getAttribute('data-record-count')).toBe('1');
  });

  it('passes empty records array when history query returns no data', () => {
    setupQueries({
      tiers: [makeTier()],
      records: undefined,
    });

    render(<DeploymentView />);

    const history = screen.getByTestId('promotion-history');
    expect(history.getAttribute('data-record-count')).toBe('0');
  });

  // =========================================================================
  // PromotionProgress lifecycle
  // =========================================================================

  it('does not render PromotionProgress when no promotion is active', () => {
    render(<DeploymentView />);

    expect(screen.queryByTestId('promotion-progress')).toBeNull();
  });

  it('hides PromotionProgress when its onClose callback fires', () => {
    render(<DeploymentView />);

    // Start a promotion
    fireEvent.click(screen.getByText('Trigger Promote'));
    expect(screen.getByTestId('promotion-progress')).toBeDefined();

    // Close the progress overlay
    fireEvent.click(screen.getByText('Close Progress'));
    expect(screen.queryByTestId('promotion-progress')).toBeNull();
  });

  // =========================================================================
  // Combined: error with stale tiers still visible
  // =========================================================================

  it('shows error banner alongside stale tier data', () => {
    setupQueries({
      tiers: [makeTier({ name: 'beta', label: 'Beta' })],
      tiersError: new Error('Timeout'),
    });

    render(<DeploymentView />);

    // Both the error banner and the tier grid should be visible
    expect(
      screen.getByText('Failed to load tier status. Is the control plane running?'),
    ).toBeDefined();
    expect(screen.getByTestId('tier-grid')).toBeDefined();
    expect(screen.getByText('Beta')).toBeDefined();
  });

  // =========================================================================
  // Null-safe data access
  // =========================================================================

  it('handles undefined tiersData gracefully', () => {
    setupQueries({});

    render(<DeploymentView />);

    // Should show empty state since tiers defaults to []
    expect(screen.getByTestId('empty-state')).toBeDefined();
  });

  it('handles undefined historyData gracefully', () => {
    setupQueries({
      tiers: [makeTier()],
    });

    render(<DeploymentView />);

    // Should still render with 0 records (fallback to [])
    const history = screen.getByTestId('promotion-history');
    expect(history.getAttribute('data-record-count')).toBe('0');
  });
});
