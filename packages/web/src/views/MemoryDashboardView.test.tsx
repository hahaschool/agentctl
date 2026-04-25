import type { MemoryFact, MemoryStats } from '@agentctl/shared';

const mockUseQuery = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  queryOptions: (opts: unknown) => opts,
}));

vi.mock('@/lib/queries', () => ({
  memoryStatsQuery: () => ({
    queryKey: ['memory', 'stats'],
    queryFn: vi.fn(),
  }),
  memoryFactsQuery: (params?: unknown) => ({
    queryKey: ['memory', 'facts', params],
    queryFn: vi.fn(),
  }),
}));

vi.mock('@/lib/format-utils', () => ({
  formatNumber: (n: number | null | undefined) => String(n ?? 0),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@/components/memory/KpiCard', () => ({
  KpiCard: ({ label, value, isLoading }: { label: string; value: string; isLoading?: boolean }) => (
    <div data-testid={`kpi-card-${label}`}>
      {isLoading ? (
        <span data-testid="kpi-loading">loading</span>
      ) : (
        <span data-testid={`kpi-value-${label}`}>{value}</span>
      )}
    </div>
  ),
}));

vi.mock('@/components/memory/MemoryDecayCard', () => ({
  MemoryDecayCard: () => <div data-testid="memory-decay-card-mock" />,
}));

vi.mock('@/components/memory/MissingEmbeddingAlert', () => ({
  MissingEmbeddingAlert: () => <div data-testid="missing-embedding-alert" />,
}));

vi.mock('@/components/memory/ActivityFeed', () => ({
  ActivityFeed: ({
    items,
    isLoading,
  }: {
    items: readonly { fact: MemoryFact }[];
    isLoading?: boolean;
  }) => (
    <div data-testid="activity-feed-mock">
      {isLoading
        ? 'loading'
        : items.map(({ fact }) => (
            <div key={fact.id} data-testid={`activity-item-${fact.id}`}>
              {fact.content}
            </div>
          ))}
    </div>
  ),
}));

vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div data-testid="card">{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="card-header">{children}</div>
  ),
  CardTitle: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="card-title">{children}</div>
  ),
  CardContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="card-content">{children}</div>
  ),
}));

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div data-testid="skeleton" className={className} />
  ),
}));

