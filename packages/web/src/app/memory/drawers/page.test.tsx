// ---------------------------------------------------------------------------
// Memory Drawers page — unit tests.
//
// Covers: happy path rendering with mixed match types, empty state, loading
// skeleton, error UI, and that changing the scope filter triggers a new
// search with the scope query param.
// ---------------------------------------------------------------------------

import type { MemoryDrawerSearchResult } from '@agentctl/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUseQuery = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  queryOptions: (opts: unknown) => opts,
}));

// Capture the params passed into `memoryDrawersSearchQuery` so tests can
// assert that scope/limit/query changes flow through to the query config.
const capturedSearchCalls: Array<{
  params: { query: string; scope?: string; limit?: number };
  options?: { enabled?: boolean };
}> = [];

vi.mock('@/lib/queries', () => ({
  memoryDrawersSearchQuery: (
    params: { query: string; scope?: string; limit?: number },
    options?: { enabled?: boolean },
  ) => {
    capturedSearchCalls.push({ params, options });
    return {
      queryKey: ['memory', 'drawers', 'search', params],
      queryFn: vi.fn(),
      enabled: options?.enabled ?? params.query.trim().length > 0,
    };
  },
}));

// next/link stub so the test environment does not depend on the Next.js app
// router runtime context.
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// Import the page AFTER mocks so the mocked modules are picked up.
import Page from './page';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<MemoryDrawerSearchResult> = {}): MemoryDrawerSearchResult {
  return {
    id: 'drawer-abc-123456789',
    scope: 'session:sess-1',
    topic: 'general',
    source_type: 'session-jsonl',
    source_id: 'sess-1',
    chunk_index: 0,
    content_preview: 'A short sanitized snippet.',
    score: 0.5,
    match_type: 'keyword',
    ...overrides,
  } satisfies MemoryDrawerSearchResult;
}

function setQueryResult(result: {
  data?: { ok: true; results: MemoryDrawerSearchResult[] };
  isLoading?: boolean;
  isFetching?: boolean;
  isError?: boolean;
  error?: Error | null;
}): void {
  mockUseQuery.mockReturnValue({
    data: result.data,
    isLoading: result.isLoading ?? false,
    isFetching: result.isFetching ?? false,
    isError: result.isError ?? false,
    error: result.error ?? null,
  });
}

function typeQuery(value: string): void {
  const input = screen.getByLabelText('Search drawers') as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('/memory/drawers page', () => {
  beforeEach(() => {
    capturedSearchCalls.length = 0;
    setQueryResult({});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the page heading and controls', () => {
    render(<Page />);
    expect(screen.getByRole('heading', { name: 'Memory Drawers' })).toBeDefined();
    expect(screen.getByLabelText('Search drawers')).toBeDefined();
    expect(screen.getByLabelText('Drawer scope filter')).toBeDefined();
    expect(screen.getByLabelText('Result limit')).toBeDefined();
  });

  it('renders three results with distinct match-type badges and formatted scores', async () => {
    const results: MemoryDrawerSearchResult[] = [
      makeResult({ id: 'drawer-keyword-111', match_type: 'keyword', score: 0.12345 }),
      makeResult({ id: 'drawer-vector-222', match_type: 'vector', score: 0.9876 }),
      makeResult({ id: 'drawer-grep-333', match_type: 'grep', score: null }),
    ];
    setQueryResult({ data: { ok: true, results } });

    render(<Page />);
    typeQuery('rate limiter');

    await waitFor(() => {
      expect(screen.getByTestId('drawer-results')).toBeDefined();
    });

    const badges = screen.getAllByTestId('drawer-match-badge');
    expect(badges.map((b) => b.textContent)).toEqual(['keyword', 'vector', 'grep']);

    // Scores rendered to 3 decimals; null score falls back to em dash.
    expect(screen.getByText('score 0.123')).toBeDefined();
    expect(screen.getByText('score 0.988')).toBeDefined();
    expect(screen.getByText('score —')).toBeDefined();
  });

  it('shows the empty-state hint when there are zero results', async () => {
    setQueryResult({ data: { ok: true, results: [] } });

    render(<Page />);
    typeQuery('unknown token');

    await waitFor(() => {
      expect(screen.getByText('No drawers indexed yet.')).toBeDefined();
    });
    expect(screen.getByText(/pnpm memory:backfill-drawers/)).toBeDefined();
  });

  it('renders the loading skeleton while the query is pending', async () => {
    setQueryResult({ isLoading: true, isFetching: true });

    render(<Page />);
    typeQuery('loading');

    await waitFor(() => {
      expect(screen.getByLabelText('Loading drawer results')).toBeDefined();
    });
  });

  it('shows the error banner when the query fails', async () => {
    setQueryResult({ isError: true, error: new Error('boom') });

    render(<Page />);
    typeQuery('err');

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });
    expect(screen.getByText('boom')).toBeDefined();
  });

  it('propagates the selected scope into the next search query', async () => {
    setQueryResult({ data: { ok: true, results: [] } });

    render(<Page />);
    typeQuery('decision');

    // Wait for debounce to fire and the query to re-evaluate with the typed
    // value. After that, changing scope should trigger another evaluation
    // with scope: 'user'.
    await waitFor(() => {
      const last = capturedSearchCalls[capturedSearchCalls.length - 1];
      expect(last?.params.query).toBe('decision');
    });

    const scopeSelect = screen.getByLabelText('Drawer scope filter') as HTMLSelectElement;
    fireEvent.change(scopeSelect, { target: { value: 'user' } });

    await waitFor(() => {
      const last = capturedSearchCalls[capturedSearchCalls.length - 1];
      expect(last?.params.scope).toBe('user');
      expect(last?.params.query).toBe('decision');
    });
  });

  it('does not query when the search box is empty', () => {
    setQueryResult({ data: { ok: true, results: [] } });

    render(<Page />);

    const latest = capturedSearchCalls[capturedSearchCalls.length - 1];
    expect(latest).toBeDefined();
    expect(latest?.options?.enabled).toBe(false);
  });
});
