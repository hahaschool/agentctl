import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditAction, AuditSummary } from '@/lib/api';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockAuditQuery, mockAuditSummaryQuery } = vi.hoisted(() => ({
  mockAuditQuery: vi.fn(),
  mockAuditSummaryQuery: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock dependencies — BEFORE the component import
// ---------------------------------------------------------------------------

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@/components/ErrorBanner', () => ({
  ErrorBanner: ({ message }: { message: string }) => (
    <div data-testid="error-banner">{message}</div>
  ),
}));

vi.mock('@/components/FetchingBar', () => ({
  FetchingBar: ({ isFetching }: { isFetching: boolean }) => (
    <div data-testid="fetching-bar">{isFetching ? 'fetching' : 'idle'}</div>
  ),
}));

vi.mock('@/components/RefreshButton', () => ({
  RefreshButton: ({ onClick }: { onClick: () => void }) => (
    <button type="button" data-testid="refresh-button" onClick={onClick}>
      Refresh
    </button>
  ),
}));

vi.mock('@/components/LogsAuditActionRow', () => ({
  LogsAuditActionRow: ({ action }: { action: AuditAction }) => (
    <div data-testid={`audit-row-${action.id}`}>
      {action.actionType}
      {action.toolName ? `:${action.toolName}` : ''}
    </div>
  ),
}));

vi.mock('@/lib/queries', () => ({
  auditQuery: (params?: unknown) => mockAuditQuery(params),
  auditSummaryQuery: (params?: unknown) => mockAuditSummaryQuery(params),
}));

// ---------------------------------------------------------------------------
// Component import — AFTER mocks
// ---------------------------------------------------------------------------

import { AuditPage } from './AuditPage';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

function makeAction(overrides?: Partial<AuditAction>): AuditAction {
  return {
    id: 'a-1',
    runId: 'run-1',
    timestamp: new Date().toISOString(),
    actionType: 'tool_use',
    toolName: 'Read',
    toolInput: { path: '/tmp/x' },
    toolOutputHash: null,
    durationMs: 120,
    approvedBy: null,
    agentId: 'agent-1',
    ...overrides,
  };
}

function makeSummary(overrides?: Partial<AuditSummary>): AuditSummary {
  return {
    totalActions: 3,
    toolBreakdown: { Read: 2, Edit: 1 },
    actionTypeBreakdown: { tool_use: 2, tool_result: 1 },
    avgDurationMs: 150,
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuditPage />
    </QueryClientProvider>,
  );
}

function setActions(actions: AuditAction[], total = actions.length) {
  mockAuditQuery.mockReturnValue({
    queryKey: ['audit'],
    queryFn: vi.fn().mockResolvedValue({ actions, total, hasMore: false }),
  });
}

function setSummary(summary: AuditSummary) {
  mockAuditSummaryQuery.mockReturnValue({
    queryKey: ['audit-summary'],
    queryFn: vi.fn().mockResolvedValue(summary),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuditPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActions([makeAction()]);
    setSummary(makeSummary());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the page heading, summary and an audit row without crashing', async () => {
    renderPage();
    expect(screen.getByText('Audit Trail')).toBeDefined();
    await waitFor(() => {
      expect(screen.getByTestId('audit-total-badge')).toBeDefined();
      expect(screen.getByTestId('audit-row-a-1')).toBeDefined();
    });
  });
});
