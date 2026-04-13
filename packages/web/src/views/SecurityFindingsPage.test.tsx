import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SecurityFinding, SecurityFindingSeverity, SecurityFindingsSummary } from '@/lib/api';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockFindingsQuery, mockSummaryQuery } = vi.hoisted(() => ({
  mockFindingsQuery: vi.fn(),
  mockSummaryQuery: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock dependencies — BEFORE the component import
// ---------------------------------------------------------------------------

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
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

vi.mock('@/components/RefreshButton', () => ({
  RefreshButton: ({ onClick, isFetching }: { onClick: () => void; isFetching: boolean }) => (
    <button type="button" data-testid="refresh-button" disabled={isFetching} onClick={onClick}>
      Refresh
    </button>
  ),
}));

vi.mock('@/lib/queries', () => ({
  securityFindingsQuery: (params?: unknown) => mockFindingsQuery(params),
  securityFindingsSummaryQuery: () => mockSummaryQuery(),
}));

// ---------------------------------------------------------------------------
// Component import — AFTER mocks
// ---------------------------------------------------------------------------

import { SecurityFindingsPage } from './SecurityFindingsPage';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

function makeFinding(overrides?: Partial<SecurityFinding>): SecurityFinding {
  return {
    id: 'f-1',
    agentId: 'agent-1',
    runId: 'run-1',
    severity: 'high',
    category: 'injection',
    title: 'Potential SQL injection',
    description: 'Unsanitized input in query builder',
    file: 'src/db.ts',
    line: 42,
    recommendation: 'Use parameterized queries',
    acknowledged: false,
    acknowledgedBy: null,
    acknowledgeReason: null,
    issueCreated: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSummary(overrides?: Partial<SecurityFindingsSummary>): SecurityFindingsSummary {
  return {
    total: 5,
    critical: 1,
    high: 2,
    medium: 1,
    low: 1,
    info: 0,
    byCategory: { injection: 2, secrets: 3 },
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SecurityFindingsPage />
    </QueryClientProvider>,
  );
}

function setFindings(findings: SecurityFinding[], total = findings.length) {
  mockFindingsQuery.mockReturnValue({
    queryKey: ['security-findings'],
    queryFn: vi.fn().mockResolvedValue({ findings, total }),
  });
}

function setSummary(summary: SecurityFindingsSummary) {
  mockSummaryQuery.mockReturnValue({
    queryKey: ['security-findings', 'summary'],
    queryFn: vi.fn().mockResolvedValue(summary),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SecurityFindingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setFindings([makeFinding()]);
    setSummary(makeSummary());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the page heading', async () => {
    renderPage();
    expect(screen.getByText('Security Findings')).toBeDefined();
  });

  it('shows loading skeletons while findings are loading', async () => {
    mockFindingsQuery.mockReturnValue({
      queryKey: ['security-findings'],
      queryFn: vi.fn().mockReturnValue(new Promise(() => {})),
    });
    const { container } = renderPage();
    await waitFor(() => {
      const skeletons = container.querySelectorAll('.animate-pulse');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  it('renders a row with the finding title and category', async () => {
    setFindings([makeFinding({ id: 'f-42', title: 'Hardcoded token', category: 'secrets' })]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Hardcoded token')).toBeDefined();
      expect(screen.getByText('secrets')).toBeDefined();
    });
  });

  it('renders the severity badge on each row', async () => {
    setFindings([makeFinding({ id: 'f-1', severity: 'critical' })]);
    renderPage();
    await waitFor(() => {
      // Two matches expected: summary badge + row badge
      const badges = screen.getAllByText('critical', { exact: false });
      expect(badges.length).toBeGreaterThan(0);
    });
  });

  it('renders file:line location when both provided', async () => {
    setFindings([makeFinding({ file: 'src/auth.ts', line: 99 })]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('src/auth.ts:99')).toBeDefined();
    });
  });

  it('shows an empty-state message when there are no findings', async () => {
    setFindings([], 0);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No security findings.')).toBeDefined();
    });
  });

  it('renders an error banner when the query fails', async () => {
    mockFindingsQuery.mockReturnValue({
      queryKey: ['security-findings'],
      queryFn: vi.fn().mockRejectedValue(new Error('boom')),
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('error-banner')).toBeDefined();
    });
  });

  it('renders severity summary badges for non-zero counts', async () => {
    setFindings([]);
    setSummary(makeSummary({ critical: 3, high: 5, medium: 0, low: 0, info: 0 }));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('summary-critical').textContent).toContain('3');
      expect(screen.getByTestId('summary-high').textContent).toContain('5');
    });
    expect(screen.queryByTestId('summary-medium')).toBeNull();
  });

  it('renders the total badge from the summary', async () => {
    setFindings([]);
    setSummary(makeSummary({ total: 123 }));
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('total-badge').textContent).toContain('123');
    });
  });

  it('re-queries with severity when the filter changes', async () => {
    setFindings([makeFinding()]);
    renderPage();
    await waitFor(() => expect(screen.getByTestId('severity-filter')).toBeDefined());

    const select = screen.getByTestId('severity-filter') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'critical' as SecurityFindingSeverity } });

    await waitFor(() => {
      const calls = mockFindingsQuery.mock.calls;
      const last = calls[calls.length - 1]?.[0] as Record<string, unknown> | undefined;
      expect(last?.severity).toBe('critical');
    });
  });

  it('renders row-state badge (acked, issue, open) based on flags', async () => {
    setFindings([
      makeFinding({ id: 'a', acknowledged: true }),
      makeFinding({ id: 'i', acknowledged: false, issueCreated: true }),
      makeFinding({ id: 'o' }),
    ]);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/acked/i)).toBeDefined();
      expect(screen.getByText(/issue/i)).toBeDefined();
      expect(screen.getByText(/open/i)).toBeDefined();
    });
  });

  it('shows the count summary line (N of total)', async () => {
    setFindings([makeFinding({ id: '1' }), makeFinding({ id: '2' })], 10);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Showing 2 of 10')).toBeDefined();
    });
  });
});
