import type { ConsolidationItem, MemoryFact } from '@agentctl/shared';
import { fireEvent, render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock React Query
// ---------------------------------------------------------------------------

const mockUseQuery = vi.fn();
const mockUseMutation = vi.fn(() => ({
  mutate: vi.fn(),
  isPending: false,
  variables: undefined,
}));
const mockUseQueryClient = vi.fn(() => ({ invalidateQueries: vi.fn() }));

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useMutation: (...args: unknown[]) => mockUseMutation(...args),
  useQueryClient: () => mockUseQueryClient(),
  queryOptions: (opts: unknown) => opts,
}));

vi.mock('@/lib/queries', () => ({
  consolidationQuery: (params?: unknown) => ({
    queryKey: ['memory', 'consolidation', params],
    queryFn: vi.fn(),
  }),
  memoryFactsQuery: (params?: unknown) => ({
    queryKey: ['memory', 'facts', params],
    queryFn: vi.fn(),
  }),
  queryKeys: {
    memory: {
      consolidation: () => ['memory', 'consolidation'],
      facts: () => ['memory', 'facts'],
      stats: ['memory', 'stats'],
    },
  },
  useResolveConsolidationItem: () => ({
    mutate: vi.fn(),
    isPending: false,
    variables: undefined,
  }),
}));

import { ConsolidationBoardView } from './ConsolidationBoardView';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<ConsolidationItem> = {}): ConsolidationItem {
  return {
    id: 'item-1',
    type: 'contradiction',
    severity: 'high',
    factIds: ['fact-1'],
    reason: 'Conflicting values detected.',
    suggestion: 'Delete the older fact.',
    status: 'pending',
    createdAt: '2026-03-11T10:00:00.000Z',
    ...overrides,
  };
}

function makeFact(overrides: Partial<MemoryFact> = {}): MemoryFact {
  return {
    id: 'fact-1',
    scope: 'project:agentctl',
    content: 'BullMQ is preferred for MVP',
    content_model: 'text-embedding-3-small',
    entity_type: 'decision',
    confidence: 0.9,
    strength: 0.8,
    tags: [],
    source: {
      session_id: 's1',
      agent_id: 'a1',
      machine_id: 'm1',
      turn_index: 1,
      extraction_method: 'manual',
    },
    valid_from: '2026-03-01T00:00:00.000Z',
    valid_until: null,
    created_at: '2026-03-01T00:00:00.000Z',
    accessed_at: '2026-03-11T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function setupQueries(
  items: ConsolidationItem[],
  facts: MemoryFact[],
  opts: { consolidationLoading?: boolean; factsLoading?: boolean } = {},
) {
  mockUseQuery.mockImplementation((queryDef: { queryKey: unknown[] }) => {
    const key = queryDef.queryKey;
    if (Array.isArray(key) && key[0] === 'memory' && key[1] === 'consolidation') {
      return {
        data: opts.consolidationLoading ? undefined : { items, total: items.length },
        isLoading: opts.consolidationLoading ?? false,
        isFetching: false,
        refetch: vi.fn(),
      };
    }
    if (Array.isArray(key) && key[0] === 'memory' && key[1] === 'facts') {
      return {
        data: opts.factsLoading ? undefined : { facts, total: facts.length },
        isLoading: opts.factsLoading ?? false,
      };
    }
    return { data: undefined, isLoading: false, isFetching: false, refetch: vi.fn() };
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConsolidationBoardView', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders category filter tabs', () => {
    setupQueries([], []);
    render(<ConsolidationBoardView />);

    expect(screen.getByRole('button', { name: /^All/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /^Contradictions/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /^Near-Duplicates/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /^Stale Facts/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /^Orphan Nodes/ })).toBeDefined();
  });

  it('shows empty queue state when no items', () => {
    setupQueries([], []);
    render(<ConsolidationBoardView />);

    expect(screen.getByText('Queue is clear')).toBeDefined();
  });

  it('shows loading skeleton when consolidation query is loading', () => {
    setupQueries([], [], { consolidationLoading: true });
    render(<ConsolidationBoardView />);

    // Loading skeleton renders animated divs — no cards
    expect(screen.queryByText('Queue is clear')).toBeNull();
    expect(screen.queryByText('Contradiction')).toBeNull();
  });

  it('renders consolidation cards for each item', () => {
    const items = [
      makeItem({ id: 'item-1', reason: 'First conflict reason' }),
      makeItem({ id: 'item-2', type: 'stale', reason: 'Stale fact detected', severity: 'low' }),
    ];
    setupQueries(items, [makeFact()]);
    render(<ConsolidationBoardView />);

    expect(screen.getByText('First conflict reason')).toBeDefined();
    expect(screen.getByText('Stale fact detected')).toBeDefined();
  });

  it('sorts items by severity (high before low)', () => {
    const items = [
      makeItem({ id: 'item-low', severity: 'low', reason: 'Low severity reason' }),
      makeItem({ id: 'item-high', severity: 'high', reason: 'High severity reason' }),
    ];
    setupQueries(items, []);
    render(<ConsolidationBoardView />);

    const cards = screen.getAllByText(/severity reason/);
    // High severity card should appear first
    expect(cards[0].textContent).toBe('High severity reason');
    expect(cards[1].textContent).toBe('Low severity reason');
  });

  it('shows item count badge on the All tab', () => {
    const items = [makeItem(), makeItem({ id: 'item-2' })];
    setupQueries(items, []);
    render(<ConsolidationBoardView />);

    // The "All" tab badge should show 2
    expect(screen.getByText('2')).toBeDefined();
  });

  it('filters items by category when a tab is clicked', () => {
    const items = [
      makeItem({ id: 'item-c', type: 'contradiction', reason: 'Contradiction reason' }),
      makeItem({ id: 'item-s', type: 'stale', reason: 'Stale reason' }),
    ];
    setupQueries(items, []);
    render(<ConsolidationBoardView />);

    // Click the Contradictions tab
    fireEvent.click(screen.getByRole('button', { name: /^Contradictions/ }));

    expect(screen.getByText('Contradiction reason')).toBeDefined();
    expect(screen.queryByText('Stale reason')).toBeNull();
  });

  it('shows empty state after filtering to an empty category', () => {
    const items = [makeItem({ type: 'contradiction' })];
    setupQueries(items, []);
    render(<ConsolidationBoardView />);

    fireEvent.click(screen.getByRole('button', { name: /^Stale Facts/ }));

    expect(screen.getByText('Queue is clear')).toBeDefined();
  });

  it('shows pending count stats when items exist', () => {
    const items = [
      makeItem({ id: 'h1', severity: 'high' }),
      makeItem({ id: 'h2', severity: 'high' }),
      makeItem({ id: 'm1', severity: 'medium' }),
    ];
    setupQueries(items, []);
    render(<ConsolidationBoardView />);

    expect(screen.getByText('3')).toBeDefined(); // "3 pending"
    expect(screen.getByText('2')).toBeDefined(); // "2 high"
  });

  it('renders the Refresh button', () => {
    setupQueries([], []);
    render(<ConsolidationBoardView />);

    expect(screen.getByRole('button', { name: 'Refresh consolidation queue' })).toBeDefined();
  });
});
