import type { MemoryDrawerSearchResult } from '@agentctl/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks — declared before any imports that use them (hoisting requirement)
// ---------------------------------------------------------------------------

const mockUseQuery = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  queryOptions: (opts: unknown) => opts,
}));

vi.mock('@/lib/queries', () => ({
  memoryDrawersSearchQuery: (
    params: { query: string; scope?: string; limit: number },
    options?: { enabled?: boolean },
  ) => ({
    queryKey: ['memory', 'drawers', 'search', params],
    queryFn: vi.fn(),
    enabled: options?.enabled ?? params.query.trim().length > 0,
  }),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/components/memory/drawerMatchType', () => ({
  matchTypeClass: (matchType: string | null) => `match-type-class-${matchType ?? 'unknown'}`,
  matchTypeLabel: (matchType: string | null) => matchType ?? 'unknown',
}));

vi.mock('@/components/memory/MissingEmbeddingAlert', () => ({
  MissingEmbeddingAlert: () => <div data-testid="missing-embedding-alert" />,
}));

vi.mock('@/components/ui/badge', () => ({
  Badge: ({
    children,
    className,
    ...rest
  }: {
    children: React.ReactNode;
    className?: string;
    [key: string]: unknown;
  }) => (
    <span className={className} {...rest}>
      {children}
    </span>
  ),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    ...rest
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    [key: string]: unknown;
  }) => (
    <button type="button" onClick={onClick} {...rest}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div data-testid="skeleton" className={className} />
  ),
}));

import { MemoryDrawersView } from './MemoryDrawersView';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<MemoryDrawerSearchResult> = {}): MemoryDrawerSearchResult {
  return {
    id: 'drawer-abc123',
    scope: 'project:agentctl',
    topic: 'rate-limiter',
    source_type: 'session',
    source_id: 'session-1',
    chunk_index: 0,
    content_preview: 'This is a test snippet about the rate limiter implementation.',
    score: 0.9876,
    match_type: 'keyword',
    ...overrides,
  };
}

const IDLE_STATE = {
  data: undefined,
  isLoading: false,
  isFetching: false,
  isError: false,
  error: null,
};