vi.mock('@/components/ErrorBanner', () => ({
  ErrorBanner: ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
    <div data-testid="error-banner">
      <span data-testid="error-banner-message">{message}</span>
      {onRetry && (
        <button type="button" data-testid="error-banner-retry" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  ),
}));

import { render, screen } from '@testing-library/react';

import { MemoryDashboardView } from './MemoryDashboardView';

function makeStats(overrides: Partial<MemoryStats> = {}): MemoryStats {
  return {
    totalFacts: 1234,
    newThisWeek: 42,
    avgConfidence: 0.82,
    pendingConsolidation: 7,
    byScope: { 'project:agentctl': 800, global: 434 },
    byEntityType: { decision: 400, pattern: 300, error: 200, concept: 150, code_artifact: 184 },
    strengthDistribution: { active: 900, decaying: 200, archived: 134 },
    growthTrend: [
      { date: '2026-03-05', count: 10 },
      { date: '2026-03-06', count: 15 },
      { date: '2026-03-07', count: 8 },
    ],
    ...overrides,
  };
}

function makeFact(overrides: Partial<MemoryFact> = {}): MemoryFact {
  return {
    id: 'fact-1',
    scope: 'project:agentctl',
    content: 'Test memory fact content',
    content_model: 'text-embedding-3-small',
    entity_type: 'decision',
    confidence: 0.9,
    strength: 0.8,
    source: {
      session_id: 'session-1',
      agent_id: 'agent-1',
      machine_id: 'machine-1',
      turn_index: 1,
      extraction_method: 'manual',
    },
    valid_from: '2026-03-11T10:00:00.000Z',
    valid_until: null,
    created_at: '2026-03-11T10:00:00.000Z',
    accessed_at: '2026-03-11T10:00:00.000Z',
    ...overrides,
  };
}

describe('MemoryDashboardView', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the initial loading skeleton when no data has arrived yet', () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<MemoryDashboardView />);

    expect(screen.getByTestId('memory-dashboard-loading')).toBeDefined();
    // Once the skeleton is up, the data-level KPI cards should not render.
    expect(screen.queryByTestId('kpi-card-Total Facts')).toBeNull();
  });

  it('renders an error banner with retry when the stats query fails', () => {
    const refetch = vi.fn();
    mockUseQuery.mockImplementation((opts: { queryKey: unknown[] }) => {
      if (Array.isArray(opts.queryKey) && opts.queryKey[1] === 'stats') {
        return {
          data: undefined,
          isLoading: false,
          isError: true,
          error: new Error('stats blew up'),
          refetch,
        };
      }
      return {
        data: { facts: [], total: 0 },
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      };
    });

    render(<MemoryDashboardView />);

    const banner = screen.getByTestId('error-banner');
    expect(banner).toBeDefined();
    expect(screen.getByTestId('error-banner-message').textContent).toContain('stats blew up');

    screen.getByTestId('error-banner-retry').click();
    expect(refetch).toHaveBeenCalledTimes(1);

    // Content should not render while the error is visible.
    expect(screen.queryByTestId('kpi-card-Total Facts')).toBeNull();
    expect(screen.queryByTestId('memory-dashboard-loading')).toBeNull();
  });

  it('renders an error banner when the facts query fails even if stats loaded', () => {
    const refetch = vi.fn();
    mockUseQuery.mockImplementation((opts: { queryKey: unknown[] }) => {
      if (Array.isArray(opts.queryKey) && opts.queryKey[1] === 'stats') {
        return {
          data: { ok: true, stats: makeStats() },
          isLoading: false,
          isError: false,
          error: null,
          refetch: vi.fn(),
        };
      }
      return {
        data: undefined,
        isLoading: false,
        isError: true,
        error: new Error('facts unavailable'),
        refetch,
      };
    });

    render(<MemoryDashboardView />);

    expect(screen.getByTestId('error-banner-message').textContent).toContain('facts unavailable');
    screen.getByTestId('error-banner-retry').click();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders KPI card values when stats are loaded', () => {
    const stats = makeStats();
    mockUseQuery.mockImplementation((opts: { queryKey: unknown[] }) => {
      if (Array.isArray(opts.queryKey) && opts.queryKey[1] === 'stats') {
        return { data: { ok: true, stats }, isLoading: false };
      }
      return { data: { facts: [], total: 0 }, isLoading: false };
    });

    render(<MemoryDashboardView />);

    expect(screen.getByTestId('kpi-value-Total Facts').textContent).toBe('1234');
    expect(screen.getByTestId('kpi-value-New This Week').textContent).toBe('42');
    expect(screen.getByTestId('kpi-value-Avg Confidence').textContent).toBe('82%');
    expect(screen.getByTestId('kpi-value-Pending Consolidation').textContent).toBe('7');
  });

  it('renders the growth trend bars', () => {
    const stats = makeStats();
    mockUseQuery.mockImplementation((opts: { queryKey: unknown[] }) => {
      if (Array.isArray(opts.queryKey) && opts.queryKey[1] === 'stats') {
        return { data: { ok: true, stats }, isLoading: false };
      }
      return { data: { facts: [], total: 0 }, isLoading: false };
    });

    render(<MemoryDashboardView />);

    expect(screen.getByTestId('growth-trend')).toBeDefined();
  });

  it('renders strength distribution when stats are loaded', () => {
    const stats = makeStats();
    mockUseQuery.mockImplementation((opts: { queryKey: unknown[] }) => {
      if (Array.isArray(opts.queryKey) && opts.queryKey[1] === 'stats') {
        return { data: { ok: true, stats }, isLoading: false };
      }
      return { data: { facts: [], total: 0 }, isLoading: false };
    });

    render(<MemoryDashboardView />);

    expect(screen.getByTestId('strength-distribution')).toBeDefined();
    expect(screen.getByRole('progressbar', { name: 'active' })).toBeDefined();
    expect(screen.getByRole('progressbar', { name: 'decaying' })).toBeDefined();
    expect(screen.getByRole('progressbar', { name: 'archived' })).toBeDefined();
  });

  it('renders scope breakdown when stats are loaded', () => {
    const stats = makeStats();
    mockUseQuery.mockImplementation((opts: { queryKey: unknown[] }) => {
      if (Array.isArray(opts.queryKey) && opts.queryKey[1] === 'stats') {
        return { data: { ok: true, stats }, isLoading: false };
      }
      return { data: { facts: [], total: 0 }, isLoading: false };
    });

    render(<MemoryDashboardView />);

    expect(screen.getByTestId('scope-breakdown')).toBeDefined();
  });

  it('renders entity type breakdown when stats are loaded', () => {
    const stats = makeStats();
    mockUseQuery.mockImplementation((opts: { queryKey: unknown[] }) => {
      if (Array.isArray(opts.queryKey) && opts.queryKey[1] === 'stats') {
        return { data: { ok: true, stats }, isLoading: false };
      }
      return { data: { facts: [], total: 0 }, isLoading: false };
    });

    render(<MemoryDashboardView />);

    expect(screen.getByTestId('entity-breakdown')).toBeDefined();
  });

  it('renders activity feed with recent facts', () => {
    const facts = [
      makeFact({ id: 'fact-1', content: 'First' }),
      makeFact({ id: 'fact-2', content: 'Second' }),
    ];
    mockUseQuery.mockImplementation((opts: { queryKey: unknown[] }) => {
      if (Array.isArray(opts.queryKey) && opts.queryKey[1] === 'facts') {
        return { data: { facts, total: 2 }, isLoading: false };
      }
      return { data: null, isLoading: false };
    });

    render(<MemoryDashboardView />);

    expect(screen.getByTestId('activity-feed-mock')).toBeDefined();
    expect(screen.getByTestId('activity-item-fact-1')).toBeDefined();
    expect(screen.getByTestId('activity-item-fact-2')).toBeDefined();
  });

  it('renders page heading', () => {
    mockUseQuery.mockReturnValue({ data: null, isLoading: false });

    render(<MemoryDashboardView />);

    expect(screen.getByText('Memory Dashboard')).toBeDefined();
  });

  it('shows empty scope breakdown when byScope is empty', () => {
    const stats = makeStats({ byScope: {}, byEntityType: {} });
    mockUseQuery.mockImplementation((opts: { queryKey: unknown[] }) => {
      if (Array.isArray(opts.queryKey) && opts.queryKey[1] === 'stats') {
        return { data: { ok: true, stats }, isLoading: false };
      }
      return { data: { facts: [], total: 0 }, isLoading: false };
    });

    render(<MemoryDashboardView />);

    expect(screen.getByTestId('scope-breakdown-empty')).toBeDefined();
    expect(screen.getByTestId('entity-breakdown-empty')).toBeDefined();
  });
});
