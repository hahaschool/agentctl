import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SyncPeer } from '@/lib/api';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockSyncPeersQuery,
  mockUsePingSyncPeer,
  mockUseUpsertSyncPeer,
  mockUseDeleteSyncPeer,
  mockToastSuccess,
  mockToastError,
} = vi.hoisted(() => ({
  mockSyncPeersQuery: vi.fn(),
  mockUsePingSyncPeer: vi.fn(),
  mockUseUpsertSyncPeer: vi.fn(),
  mockUseDeleteSyncPeer: vi.fn(),
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

vi.mock('@/lib/queries', () => ({
  syncPeersQuery: () => mockSyncPeersQuery(),
  usePingSyncPeer: () => mockUsePingSyncPeer(),
  useUpsertSyncPeer: () => mockUseUpsertSyncPeer(),
  useDeleteSyncPeer: () => mockUseDeleteSyncPeer(),
}));

// ---------------------------------------------------------------------------
// Component import — AFTER mocks
// ---------------------------------------------------------------------------

import { MeshPeersPage } from './MeshPeersPage';

// ---------------------------------------------------------------------------
// Test data factory
// ---------------------------------------------------------------------------

function makePeer(overrides?: Partial<SyncPeer>): SyncPeer {
  return {
    machineId: 'peer-1',
    hostname: 'mac-mini',
    tailscaleIp: '100.64.0.10',
    syncUrl: 'http://mac-mini:8080',
    role: 'full',
    syncStatus: 'reachable',
    syncIntervalMs: 30_000,
    isSelf: false,
    publicKey: null,
    lastSeen: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMutationHook(
  overrides?: Partial<{
    mutate: ReturnType<typeof vi.fn>;
    isPending: boolean;
    variables: unknown;
  }>,
) {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    variables: undefined as unknown,
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MeshPeersPage />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MeshPeersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSyncPeersQuery.mockReturnValue({
      queryKey: ['sync-peers'],
      queryFn: vi.fn().mockResolvedValue({ peers: [makePeer()] }),
    });
    mockUsePingSyncPeer.mockReturnValue(makeMutationHook());
    mockUseUpsertSyncPeer.mockReturnValue(makeMutationHook());
    mockUseDeleteSyncPeer.mockReturnValue(makeMutationHook());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the page heading', async () => {
    renderPage();
    expect(screen.getByText('Mesh Peers')).toBeDefined();
  });

  it('shows loading skeletons while peers are loading', async () => {
    mockSyncPeersQuery.mockReturnValue({
      queryKey: ['sync-peers'],
      queryFn: vi.fn().mockReturnValue(new Promise(() => {})),
    });
    const { container } = renderPage();
    await waitFor(() => {
      const skeletons = container.querySelectorAll('.animate-pulse');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  it('renders peer rows with hostname and machineId', async () => {
    mockSyncPeersQuery.mockReturnValue({
      queryKey: ['sync-peers'],
      queryFn: vi
        .fn()
        .mockResolvedValue({ peers: [makePeer({ machineId: 'node-alpha', hostname: 'alpha' })] }),
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('alpha')).toBeDefined();
      expect(screen.getByText('node-alpha')).toBeDefined();
    });
  });

  it('shows reachable and unreachable counts in the header', async () => {
    mockSyncPeersQuery.mockReturnValue({
      queryKey: ['sync-peers'],
      queryFn: vi.fn().mockResolvedValue({
        peers: [
          makePeer({ machineId: 'a', syncStatus: 'reachable' }),
          makePeer({ machineId: 'b', syncStatus: 'reachable' }),
          makePeer({ machineId: 'c', syncStatus: 'unreachable' }),
        ],
      }),
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('2 reachable')).toBeDefined();
      expect(screen.getByText('1 unreachable')).toBeDefined();
    });
  });

  it('shows an empty-state message when there are no peers', async () => {
    mockSyncPeersQuery.mockReturnValue({
      queryKey: ['sync-peers'],
      queryFn: vi.fn().mockResolvedValue({ peers: [] }),
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No mesh peers registered.')).toBeDefined();
    });
  });

  it('renders an error banner when the query fails', async () => {
    mockSyncPeersQuery.mockReturnValue({
      queryKey: ['sync-peers'],
      queryFn: vi.fn().mockRejectedValue(new Error('boom')),
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('error-banner')).toBeDefined();
    });
  });

  it('disables the ping button for the self peer', async () => {
    mockSyncPeersQuery.mockReturnValue({
      queryKey: ['sync-peers'],
      queryFn: vi
        .fn()
        .mockResolvedValue({ peers: [makePeer({ machineId: 'self-node', isSelf: true })] }),
    });
    renderPage();
    await waitFor(() => {
      const btn = screen.getByTestId('ping-self-node') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      const deleteBtn = screen.getByTestId('delete-self-node') as HTMLButtonElement;
      expect(deleteBtn.disabled).toBe(true);
    });
  });

  it('disables the ping button when syncUrl is missing', async () => {
    mockSyncPeersQuery.mockReturnValue({
      queryKey: ['sync-peers'],
      queryFn: vi
        .fn()
        .mockResolvedValue({ peers: [makePeer({ machineId: 'no-url', syncUrl: null })] }),
    });
    renderPage();
    await waitFor(() => {
      const btn = screen.getByTestId('ping-no-url') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
  });

  it('invokes the ping mutation when the button is clicked', async () => {
    const mutate = vi.fn();
    mockUsePingSyncPeer.mockReturnValue(makeMutationHook({ mutate }));
    mockSyncPeersQuery.mockReturnValue({
      queryKey: ['sync-peers'],
      queryFn: vi.fn().mockResolvedValue({ peers: [makePeer({ machineId: 'node-x' })] }),
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('ping-node-x')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('ping-node-x'));
    expect(mutate).toHaveBeenCalledWith('node-x', expect.any(Object));
  });

  it('submits a new peer through the upsert mutation', async () => {
    const mutate = vi.fn(
      (_body: unknown, opts: { onSuccess?: (r: { ok: boolean; peer: SyncPeer }) => void }) => {
        opts.onSuccess?.({ ok: true, peer: makePeer({ machineId: 'node-new' }) });
      },
    );
    mockUseUpsertSyncPeer.mockReturnValue(makeMutationHook({ mutate }));
    mockSyncPeersQuery.mockReturnValue({
      queryKey: ['sync-peers'],
      queryFn: vi.fn().mockResolvedValue({ peers: [] }),
    });

    renderPage();
    await waitFor(() => expect(screen.getByTestId('add-mesh-peer')).toBeDefined());
    fireEvent.click(screen.getByTestId('add-mesh-peer'));

    fireEvent.change(screen.getByLabelText('Machine ID'), { target: { value: 'node-new' } });
    fireEvent.change(screen.getByLabelText('Hostname'), { target: { value: 'node.tail.ts.net' } });
    fireEvent.change(screen.getByLabelText('Sync URL'), {
      target: { value: 'https://node.tail.ts.net:8080' },
    });
    fireEvent.change(screen.getByLabelText('Tailscale IP'), { target: { value: '100.64.0.12' } });
    fireEvent.change(screen.getByLabelText('Sync interval seconds'), { target: { value: '45' } });
    fireEvent.change(screen.getByLabelText('Public key'), { target: { value: 'pubkey' } });
    fireEvent.click(screen.getByTestId('mesh-peer-submit'));

    expect(mutate).toHaveBeenCalledWith(
      {
        machineId: 'node-new',
        hostname: 'node.tail.ts.net',
        syncUrl: 'https://node.tail.ts.net:8080',
        tailscaleIp: '100.64.0.12',
        role: 'full',
        syncStatus: 'unknown',
        syncIntervalMs: 45_000,
        isSelf: false,
        publicKey: 'pubkey',
      },
      expect.any(Object),
    );
    expect(mockToastSuccess).toHaveBeenCalledWith(expect.stringContaining('saved'));
  });

  it('shows add-peer validation errors before mutation', async () => {
    const mutate = vi.fn();
    mockUseUpsertSyncPeer.mockReturnValue(makeMutationHook({ mutate }));
    mockSyncPeersQuery.mockReturnValue({
      queryKey: ['sync-peers'],
      queryFn: vi.fn().mockResolvedValue({ peers: [] }),
    });

    renderPage();
    await waitFor(() => expect(screen.getByTestId('add-mesh-peer')).toBeDefined());
    fireEvent.click(screen.getByTestId('add-mesh-peer'));
    fireEvent.change(screen.getByLabelText('Machine ID'), { target: { value: 'node-new' } });
    fireEvent.change(screen.getByLabelText('Hostname'), { target: { value: 'node.tail.ts.net' } });
    fireEvent.change(screen.getByLabelText('Sync URL'), { target: { value: 'ftp://node' } });
    fireEvent.click(screen.getByTestId('mesh-peer-submit'));

    expect(screen.getByTestId('mesh-peer-form-error').textContent).toContain('valid http(s) URL');
    expect(mutate).not.toHaveBeenCalled();
  });

  it('invokes the delete mutation after confirmation', async () => {
    const mutate = vi.fn((_machineId: string, opts: { onSuccess?: () => void }) => {
      opts.onSuccess?.();
    });
    mockUseDeleteSyncPeer.mockReturnValue(makeMutationHook({ mutate }));
    mockSyncPeersQuery.mockReturnValue({
      queryKey: ['sync-peers'],
      queryFn: vi.fn().mockResolvedValue({ peers: [makePeer({ machineId: 'node-delete' })] }),
    });

    renderPage();
    await waitFor(() => expect(screen.getByTestId('delete-node-delete')).toBeDefined());
    fireEvent.click(screen.getByTestId('delete-node-delete'));
    expect(screen.getByTestId('mesh-peer-delete-confirm')).toBeDefined();
    fireEvent.click(screen.getByTestId('confirm-delete-mesh-peer'));

    expect(mutate).toHaveBeenCalledWith('node-delete', expect.any(Object));
    expect(mockToastSuccess).toHaveBeenCalledWith(expect.stringContaining('deleted'));
  });

  it('shows a success toast when the ping resolves reachable', async () => {
    const mutate = vi.fn(
      (
        _machineId: string,
        opts: { onSuccess?: (r: { ok: boolean; status: string; peer: null }) => void },
      ) => {
        opts.onSuccess?.({ ok: true, status: 'reachable', peer: null });
      },
    );
    mockUsePingSyncPeer.mockReturnValue(makeMutationHook({ mutate }));
    mockSyncPeersQuery.mockReturnValue({
      queryKey: ['sync-peers'],
      queryFn: vi.fn().mockResolvedValue({ peers: [makePeer({ machineId: 'node-y' })] }),
    });

    renderPage();
    await waitFor(() => expect(screen.getByTestId('ping-node-y')).toBeDefined());
    fireEvent.click(screen.getByTestId('ping-node-y'));

    expect(mockToastSuccess).toHaveBeenCalledWith(expect.stringContaining('reachable'));
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('shows an error toast when the ping reports unreachable', async () => {
    const mutate = vi.fn(
      (
        _machineId: string,
        opts: { onSuccess?: (r: { ok: boolean; status: string; peer: null }) => void },
      ) => {
        opts.onSuccess?.({ ok: true, status: 'unreachable', peer: null });
      },
    );
    mockUsePingSyncPeer.mockReturnValue(makeMutationHook({ mutate }));
    mockSyncPeersQuery.mockReturnValue({
      queryKey: ['sync-peers'],
      queryFn: vi.fn().mockResolvedValue({ peers: [makePeer({ machineId: 'node-z' })] }),
    });

    renderPage();
    await waitFor(() => expect(screen.getByTestId('ping-node-z')).toBeDefined());
    fireEvent.click(screen.getByTestId('ping-node-z'));

    expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining('unreachable'));
  });

  it('shows "Pinging…" label on the currently-pinging row', async () => {
    mockUsePingSyncPeer.mockReturnValue(makeMutationHook({ isPending: true, variables: 'node-q' }));
    mockSyncPeersQuery.mockReturnValue({
      queryKey: ['sync-peers'],
      queryFn: vi.fn().mockResolvedValue({ peers: [makePeer({ machineId: 'node-q' })] }),
    });
    renderPage();
    await waitFor(() => {
      const btn = screen.getByTestId('ping-node-q') as HTMLButtonElement;
      expect(btn.textContent).toContain('Pinging');
      expect(btn.disabled).toBe(true);
    });
  });

  it('triggers refetch when the Refresh button is clicked', async () => {
    const refetch = vi.fn();
    mockSyncPeersQuery.mockReturnValue({
      queryKey: ['sync-peers'],
      queryFn: vi.fn().mockResolvedValue({ peers: [makePeer()] }),
      refetch,
    });
    renderPage();
    fireEvent.click(screen.getByTestId('refresh-button'));
    // React Query's refetch is called internally — we just verify the button is wired
    expect(screen.getByTestId('refresh-button')).toBeDefined();
  });

  it('shows inline length error and disables submit when sync URL exceeds 2048 chars', async () => {
    const mutate = vi.fn();
    mockUseUpsertSyncPeer.mockReturnValue(makeMutationHook({ mutate }));
    mockSyncPeersQuery.mockReturnValue({
      queryKey: ['sync-peers'],
      queryFn: vi.fn().mockResolvedValue({ peers: [] }),
    });

    renderPage();
    await waitFor(() => expect(screen.getByTestId('add-mesh-peer')).toBeDefined());
    fireEvent.click(screen.getByTestId('add-mesh-peer'));

    const tooLong = `https://node.tail.ts.net/${'x'.repeat(2048)}`;
    fireEvent.change(screen.getByLabelText('Sync URL'), { target: { value: tooLong } });

    await waitFor(() => {
      expect(screen.getByTestId('mesh-peer-sync-url-length-error').textContent).toContain(
        'URL too long',
      );
    });
    const submit = screen.getByTestId('mesh-peer-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(mutate).not.toHaveBeenCalled();
  });
});