function withResults(results: MemoryDrawerSearchResult[]) {
  return {
    data: { results },
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MemoryDrawersView', () => {
  beforeEach(() => {
    mockUseQuery.mockReturnValue(IDLE_STATE);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Smoke test
  // -------------------------------------------------------------------------
  it('renders without crashing and shows initial empty prompt', () => {
    render(<MemoryDrawersView />);

    expect(screen.getByRole('heading', { name: 'Memory Drawers' })).toBeDefined();
    expect(screen.getByLabelText('Search drawers')).toBeDefined();
    expect(screen.getByLabelText('Drawer scope filter')).toBeDefined();
    expect(screen.getByLabelText('Result limit')).toBeDefined();
    expect(screen.getByText(/Type a query above to search/)).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // 2. Loading skeleton
  // -------------------------------------------------------------------------
  it('shows loading skeleton when query is pending', async () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: true,
      isError: false,
      error: null,
    });

    render(<MemoryDrawersView />);

    // Type in the search box to enable the query
    fireEvent.change(screen.getByLabelText('Search drawers'), {
      target: { value: 'rate limiter' },
    });

    // Wait for debounce
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });

    expect(screen.getByLabelText('Loading drawer results')).toBeDefined();
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 3. Empty state after query returns no results
  // -------------------------------------------------------------------------
  it('shows "no drawers" empty state when query returns an empty array', async () => {
    mockUseQuery.mockReturnValue(withResults([]));

    render(<MemoryDrawersView />);

    fireEvent.change(screen.getByLabelText('Search drawers'), {
      target: { value: 'nonexistent' },
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });

    expect(screen.getByText('No drawers indexed yet.')).toBeDefined();
    expect(screen.getByText(/pnpm memory:backfill-drawers/)).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // 4. Result rows
  // -------------------------------------------------------------------------
  it('renders result rows with match badge, score, and snippet', async () => {
    const result = makeResult({ match_type: 'keyword', score: 0.9876 });
    mockUseQuery.mockReturnValue(withResults([result]));

    render(<MemoryDrawersView />);

    fireEvent.change(screen.getByLabelText('Search drawers'), {
      target: { value: 'rate limiter' },
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });

    // Match badge
    expect(screen.getByTestId('drawer-match-badge')).toBeDefined();
    expect(screen.getByText('keyword')).toBeDefined();

    // Score
    expect(screen.getByText(/score 0\.988/)).toBeDefined();

    // Snippet
    expect(screen.getByText(/test snippet about the rate limiter/)).toBeDefined();

    // Topic
    expect(screen.getByText(/rate-limiter/)).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // 5. Debounced search — query params
  // -------------------------------------------------------------------------
  it('passes the debounced input value to the query', async () => {
    mockUseQuery.mockReturnValue(withResults([]));

    render(<MemoryDrawersView />);

    fireEvent.change(screen.getByLabelText('Search drawers'), {
      target: { value: 'vector fallback' },
    });

    // Before debounce settles the query hook is called with empty query
    const callsBeforeDebounce = mockUseQuery.mock.calls.length;
    expect(callsBeforeDebounce).toBeGreaterThan(0);

    // After debounce
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });

    // Find a call where the query key contains the search term
    const calledWithQuery = mockUseQuery.mock.calls.some((args) => {
      const opts = args[0] as { queryKey?: unknown[] };
      return JSON.stringify(opts.queryKey).includes('vector fallback');
    });
    expect(calledWithQuery).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 6. Scope filter changes query params
  // -------------------------------------------------------------------------
  it('passes the selected scope to the query', async () => {
    mockUseQuery.mockReturnValue(withResults([]));

    render(<MemoryDrawersView />);

    // Type a query first so the search is enabled
    fireEvent.change(screen.getByLabelText('Search drawers'), {
      target: { value: 'context' },
    });

    // Change scope to "session"
    fireEvent.change(screen.getByLabelText('Drawer scope filter'), {
      target: { value: 'session' },
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });

    const calledWithScope = mockUseQuery.mock.calls.some((args) => {
      const opts = args[0] as { queryKey?: unknown[] };
      return JSON.stringify(opts.queryKey).includes('session');
    });
    expect(calledWithScope).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 7. Limit selector changes query params
  // -------------------------------------------------------------------------
  it('passes the selected limit to the query', async () => {
    mockUseQuery.mockReturnValue(withResults([]));

    render(<MemoryDrawersView />);

    fireEvent.change(screen.getByLabelText('Search drawers'), {
      target: { value: 'agent' },
    });

    fireEvent.change(screen.getByLabelText('Result limit'), {
      target: { value: '25' },
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });

    const calledWithLimit25 = mockUseQuery.mock.calls.some((args) => {
      const opts = args[0] as { queryKey?: unknown[] };
      return JSON.stringify(opts.queryKey).includes('25');
    });
    expect(calledWithLimit25).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 8. formatScore helper (tested indirectly through rendered output)
  // -------------------------------------------------------------------------
  describe('score formatting', () => {
    it('renders 0.9876 as "0.988"', async () => {
      mockUseQuery.mockReturnValue(withResults([makeResult({ score: 0.9876 })]));

      render(<MemoryDrawersView />);
      fireEvent.change(screen.getByLabelText('Search drawers'), {
        target: { value: 'rate' },
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 350));
      });

      expect(screen.getByText('score 0.988')).toBeDefined();
    });

    it('renders null score as "—"', async () => {
      mockUseQuery.mockReturnValue(withResults([makeResult({ score: null })]));

      render(<MemoryDrawersView />);
      fireEvent.change(screen.getByLabelText('Search drawers'), {
        target: { value: 'rate' },
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 350));
      });

      expect(screen.getByText('score —')).toBeDefined();
    });

    it('renders NaN score as "—"', async () => {
      mockUseQuery.mockReturnValue(withResults([makeResult({ score: Number.NaN })]));

      render(<MemoryDrawersView />);
      fireEvent.change(screen.getByLabelText('Search drawers'), {
        target: { value: 'rate' },
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 350));
      });

      expect(screen.getByText('score —')).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 9. Snippet truncation — expand/collapse toggle
  // -------------------------------------------------------------------------
  it('shows expand button for long snippets and toggles on click', async () => {
    const longContent = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`).join('\n');
    mockUseQuery.mockReturnValue(withResults([makeResult({ content_preview: longContent })]));

    render(<MemoryDrawersView />);
    fireEvent.change(screen.getByLabelText('Search drawers'), {
      target: { value: 'long' },
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });

    const expandBtn = screen.getByRole('button', { name: 'Expand drawer snippet' });
    expect(expandBtn).toBeDefined();

    fireEvent.click(expandBtn);

    expect(screen.getByRole('button', { name: 'Collapse drawer snippet' })).toBeDefined();
  });

  it('does not show expand button for short snippets', async () => {
    const shortContent = 'Line 1\nLine 2\nLine 3';
    mockUseQuery.mockReturnValue(withResults([makeResult({ content_preview: shortContent })]));

    render(<MemoryDrawersView />);
    fireEvent.change(screen.getByLabelText('Search drawers'), {
      target: { value: 'short' },
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });

    expect(screen.queryByRole('button', { name: 'Expand drawer snippet' })).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 10. Clipboard copy
  // -------------------------------------------------------------------------
  it('calls navigator.clipboard.writeText with the drawer id on copy click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    const result = makeResult({ id: 'drawer-copy-target-id-123' });
    mockUseQuery.mockReturnValue(withResults([result]));

    render(<MemoryDrawersView />);
    fireEvent.change(screen.getByLabelText('Search drawers'), {
      target: { value: 'copy' },
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });

    fireEvent.click(screen.getByRole('button', { name: 'Copy drawer ID' }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('drawer-copy-target-id-123');
    });
  });

  it('shows "Copied" feedback text after copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    });

    mockUseQuery.mockReturnValue(withResults([makeResult()]));

    render(<MemoryDrawersView />);
    fireEvent.change(screen.getByLabelText('Search drawers'), {
      target: { value: 'copy' },
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });

    fireEvent.click(screen.getByRole('button', { name: 'Copy drawer ID' }));

    await waitFor(() => {
      expect(screen.getByText('Copied')).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 11. Error state
  // -------------------------------------------------------------------------
  it('shows error banner when the query fails', async () => {
    mockUseQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      error: new Error('Network timeout'),
    });

    render(<MemoryDrawersView />);
    fireEvent.change(screen.getByLabelText('Search drawers'), {
      target: { value: 'fails' },
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });

    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText('Failed to load drawers.')).toBeDefined();
    expect(screen.getByText('Network timeout')).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // 12. Result count
  // -------------------------------------------------------------------------
  it('renders the correct number of result rows', async () => {
    const results = [
      makeResult({ id: 'r1', topic: 'topic-one' }),
      makeResult({ id: 'r2', topic: 'topic-two' }),
      makeResult({ id: 'r3', topic: 'topic-three' }),
    ];
    mockUseQuery.mockReturnValue(withResults(results));

    render(<MemoryDrawersView />);
    fireEvent.change(screen.getByLabelText('Search drawers'), {
      target: { value: 'multi' },
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });

    const resultsList = screen.getByTestId('drawer-results');
    const rows = resultsList.querySelectorAll('li');
    expect(rows.length).toBe(3);
  });

  // -------------------------------------------------------------------------
  // 13. View details link
  // -------------------------------------------------------------------------
  it('renders "View details" link with the correct encoded drawer URL', async () => {
    mockUseQuery.mockReturnValue(withResults([makeResult({ id: 'drawer/special id' })]));

    render(<MemoryDrawersView />);
    fireEvent.change(screen.getByLabelText('Search drawers'), {
      target: { value: 'link' },
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });

    const link = screen.getByRole('link', { name: /View drawer/ });
    expect(link.getAttribute('href')).toBe('/memory/drawers/drawer%2Fspecial%20id');
  });
});
