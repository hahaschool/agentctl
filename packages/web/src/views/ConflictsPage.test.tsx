import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SyncConflictItem } from '@/lib/api';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockSyncConflictsQuery, mockUseResolveSyncConflict, mockToastSuccess, mockToastError } =
  vi.hoisted(() => ({
    mockSyncConflictsQuery: vi.fn(),
    mockUseResolveSyncConflict: vi.fn(),
    mockToastSuccess: vi.fn(),
    mockToastError: vi.fn(),
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

vi.mock('@/components/Toast', () => ({
  useToast: () => ({
    success: mockToastSuccess,
    error: mockToastError,
  }),
}));

vi.mock('@/components/ConflictDiffView', () => ({
  ConflictDiffView: ({
    conflict,
    onResolve,
    isResolving,
  }: {
    conflict: SyncConflictItem;
    onResolve: (
      resolution: 'local' | 'remote' | 'merged',
      payload?: Record<string, unknown> | null,
    ) => void;
    isResolving: boolean;
  }) => (
    <div data-testid="conflict-diff-view">
      <span data-testid="diff-conflict-id">{conflict.id}</span>
      <span data-testid="diff-table-name">{conflict.tableName}</span>
      <span data-testid="diff-resolving">{String(isResolving)}</span>
      <button type="button" data-testid="resolve-local" onClick={() => onResolve('local')}>
        Keep Local
      </button>
      <button type="button" data-testid="resolve-remote" onClick={() => onResolve('remote')}>
        Keep Remote
      </button>
      <button
        type="button"
        data-testid="resolve-merged"
        onClick={() => onResolve('merged', { merged: true })}
      >
        Merge
      </button>
    </div>
  ),
}));

vi.mock('@/lib/queries', () => ({
  syncConflictsQuery: (params?: unknown) => mockSyncConflictsQuery(params),
  useResolveSyncConflict: () => mockUseResolveSyncConflict(),
}));

// ---------------------------------------------------------------------------
// Component import — AFTER mocks
// ---------------------------------------------------------------------------

import { ConflictsPage } from './ConflictsPage';

// ---------------------------------------------------------------------------
// Test data factory
// ---------------------------------------------------------------------------

function makeConflict(overrides?: Partial<SyncConflictItem>): SyncConflictItem {
  return {
    id: 'conflict-1',
    tableName: 'memory_facts',
    rowId: 'row-abc123def456',
    localVclock: { node1: 3 },
    localPayload: { content: 'local value' },
    remoteVclock: { node2: 5 },
    remotePayload: { content: 'remote value' },
    remoteNodeId: 'remote-node-id-abcdef1234567890',
    status: 'pending',
    resolution: null,
    resolvedAt: null,
    createdAt: '2026-04-15T10:00:00.000Z',
    ...overrides,
  };
}

function makeMutationHook(
  overrides?: Partial<{
    mutate: ReturnType<typeof vi.fn>;
    isPending: boolean;
  }>,
) {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    ...overrides,
  };
}

/**
 * Helper: finds the conflict row buttons rendered by ConflictRow.
 * Each row is a <button> with role="button" inside the scrollable list.
 */
function getConflictRowButtons(): HTMLButtonElement[] {
  // Conflict rows are buttons that contain font-mono spans (table names).
  // We exclude known test-id buttons (refresh, resolve-*).
  return screen.getAllByRole('button').filter((btn) => {
    if (btn.dataset.testid) return false;
    // ConflictRow buttons have text content like "memory_facts / row-abc..."
    return btn.querySelector('.font-mono');
  }) as HTMLButtonElement[];
}

function renderWithData(conflicts: SyncConflictItem[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(['sync-conflicts', { status: 'pending' }], {
    conflicts,
    total: conflicts.length,
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ConflictsPage />
    </QueryClientProvider>,
  );
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ConflictsPage />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConflictsPage', () => {
  beforeEach(() => {
    mockUseResolveSyncConflict.mockReturnValue(makeMutationHook());
    mockSyncConflictsQuery.mockReturnValue({
      queryKey: ['sync-conflicts', { status: 'pending' }],
      queryFn: vi.fn(),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------

  describe('loading state', () => {
    it('renders skeleton placeholders while loading', () => {
      // queryFn returns a never-resolving promise so the query stays pending
      mockSyncConflictsQuery.mockReturnValue({
        queryKey: ['sync-conflicts', { status: 'pending' }],
        queryFn: () => new Promise(() => {}),
      });

      const { container } = renderPage();

      const skeletons = container.querySelectorAll('.animate-pulse');
      expect(skeletons.length).toBe(3);
    });

    it('shows the page heading during loading', () => {
      mockSyncConflictsQuery.mockReturnValue({
        queryKey: ['sync-conflicts', { status: 'pending' }],
        queryFn: () => new Promise(() => {}),
      });

      renderPage();
      expect(screen.getByText('Sync Conflicts')).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Empty state
  // -------------------------------------------------------------------------

  describe('empty state', () => {
    it('shows empty message when no conflicts exist', () => {
      renderWithData([]);
      expect(screen.getByText('No sync conflicts found')).toBeDefined();
    });

    it('shows "all resolved" hint when filtered to pending', () => {
      // Default filter is status=pending, so the hint should appear
      renderWithData([]);
      expect(screen.getByText('All conflicts have been resolved.')).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Error state
  // -------------------------------------------------------------------------

  describe('error state', () => {
    it('renders error banner on query failure', async () => {
      mockSyncConflictsQuery.mockReturnValue({
        queryKey: ['sync-conflicts', { status: 'pending' }],
        queryFn: () => Promise.reject(new Error('Network error')),
        refetchInterval: false,
      });

      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });

      render(
        <QueryClientProvider client={queryClient}>
          <ConflictsPage />
        </QueryClientProvider>,
      );

      const errorBanner = await screen.findByTestId('error-banner');
      expect(errorBanner).toBeDefined();
      expect(errorBanner.textContent).toContain('Network error');
    });
  });

  // -------------------------------------------------------------------------
  // Conflict list rendering
  // -------------------------------------------------------------------------

  describe('conflict list rendering', () => {
    it('renders each conflict row with table name and truncated row ID', () => {
      const conflicts = [
        makeConflict({ id: 'c-1', tableName: 'memory_facts', rowId: 'row-abc123def456' }),
        makeConflict({ id: 'c-2', tableName: 'agents', rowId: 'row-xyz789ghi012' }),
      ];

      renderWithData(conflicts);

      const rows = getConflictRowButtons();
      expect(rows.length).toBe(2);

      // First row: memory_facts with truncated row ID
      expect(within(rows[0]).getByText('memory_facts')).toBeDefined();
      expect(within(rows[0]).getByText('row-abc123de')).toBeDefined();

      // Second row: agents with truncated row ID
      expect(within(rows[1]).getByText('agents')).toBeDefined();
      expect(within(rows[1]).getByText('row-xyz789gh')).toBeDefined();
    });

    it('shows DELETE badge when localPayload is null', () => {
      renderWithData([makeConflict({ id: 'c-1', localPayload: null })]);
      expect(screen.getByText('DELETE')).toBeDefined();
    });

    it('shows DELETE badge when remotePayload is null', () => {
      renderWithData([makeConflict({ id: 'c-1', remotePayload: null })]);
      expect(screen.getByText('DELETE')).toBeDefined();
    });

    it('does not show DELETE badge when both payloads are present', () => {
      renderWithData([makeConflict({ id: 'c-1' })]);
      expect(screen.queryByText('DELETE')).toBeNull();
    });

    it('shows PENDING status badge for pending conflicts', () => {
      renderWithData([makeConflict({ id: 'c-1', status: 'pending' })]);
      expect(screen.getByText('PENDING')).toBeDefined();
    });

    it('shows RESOLVED status badge for resolved conflicts', () => {
      renderWithData([makeConflict({ id: 'c-1', status: 'resolved' })]);
      expect(screen.getByText('RESOLVED')).toBeDefined();
    });

    it('shows pending count badge in header', () => {
      const conflicts = [
        makeConflict({ id: 'c-1', status: 'pending' }),
        makeConflict({ id: 'c-2', status: 'pending' }),
        makeConflict({ id: 'c-3', status: 'resolved' }),
      ];
      renderWithData(conflicts);
      expect(screen.getByText('2 pending')).toBeDefined();
    });

    it('does not show pending count badge when all are resolved', () => {
      renderWithData([makeConflict({ id: 'c-1', status: 'resolved' })]);
      // The badge shows "{n} pending" — should not appear when count is 0.
      // Note: "Pending" also appears in the status filter dropdown, so match
      // the specific badge pattern with a number.
      expect(screen.queryByText(/\d+ pending/)).toBeNull();
    });

    it('shows truncated remoteNodeId in row details', () => {
      renderWithData([makeConflict({ id: 'c-1', remoteNodeId: 'abcdef1234567890abcdef' })]);
      const rows = getConflictRowButtons();
      // The row shows remoteNodeId sliced to 12 chars
      expect(within(rows[0]).getByText(/abcdef123456/)).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Selection and detail view
  // -------------------------------------------------------------------------

  describe('selection and detail view', () => {
    it('shows placeholder text when no conflict is selected', () => {
      renderWithData([makeConflict({ id: 'c-1' })]);
      expect(screen.getByText('Select a conflict to view details')).toBeDefined();
    });

    it('shows ConflictDiffView when a conflict row is clicked', () => {
      renderWithData([makeConflict({ id: 'c-1', tableName: 'memory_facts' })]);

      const rows = getConflictRowButtons();
      fireEvent.click(rows[0]);

      expect(screen.getByTestId('conflict-diff-view')).toBeDefined();
      expect(screen.getByTestId('diff-conflict-id').textContent).toBe('c-1');
    });

    it('deselects when clicking the same conflict row again', () => {
      renderWithData([makeConflict({ id: 'c-1', tableName: 'memory_facts' })]);

      const rows = getConflictRowButtons();

      // Click to select
      fireEvent.click(rows[0]);
      expect(screen.getByTestId('conflict-diff-view')).toBeDefined();

      // Click again to deselect
      fireEvent.click(rows[0]);
      expect(screen.queryByTestId('conflict-diff-view')).toBeNull();
      expect(screen.getByText('Select a conflict to view details')).toBeDefined();
    });

    it('switches selection when clicking a different conflict', () => {
      renderWithData([
        makeConflict({ id: 'c-1', tableName: 'memory_facts' }),
        makeConflict({ id: 'c-2', tableName: 'agents' }),
      ]);

      const rows = getConflictRowButtons();

      // Select first
      fireEvent.click(rows[0]);
      expect(screen.getByTestId('diff-conflict-id').textContent).toBe('c-1');

      // Select second
      fireEvent.click(rows[1]);
      expect(screen.getByTestId('diff-conflict-id').textContent).toBe('c-2');
    });
  });

  // -------------------------------------------------------------------------
  // Filter dropdowns
  // -------------------------------------------------------------------------

  describe('filter dropdowns', () => {
    it('renders status, table, and peer filter dropdowns', () => {
      renderWithData([makeConflict()]);

      expect(screen.getByLabelText('Filter by status')).toBeDefined();
      expect(screen.getByLabelText('Filter by table')).toBeDefined();
      expect(screen.getByLabelText('Filter by peer')).toBeDefined();
    });

    it('populates table filter from conflict data', () => {
      const conflicts = [
        makeConflict({ id: 'c-1', tableName: 'memory_facts' }),
        makeConflict({ id: 'c-2', tableName: 'agents' }),
        makeConflict({ id: 'c-3', tableName: 'memory_facts' }),
      ];
      renderWithData(conflicts);

      const tableSelect = screen.getByLabelText('Filter by table') as HTMLSelectElement;
      const options = Array.from(tableSelect.options).map((o) => o.value);
      // Should have "all" empty value + unique sorted tables
      expect(options).toContain('');
      expect(options).toContain('agents');
      expect(options).toContain('memory_facts');
    });

    it('populates peer filter with truncated node IDs', () => {
      const conflicts = [
        makeConflict({ id: 'c-1', remoteNodeId: 'peer-aaaa-bbbb-cccc-dddd-eeee' }),
        makeConflict({ id: 'c-2', remoteNodeId: 'peer-xxxx-yyyy-zzzz-1111-2222' }),
      ];
      renderWithData(conflicts);

      const peerSelect = screen.getByLabelText('Filter by peer') as HTMLSelectElement;
      const optionTexts = Array.from(peerSelect.options).map((o) => o.textContent);
      // Peer options are sliced to 16 chars in display text
      expect(optionTexts).toContain('peer-aaaa-bbbb-c');
      expect(optionTexts).toContain('peer-xxxx-yyyy-z');
    });

    it('peer filter option values are full IDs', () => {
      const conflicts = [
        makeConflict({ id: 'c-1', remoteNodeId: 'peer-aaaa-bbbb-cccc-dddd-eeee' }),
      ];
      renderWithData(conflicts);

      const peerSelect = screen.getByLabelText('Filter by peer') as HTMLSelectElement;
      const optionValues = Array.from(peerSelect.options).map((o) => o.value);
      expect(optionValues).toContain('peer-aaaa-bbbb-cccc-dddd-eeee');
    });

    it('changes status filter when a different option is selected', () => {
      renderWithData([makeConflict()]);

      const statusSelect = screen.getByLabelText('Filter by status') as HTMLSelectElement;
      fireEvent.change(statusSelect, { target: { value: '' } });

      // The syncConflictsQuery is called again with updated params
      expect(mockSyncConflictsQuery).toHaveBeenCalled();
    });

    it('status filter defaults to pending', () => {
      renderWithData([makeConflict()]);

      const statusSelect = screen.getByLabelText('Filter by status') as HTMLSelectElement;
      expect(statusSelect.value).toBe('pending');
    });
  });

  // -------------------------------------------------------------------------
  // Resolution actions
  // -------------------------------------------------------------------------

  describe('resolution actions', () => {
    function renderAndSelect(conflict: SyncConflictItem) {
      renderWithData([conflict]);
      const rows = getConflictRowButtons();
      fireEvent.click(rows[0]);
    }

    it('calls resolve mutation with "local" when Keep Local is clicked', () => {
      const mockMutate = vi.fn();
      mockUseResolveSyncConflict.mockReturnValue(makeMutationHook({ mutate: mockMutate }));

      renderAndSelect(makeConflict({ id: 'c-1' }));
      fireEvent.click(screen.getByTestId('resolve-local'));

      expect(mockMutate).toHaveBeenCalledWith(
        { id: 'c-1', resolution: 'local', payload: undefined },
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }),
      );
    });

    it('calls resolve mutation with "remote" when Keep Remote is clicked', () => {
      const mockMutate = vi.fn();
      mockUseResolveSyncConflict.mockReturnValue(makeMutationHook({ mutate: mockMutate }));

      renderAndSelect(makeConflict({ id: 'c-1' }));
      fireEvent.click(screen.getByTestId('resolve-remote'));

      expect(mockMutate).toHaveBeenCalledWith(
        { id: 'c-1', resolution: 'remote', payload: undefined },
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }),
      );
    });

    it('calls resolve mutation with "merged" and payload when Merge is clicked', () => {
      const mockMutate = vi.fn();
      mockUseResolveSyncConflict.mockReturnValue(makeMutationHook({ mutate: mockMutate }));

      renderAndSelect(makeConflict({ id: 'c-1' }));
      fireEvent.click(screen.getByTestId('resolve-merged'));

      expect(mockMutate).toHaveBeenCalledWith(
        { id: 'c-1', resolution: 'merged', payload: { merged: true } },
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }),
      );
    });

    it('shows success toast and deselects on successful resolution', () => {
      const mockMutate = vi.fn();
      mockUseResolveSyncConflict.mockReturnValue(makeMutationHook({ mutate: mockMutate }));

      renderAndSelect(makeConflict({ id: 'c-1' }));
      fireEvent.click(screen.getByTestId('resolve-local'));

      // Extract and invoke the onSuccess callback inside act() since it triggers state updates
      const callArgs = mockMutate.mock.calls[0][1] as { onSuccess: () => void };
      act(() => {
        callArgs.onSuccess();
      });

      expect(mockToastSuccess).toHaveBeenCalledWith('Conflict resolved: local');
      expect(screen.getByText('Select a conflict to view details')).toBeDefined();
    });

    it('shows error toast on resolution failure with Error instance', () => {
      const mockMutate = vi.fn();
      mockUseResolveSyncConflict.mockReturnValue(makeMutationHook({ mutate: mockMutate }));

      renderAndSelect(makeConflict({ id: 'c-1' }));
      fireEvent.click(screen.getByTestId('resolve-local'));

      const callArgs = mockMutate.mock.calls[0][1] as {
        onError: (err: unknown) => void;
      };
      callArgs.onError(new Error('Server unreachable'));

      expect(mockToastError).toHaveBeenCalledWith('Server unreachable');
    });

    it('shows generic error message for non-Error rejection', () => {
      const mockMutate = vi.fn();
      mockUseResolveSyncConflict.mockReturnValue(makeMutationHook({ mutate: mockMutate }));

      renderAndSelect(makeConflict({ id: 'c-1' }));
      fireEvent.click(screen.getByTestId('resolve-local'));

      const callArgs = mockMutate.mock.calls[0][1] as {
        onError: (err: unknown) => void;
      };
      callArgs.onError('something went wrong');

      expect(mockToastError).toHaveBeenCalledWith('Failed to resolve conflict');
    });

    it('passes isPending from mutation to ConflictDiffView', () => {
      mockUseResolveSyncConflict.mockReturnValue(makeMutationHook({ isPending: true }));

      renderAndSelect(makeConflict({ id: 'c-1' }));

      expect(screen.getByTestId('diff-resolving').textContent).toBe('true');
    });
  });

  // -------------------------------------------------------------------------
  // Refresh button
  // -------------------------------------------------------------------------

  describe('refresh button', () => {
    it('renders the refresh button', () => {
      renderPage();
      expect(screen.getByTestId('refresh-button')).toBeDefined();
    });
  });
});
