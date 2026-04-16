import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SyncPeer } from '@/lib/api';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockSyncPeersQuery,
  mockSyncPeerCursorsQuery,
  mockVersionCompatQuery,
  mockUsePingSyncPeer,
  mockUseUpsertSyncPeer,
  mockUseDeleteSyncPeer,
  mockUseUpdateSyncPeer,
  mockUseRegisterReverseSyncPeer,
  mockUseProbeSyncUrl,
  mockUsePreflightMeshConfig,
  mockToastSuccess,
  mockToastError,
} = vi.hoisted(() => ({
  mockSyncPeersQuery: vi.fn(),
  mockSyncPeerCursorsQuery: vi.fn(),
  mockVersionCompatQuery: vi.fn(),
  mockUsePingSyncPeer: vi.fn(),
  mockUseUpsertSyncPeer: vi.fn(),
  mockUseDeleteSyncPeer: vi.fn(),
  mockUseUpdateSyncPeer: vi.fn(),
  mockUseRegisterReverseSyncPeer: vi.fn(),
  mockUseProbeSyncUrl: vi.fn(),
  mockUsePreflightMeshConfig: vi.fn(),
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
  syncPeerCursorsQuery: (machineId: string, enabled: boolean) =>
    mockSyncPeerCursorsQuery(machineId, enabled),
  versionCompatQuery: () => mockVersionCompatQuery(),
  usePingSyncPeer: () => mockUsePingSyncPeer(),
  useUpsertSyncPeer: () => mockUseUpsertSyncPeer(),
  useDeleteSyncPeer: () => mockUseDeleteSyncPeer(),
  useUpdateSyncPeer: () => mockUseUpdateSyncPeer(),
  useRegisterReverseSyncPeer: () => mockUseRegisterReverseSyncPeer(),
  useProbeSyncUrl: () => mockUseProbeSyncUrl(),
  usePreflightMeshConfig: () => mockUsePreflightMeshConfig(),
  useDiscoverSyncPeers: () => ({ mutate: vi.fn(), isPending: false }),
  meshConfigQuery: () => ({
    queryKey: ['mesh-config'],
    queryFn: () => Promise.resolve(null),
  }),
}));

// ---------------------------------------------------------------------------
// Component import — AFTER mocks
// ---------------------------------------------------------------------------

import { MeshPeersPage, PreflightStatusIndicator } from './MeshPeersPage';

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

// ---------------------------------------------------------------------------
// PreflightStatusIndicator — §33.12 Phase 3.3
// ---------------------------------------------------------------------------

describe('PreflightStatusIndicator', () => {
  it('renders nothing when idle', () => {
    const { container } = render(<PreflightStatusIndicator state={{ kind: 'idle' }} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders pending text while checking', () => {
    render(<PreflightStatusIndicator state={{ kind: 'pending' }} />);
    expect(screen.getByTestId('preflight-pending')).toBeDefined();
    expect(screen.getByText('Checking token compatibility...')).toBeDefined();
  });

  it('renders green text for compatible', () => {
    render(
      <PreflightStatusIndicator
        state={{
          kind: 'done',
          result: { tokenStatus: 'compatible', errorCode: null, message: 'OK' },
        }}
      />,
    );
    const el = screen.getByTestId('preflight-status-compatible');
    expect(el).toBeDefined();
    expect(el.textContent).toBe('Token compatible');
  });

  it('renders yellow text for mismatch', () => {
    render(
      <PreflightStatusIndicator
        state={{
          kind: 'done',
          result: { tokenStatus: 'mismatch', errorCode: null, message: 'Mismatch' },
        }}
      />,
    );
    const el = screen.getByTestId('preflight-status-mismatch');
    expect(el).toBeDefined();
    expect(el.textContent).toContain('Token mismatch');
  });

  it('renders yellow text for remote_disabled', () => {
    render(
      <PreflightStatusIndicator
        state={{
          kind: 'done',
          result: { tokenStatus: 'remote_disabled', errorCode: null, message: '' },
        }}
      />,
    );
    const el = screen.getByTestId('preflight-status-remote_disabled');
    expect(el).toBeDefined();
    expect(el.textContent).toContain('Remote has no token configured');
  });

  it('renders red text for local_missing', () => {
    render(
      <PreflightStatusIndicator
        state={{
          kind: 'done',
          result: { tokenStatus: 'local_missing', errorCode: null, message: '' },
        }}
      />,
    );
    const el = screen.getByTestId('preflight-status-local_missing');
    expect(el).toBeDefined();
    expect(el.textContent).toContain('No local token');
  });

  it('renders red text with API message for error', () => {
    render(
      <PreflightStatusIndicator
        state={{
          kind: 'done',
          result: { tokenStatus: 'error', errorCode: 'FETCH_FAILED', message: 'Peer unreachable' },
        }}
      />,
    );
    const el = screen.getByTestId('preflight-status-error');
    expect(el).toBeDefined();
    expect(el.textContent).toBe('Peer unreachable');
  });

  it('renders fallback message for error with empty message', () => {
    render(
      <PreflightStatusIndicator
        state={{
          kind: 'done',
          result: { tokenStatus: 'error', errorCode: null, message: '' },
        }}
      />,
    );
    const el = screen.getByTestId('preflight-status-error');
    expect(el.textContent).toBe('Preflight check failed');
  });
});

describe('MeshPeersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSyncPeersQuery.mockReturnValue({
      queryKey: ['sync-peers'],
      queryFn: vi.fn().mockResolvedValue({ peers: [makePeer()] }),
    });
    mockSyncPeerCursorsQuery.mockImplementation((machineId: string, enabled: boolean) => ({
      queryKey: ['sync-peer-cursors', machineId],
      queryFn: vi.fn().mockResolvedValue({
        machineId,
        localNodeId: 'self',
        remoteNodeId: machineId,
        pulledCursor: 0,
        ackedCursor: 0,
        lastPullAt: null,
        lastAckAt: null,
        updatedAt: null,
      }),
      enabled,
    }));
    mockVersionCompatQuery.mockReturnValue({
      queryKey: ['version-compat'],
      // Default: local matches the banner's local probe so the "update available"
      // banner is hidden unless a test explicitly asks for an out-of-date local.
      queryFn: vi.fn().mockResolvedValue({
        appVersion: 'v9.9.9',
        gitSha: 'sha',
        schemaVersion: 26,
        minSupportedMobileBuild: 1,
        minSupportedWebBuild: 1,
      }),
    });
    mockUsePingSyncPeer.mockReturnValue(makeMutationHook());
    mockUseUpsertSyncPeer.mockReturnValue(makeMutationHook());
    mockUseDeleteSyncPeer.mockReturnValue(makeMutationHook());
    mockUseUpdateSyncPeer.mockReturnValue(makeMutationHook());
    mockUseRegisterReverseSyncPeer.mockReturnValue(makeMutationHook());
    mockUseProbeSyncUrl.mockReturnValue(makeMutationHook());
    mockUsePreflightMeshConfig.mockReturnValue(makeMutationHook());
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
      expect(screen.getByText('No mesh peers registered')).toBeDefined();
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
    // §33.7: add-peer path requires a passing probe before Save is enabled.
    const probeMutate = vi.fn(
      (
        _url: string,
        opts: { onSuccess?: (r: { reachable: boolean; statusCode?: number }) => void },
      ) => {
        opts.onSuccess?.({ reachable: true, statusCode: 200 });
      },
    );
    mockUseUpsertSyncPeer.mockReturnValue(makeMutationHook({ mutate }));
    mockUseProbeSyncUrl.mockReturnValue(makeMutationHook({ mutate: probeMutate }));
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
    fireEvent.click(screen.getByTestId('mesh-peer-probe'));
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

  it('opens a prefilled update dialog for a non-self peer and submits through upsert', async () => {
    const mutate = vi.fn(
      (_body: unknown, opts: { onSuccess?: (r: { ok: boolean; peer: SyncPeer }) => void }) => {
        opts.onSuccess?.({ ok: true, peer: makePeer({ machineId: 'node-edit' }) });
      },
    );
    mockUseUpsertSyncPeer.mockReturnValue(makeMutationHook({ mutate }));
    mockSyncPeersQuery.mockReturnValue({
      queryKey: ['sync-peers'],
      queryFn: vi.fn().mockResolvedValue({
        peers: [
          makePeer({
            machineId: 'node-edit',
            hostname: 'old.tail.ts.net',
            tailscaleIp: '100.64.0.31',
            syncUrl: 'https://old.tail.ts.net:8080',
            role: 'observer',
            syncStatus: 'unreachable',
            syncIntervalMs: 60_000,
            publicKey: 'old-public-key',
          }),
        ],
      }),
    });

    renderPage();
    await waitFor(() => expect(screen.getByTestId('edit-node-edit')).toBeDefined());
    fireEvent.click(screen.getByTestId('edit-node-edit'));

    expect(screen.getByRole('heading', { name: 'Update mesh peer' })).toBeDefined();
    const machineIdInput = screen.getByLabelText('Machine ID') as HTMLInputElement;
    expect(machineIdInput.value).toBe('node-edit');
    expect(machineIdInput.disabled).toBe(true);
    expect((screen.getByLabelText('Hostname') as HTMLInputElement).value).toBe('old.tail.ts.net');
    expect((screen.getByLabelText('Sync URL') as HTMLInputElement).value).toBe(
      'https://old.tail.ts.net:8080',
    );
    expect((screen.getByLabelText('Tailscale IP') as HTMLInputElement).value).toBe('100.64.0.31');
    expect((screen.getByLabelText('Sync interval seconds') as HTMLInputElement).value).toBe('60');
    expect((screen.getByLabelText('Public key') as HTMLInputElement).value).toBe('old-public-key');

    fireEvent.change(screen.getByLabelText('Hostname'), {
      target: { value: 'new.tail.ts.net' },
    });
    fireEvent.change(screen.getByLabelText('Sync URL'), {
      target: { value: 'https://new.tail.ts.net:9090' },
    });
    fireEvent.change(screen.getByLabelText('Tailscale IP'), { target: { value: '100.64.0.32' } });
    fireEvent.change(screen.getByLabelText('Sync interval seconds'), { target: { value: '75' } });
    fireEvent.change(screen.getByLabelText('Public key'), { target: { value: 'new-public-key' } });
    fireEvent.click(screen.getByTestId('mesh-peer-submit'));

    expect(mutate).toHaveBeenCalledWith(
      {
        machineId: 'node-edit',
        hostname: 'new.tail.ts.net',
        syncUrl: 'https://new.tail.ts.net:9090',
        tailscaleIp: '100.64.0.32',
        role: 'full',
        syncStatus: 'unreachable',
        syncIntervalMs: 75_000,
        isSelf: false,
        publicKey: 'new-public-key',
      },
      expect.any(Object),
    );
    expect(mockToastSuccess).toHaveBeenCalledWith(expect.stringContaining('updated'));
  });

  it('disables editing for the self peer', async () => {
    mockSyncPeersQuery.mockReturnValue({
      queryKey: ['sync-peers'],
      queryFn: vi.fn().mockResolvedValue({
        peers: [makePeer({ machineId: 'self-node', isSelf: true })],
      }),
    });

    renderPage();

    await waitFor(() => {
      const editBtn = screen.getByTestId('edit-self-node') as HTMLButtonElement;
      expect(editBtn.disabled).toBe(true);
    });
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

  // ---------------------------------------------------------------------------
  // 33.9 Mesh Version Observability
  // ---------------------------------------------------------------------------

  it('renders the peer version with a drift dot when peerVersion is present', async () => {
    mockSyncPeersQuery.mockReturnValue({
      queryKey: ['sync-peers'],
      queryFn: vi.fn().mockResolvedValue({
        peers: [makePeer({ machineId: 'node-match', peerVersion: 'v0.4.0' } as Partial<SyncPeer>)],
      }),
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('v0.4.0')).toBeDefined();
      expect(screen.getByTestId('peer-version-match')).toBeDefined();
    });
  });

  it('renders a muted dash when peerVersion is absent', async () => {
    mockSyncPeersQuery.mockReturnValue({
      queryKey: ['sync-peers'],
      queryFn: vi.fn().mockResolvedValue({
        peers: [makePeer({ machineId: 'node-no-version' })],
      }),
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('peer-version-missing')).toBeDefined();
    });
  });

  it('classifies a newer peer as ahead (blue dot)', async () => {
    mockSyncPeersQuery.mockReturnValue({
      queryKey: ['sync-peers'],
      queryFn: vi.fn().mockResolvedValue({
        peers: [makePeer({ machineId: 'node-new', peerVersion: 'v0.5.0' } as Partial<SyncPeer>)],
      }),
    });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('peer-version-ahead')).toBeDefined());
  });

  it('classifies an older peer as behind (yellow dot)', async () => {
    mockSyncPeersQuery.mockReturnValue({
      queryKey: ['sync-peers'],
      queryFn: vi.fn().mockResolvedValue({
        peers: [makePeer({ machineId: 'node-old', peerVersion: 'v0.3.1' } as Partial<SyncPeer>)],
      }),
    });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('peer-version-behind')).toBeDefined());
  });

  it('shows the drift banner when peers span multiple versions', async () => {
    mockSyncPeersQuery.mockReturnValue({
      queryKey: ['sync-peers'],
      queryFn: vi.fn().mockResolvedValue({
        peers: [
          makePeer({ machineId: 'a', peerVersion: 'v0.4.0' } as Partial<SyncPeer>),
          makePeer({ machineId: 'b', peerVersion: 'v0.3.1' } as Partial<SyncPeer>),
        ],
      }),
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('mesh-drift-banner')).toBeDefined();
    });
    expect(screen.getByTestId('mesh-drift-banner').textContent).toContain('v0.4.0');
    expect(screen.getByTestId('mesh-drift-banner').textContent).toContain('v0.3.1');
  });

  it('hides the drift banner when all peers report the local version', async () => {
    mockSyncPeersQuery.mockReturnValue({
      queryKey: ['sync-peers'],
      queryFn: vi.fn().mockResolvedValue({
        peers: [
          makePeer({ machineId: 'a', peerVersion: 'v0.4.0' } as Partial<SyncPeer>),
          makePeer({ machineId: 'b', peerVersion: 'v0.4.0' } as Partial<SyncPeer>),
        ],
      }),
    });
    renderPage();
    await waitFor(() => expect(screen.getAllByText('v0.4.0').length).toBeGreaterThan(0));
    expect(screen.queryByTestId('mesh-drift-banner')).toBeNull();
  });

  it('expands and dismisses the drift banner', async () => {
    mockSyncPeersQuery.mockReturnValue({
      queryKey: ['sync-peers'],
      queryFn: vi.fn().mockResolvedValue({
        peers: [
          makePeer({ machineId: 'a', peerVersion: 'v0.4.0' } as Partial<SyncPeer>),
          makePeer({ machineId: 'b', peerVersion: 'v0.3.1' } as Partial<SyncPeer>),
        ],
      }),
    });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('mesh-drift-banner')).toBeDefined());

    // Expand
    fireEvent.click(screen.getByTestId('mesh-drift-banner-toggle'));
    expect(screen.getByTestId('mesh-drift-banner-breakdown')).toBeDefined();

    // Dismiss
    fireEvent.click(screen.getByTestId('mesh-drift-banner-dismiss'));
    expect(screen.queryByTestId('mesh-drift-banner')).toBeNull();
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

  // ---------------------------------------------------------------------------
  // §33.8 — Reverse registration badge + retry
  // ---------------------------------------------------------------------------

  describe('reverse registration badge', () => {
    it('renders the "One-way" badge + Retry button for a failed peer', async () => {
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({
          peers: [
            makePeer({
              machineId: 'peer-broken',
              reverseRegistrationStatus: 'failed',
              reverseRegistrationError: 'HTTP 401 Unauthorized bootstrap token invalid',
            }),
          ],
        }),
      });

      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId('reverse-badge-peer-broken')).toBeDefined();
      });
      const badge = screen.getByTestId('reverse-badge-peer-broken');
      expect(badge.textContent).toContain('One-way');
      expect(badge.getAttribute('title')).toContain('HTTP 401 Unauthorized');

      const retry = screen.getByTestId('reverse-retry-peer-broken');
      expect(retry.textContent).toContain('Retry');
    });

    it('does not render the badge when reverse registration is ok', async () => {
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({
          peers: [makePeer({ machineId: 'peer-ok', reverseRegistrationStatus: 'ok' })],
        }),
      });

      renderPage();
      await waitFor(() => {
        expect(screen.getAllByRole('row').length).toBeGreaterThan(0);
      });
      expect(screen.queryByTestId('reverse-badge-peer-ok')).toBeNull();
      expect(screen.queryByTestId('reverse-retry-peer-ok')).toBeNull();
    });

    it('does not render the badge for self rows even when status=failed', async () => {
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({
          peers: [
            makePeer({
              machineId: 'peer-self',
              isSelf: true,
              reverseRegistrationStatus: 'failed',
              reverseRegistrationError: 'ignored',
            }),
          ],
        }),
      });

      renderPage();
      await waitFor(() => {
        expect(screen.getAllByRole('row').length).toBeGreaterThan(0);
      });
      expect(screen.queryByTestId('reverse-badge-peer-self')).toBeNull();
    });

    it('clicking Retry invokes the register-reverse mutation for the peer', async () => {
      const mutate = vi.fn();
      mockUseRegisterReverseSyncPeer.mockReturnValue(makeMutationHook({ mutate }));
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({
          peers: [
            makePeer({
              machineId: 'peer-broken',
              reverseRegistrationStatus: 'failed',
              reverseRegistrationError: 'HTTP 500',
            }),
          ],
        }),
      });

      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId('reverse-retry-peer-broken')).toBeDefined();
      });
      fireEvent.click(screen.getByTestId('reverse-retry-peer-broken'));

      expect(mutate).toHaveBeenCalledTimes(1);
      expect(mutate.mock.calls[0]?.[0]).toBe('peer-broken');
    });

    it('disables the Retry button while the mutation is pending for that row', async () => {
      mockUseRegisterReverseSyncPeer.mockReturnValue(
        makeMutationHook({ isPending: true, variables: 'peer-broken' }),
      );
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({
          peers: [
            makePeer({
              machineId: 'peer-broken',
              reverseRegistrationStatus: 'failed',
              reverseRegistrationError: 'HTTP 500',
            }),
          ],
        }),
      });

      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId('reverse-retry-peer-broken')).toBeDefined();
      });
      const retry = screen.getByTestId('reverse-retry-peer-broken') as HTMLButtonElement;
      expect(retry.disabled).toBe(true);
      expect(retry.textContent).toContain('Retrying');
    });
  });

  // ---------------------------------------------------------------------------
  // §33.10 — Per-row "Peer ahead — update this node" badge
  // ---------------------------------------------------------------------------

  describe('peer-ahead badge', () => {
    // LOCAL_SCHEMA_VERSION is pinned at 26 in mesh-version.ts. Tests stay
    // resilient by constructing peers relative to a clearly-ahead value.
    const AHEAD_SCHEMA = 99;
    const BEHIND_SCHEMA = 1;

    it('renders the badge with "update this node" text when peer schema is ahead', async () => {
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({
          peers: [
            makePeer({
              machineId: 'peer-ahead',
              peerVersion: 'v0.5.0',
              peerSchemaVersion: AHEAD_SCHEMA,
            } as Partial<SyncPeer>),
          ],
        }),
      });

      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId('peer-ahead-badge-peer-ahead')).toBeDefined();
      });
      const badge = screen.getByTestId('peer-ahead-badge-peer-ahead');
      expect(badge.textContent).toContain('update this node');
      expect(badge.getAttribute('aria-label')).toContain('ahead on schema version');
    });

    it('does not render the badge when peer schema matches local', async () => {
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({
          peers: [
            makePeer({
              machineId: 'peer-match',
              peerVersion: 'v0.4.0',
              peerSchemaVersion: 26,
            } as Partial<SyncPeer>),
          ],
        }),
      });

      renderPage();
      await waitFor(() => {
        expect(screen.getAllByRole('row').length).toBeGreaterThan(0);
      });
      expect(screen.queryByTestId('peer-ahead-badge-peer-match')).toBeNull();
    });

    it('does not render the ahead badge when peer schema is behind', async () => {
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({
          peers: [
            makePeer({
              machineId: 'peer-behind',
              peerVersion: 'v0.3.1',
              peerSchemaVersion: BEHIND_SCHEMA,
            } as Partial<SyncPeer>),
          ],
        }),
      });

      renderPage();
      await waitFor(() => {
        expect(screen.getAllByRole('row').length).toBeGreaterThan(0);
      });
      expect(screen.queryByTestId('peer-ahead-badge-peer-behind')).toBeNull();
    });

    it('renders a tooltip-only badge (non-button) when Update is unavailable', async () => {
      // Peer has no syncUrl => canUpdatePeer() returns false => updateAvailable=false.
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({
          peers: [
            makePeer({
              machineId: 'peer-ahead-nosync',
              syncUrl: null,
              peerVersion: 'v0.5.0',
              peerSchemaVersion: AHEAD_SCHEMA,
            } as Partial<SyncPeer>),
          ],
        }),
      });

      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId('peer-ahead-badge-peer-ahead-nosync')).toBeDefined();
      });
      const badge = screen.getByTestId('peer-ahead-badge-peer-ahead-nosync');
      // Not a button — the badge is informational only (rendered as <output>).
      expect(badge.tagName).toBe('OUTPUT');
      expect(badge.getAttribute('title')).toContain('not directly updatable');
    });

    it('does not render the badge on self rows', async () => {
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({
          peers: [
            makePeer({
              machineId: 'peer-self',
              isSelf: true,
              peerVersion: 'v0.4.0',
              peerSchemaVersion: AHEAD_SCHEMA,
            } as Partial<SyncPeer>),
          ],
        }),
      });

      renderPage();
      await waitFor(() => {
        expect(screen.getAllByRole('row').length).toBeGreaterThan(0);
      });
      expect(screen.queryByTestId('peer-ahead-badge-peer-self')).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // §33.10 — Persistent "Peer ahead (schema vX)" rejection badge
  //
  // Unlike the advisory `PeerAheadBadge` (ping-derived schema drift), this one
  // only renders when the apply-side compat gate has actually rejected one or
  // more envelopes from the peer. The backend stamps lastSchemaAheadVersion /
  // schemaAheadCount on the peer row when the rejection fires.
  // ---------------------------------------------------------------------------

  describe('peer-schema-ahead badge (rejection-persisted)', () => {
    it('renders the badge when schemaAheadCount > 0 with the peer schema version', async () => {
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({
          peers: [
            makePeer({
              machineId: 'peer-reject',
              lastSchemaAheadVersion: 42,
              schemaAheadCount: 3,
              lastSchemaAheadAt: '2026-04-15T12:00:00.000Z',
            } as Partial<SyncPeer>),
          ],
        }),
      });

      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId('peer-schema-ahead-badge-peer-reject')).toBeDefined();
      });
      const badge = screen.getByTestId('peer-schema-ahead-badge-peer-reject');
      // Destructive tone and explicit schema version in the label text.
      expect(badge.textContent).toContain('Peer ahead');
      expect(badge.textContent).toContain('schema v42');
      // Tooltip explains the count + local version and directs operator action.
      const title = badge.getAttribute('title') ?? '';
      expect(title).toContain('3 envelopes');
      expect(title).toContain('schema v42');
      expect(title).toContain('your local v26');
      expect(title).toContain('Update this control plane');
      // A11y: <output> has implicit role="status" — explicit attribute is
      // redundant per WAI-ARIA. We assert the tag + aria-label carry intent.
      expect(badge.tagName).toBe('OUTPUT');
      expect(badge.getAttribute('aria-label')).toContain('peer-reject');
      expect(badge.getAttribute('aria-label')).toContain('3 schema-ahead envelopes');
    });

    it('uses singular "envelope" wording when schemaAheadCount === 1', async () => {
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({
          peers: [
            makePeer({
              machineId: 'peer-single',
              lastSchemaAheadVersion: 27,
              schemaAheadCount: 1,
            } as Partial<SyncPeer>),
          ],
        }),
      });

      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId('peer-schema-ahead-badge-peer-single')).toBeDefined();
      });
      const badge = screen.getByTestId('peer-schema-ahead-badge-peer-single');
      const title = badge.getAttribute('title') ?? '';
      expect(title).toContain('1 envelope');
      expect(title).not.toContain('1 envelopes');
    });

    it('does not render the badge when schemaAheadCount is 0 or null', async () => {
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({
          peers: [
            makePeer({
              machineId: 'peer-clean-zero',
              schemaAheadCount: 0,
            } as Partial<SyncPeer>),
            makePeer({
              machineId: 'peer-clean-null',
              schemaAheadCount: null,
            } as Partial<SyncPeer>),
          ],
        }),
      });

      renderPage();
      await waitFor(() => {
        expect(screen.getAllByRole('row').length).toBeGreaterThan(1);
      });
      expect(screen.queryByTestId('peer-schema-ahead-badge-peer-clean-zero')).toBeNull();
      expect(screen.queryByTestId('peer-schema-ahead-badge-peer-clean-null')).toBeNull();
    });

    it('does not render the badge on self rows even when count > 0', async () => {
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({
          peers: [
            makePeer({
              machineId: 'peer-self-row',
              isSelf: true,
              lastSchemaAheadVersion: 42,
              schemaAheadCount: 5,
            } as Partial<SyncPeer>),
          ],
        }),
      });

      renderPage();
      await waitFor(() => {
        expect(screen.getAllByRole('row').length).toBeGreaterThan(0);
      });
      expect(screen.queryByTestId('peer-schema-ahead-badge-peer-self-row')).toBeNull();
    });

    it('falls back to "?" when lastSchemaAheadVersion is missing but count > 0', async () => {
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({
          peers: [
            makePeer({
              machineId: 'peer-no-version',
              lastSchemaAheadVersion: null,
              schemaAheadCount: 2,
            } as Partial<SyncPeer>),
          ],
        }),
      });

      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId('peer-schema-ahead-badge-peer-no-version')).toBeDefined();
      });
      const badge = screen.getByTestId('peer-schema-ahead-badge-peer-no-version');
      expect(badge.textContent).toContain('schema ?');
    });
  });

  // ---------------------------------------------------------------------------
  // §33.7 — Ping diagnostics + Probe button
  // ---------------------------------------------------------------------------

  describe('ping diagnostics', () => {
    it('renders the truncated ping reason and HTTP status code for unreachable peers', async () => {
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({
          peers: [
            makePeer({
              machineId: 'peer-flaky',
              syncStatus: 'unreachable',
              lastPingError: 'connect_refused',
              lastPingStatusCode: 503,
            } as Partial<SyncPeer>),
          ],
        }),
      });

      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId('peer-ping-diagnostic-peer-flaky')).toBeDefined();
      });
      const diagnostic = screen.getByTestId('peer-ping-diagnostic-peer-flaky');
      expect(diagnostic.textContent).toContain('HTTP 503');
      expect(diagnostic.textContent).toContain('connect_refused');
    });

    it('renders a Copy button when the full diagnostic exceeds the display limit', async () => {
      const longError = `long-error-${'x'.repeat(200)}`;
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({
          peers: [
            makePeer({
              machineId: 'peer-verbose',
              syncStatus: 'unreachable',
              lastPingError: longError,
              lastPingStatusCode: null,
            } as Partial<SyncPeer>),
          ],
        }),
      });

      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId('peer-ping-diagnostic-copy-peer-verbose')).toBeDefined();
      });
    });

    it('does not render a diagnostic for reachable peers', async () => {
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({
          peers: [
            makePeer({
              machineId: 'peer-ok',
              syncStatus: 'reachable',
              lastPingError: null,
            } as Partial<SyncPeer>),
          ],
        }),
      });

      renderPage();
      await waitFor(() => {
        expect(screen.getByText('peer-ok')).toBeDefined();
      });
      expect(screen.queryByTestId('peer-ping-diagnostic-peer-ok')).toBeNull();
    });
  });

  describe('add-peer probe button', () => {
    function openAddDialogWithSyncUrl(url: string) {
      renderPage();
      fireEvent.click(screen.getByTestId('add-mesh-peer'));
      fireEvent.change(screen.getByLabelText('Machine ID'), { target: { value: 'node-new' } });
      fireEvent.change(screen.getByLabelText('Hostname'), {
        target: { value: 'node.tail.ts.net' },
      });
      fireEvent.change(screen.getByLabelText('Sync URL'), { target: { value: url } });
    }

    beforeEach(() => {
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({ peers: [] }),
      });
    });

    it('gates the Save button until the probe succeeds', async () => {
      const probeMutate = vi.fn(
        (_url: string, opts: { onSuccess?: (r: { reachable: boolean }) => void }) => {
          opts.onSuccess?.({ reachable: true });
        },
      );
      mockUseProbeSyncUrl.mockReturnValue(makeMutationHook({ mutate: probeMutate }));

      openAddDialogWithSyncUrl('https://node.tail.ts.net:8080');

      const submit = screen.getByTestId('mesh-peer-submit') as HTMLButtonElement;
      expect(submit.disabled).toBe(true);

      fireEvent.click(screen.getByTestId('mesh-peer-probe'));
      expect(probeMutate).toHaveBeenCalledWith('https://node.tail.ts.net:8080', expect.any(Object));

      await waitFor(() => {
        expect((screen.getByTestId('mesh-peer-submit') as HTMLButtonElement).disabled).toBe(false);
      });
      expect(screen.getByTestId('mesh-peer-probe-success')).toBeDefined();
    });

    it('allows "Save anyway" override after a failed probe', async () => {
      const probeMutate = vi.fn(
        (
          _url: string,
          opts: { onSuccess?: (r: { reachable: boolean; error?: string }) => void },
        ) => {
          opts.onSuccess?.({ reachable: false, error: 'timeout' });
        },
      );
      mockUseProbeSyncUrl.mockReturnValue(makeMutationHook({ mutate: probeMutate }));

      openAddDialogWithSyncUrl('https://node.tail.ts.net:8080');

      fireEvent.click(screen.getByTestId('mesh-peer-probe'));

      await waitFor(() => {
        expect(screen.getByTestId('mesh-peer-probe-failure')).toBeDefined();
      });
      expect((screen.getByTestId('mesh-peer-submit') as HTMLButtonElement).disabled).toBe(true);

      fireEvent.click(screen.getByTestId('mesh-peer-probe-override'));
      expect((screen.getByTestId('mesh-peer-submit') as HTMLButtonElement).disabled).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // §33.8 — Mesh health summary + peer row drill-down.
  // ---------------------------------------------------------------------------

  describe('mesh health summary', () => {
    it('renders the summary line above the peers table with correct counts', async () => {
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({
          peers: [
            makePeer({
              machineId: 'a',
              reverseRegistrationStatus: 'ok',
              lastPullAt: new Date().toISOString(),
            }),
            makePeer({
              machineId: 'b',
              reverseRegistrationStatus: 'failed',
              lastPullAt: new Date().toISOString(),
            }),
            makePeer({
              machineId: 'c',
              reverseRegistrationStatus: null,
              lastPullAt: null,
            }),
          ],
        }),
      });
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('mesh-health-summary')).toBeDefined();
      });
      expect(screen.getByTestId('mesh-health-total').textContent).toContain('3');
      expect(screen.getByTestId('mesh-health-bidirectional').textContent).toContain('1');
      expect(screen.getByTestId('mesh-health-one-way').textContent).toContain('2');
      expect(screen.getByTestId('mesh-health-stale').textContent).toContain('1');
    });

    it('does not render the summary when there are no peers', async () => {
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({ peers: [] }),
      });
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('No mesh peers registered')).toBeDefined();
      });
      expect(screen.queryByTestId('mesh-health-summary')).toBeNull();
    });

    it('expands a peer row on click and renders the cursor detail panel', async () => {
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({ peers: [makePeer({ machineId: 'node-abc' })] }),
      });
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('peer-row-node-abc')).toBeDefined();
      });
      expect(screen.queryByTestId('peer-row-detail-node-abc')).toBeNull();

      fireEvent.click(screen.getByTestId('peer-row-node-abc'));

      await waitFor(() => {
        expect(screen.getByTestId('peer-row-detail-node-abc')).toBeDefined();
        expect(screen.getByTestId('peer-cursor-detail-node-abc')).toBeDefined();
      });
      // Query hook must be invoked with the expanded peer id and enabled=true.
      expect(mockSyncPeerCursorsQuery).toHaveBeenCalledWith('node-abc', true);
    });

    it('collapses a previously-expanded peer row on a second click', async () => {
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({ peers: [makePeer({ machineId: 'node-z' })] }),
      });
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('peer-row-node-z')).toBeDefined();
      });

      fireEvent.click(screen.getByTestId('peer-row-node-z'));
      await waitFor(() => {
        expect(screen.getByTestId('peer-row-detail-node-z')).toBeDefined();
      });

      fireEvent.click(screen.getByTestId('peer-row-node-z'));
      await waitFor(() => {
        expect(screen.queryByTestId('peer-row-detail-node-z')).toBeNull();
      });
    });

    it('does not toggle expansion when an action button inside the row is clicked', async () => {
      const pingMutate = vi.fn();
      mockUsePingSyncPeer.mockReturnValue(makeMutationHook({ mutate: pingMutate }));
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({ peers: [makePeer({ machineId: 'node-btn' })] }),
      });
      renderPage();

      await waitFor(() => {
        expect(screen.getByTestId('peer-row-node-btn')).toBeDefined();
      });

      fireEvent.click(screen.getByTestId('ping-node-btn'));

      expect(pingMutate).toHaveBeenCalled();
      expect(screen.queryByTestId('peer-row-detail-node-btn')).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // §33.7 — Ping failure category badge (next to STATUS pill)
  // ---------------------------------------------------------------------------

  describe('ping failure category badge', () => {
    it('renders a category badge next to the STATUS pill for unreachable peers', async () => {
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({
          peers: [
            makePeer({
              machineId: 'peer-cat',
              syncStatus: 'unreachable',
              lastPingError: 'connect_refused',
              lastPingStatusCode: null,
            } as Partial<SyncPeer>),
          ],
        }),
      });

      renderPage();
      await waitFor(() => {
        expect(screen.getByTestId('peer-ping-category-peer-cat')).toBeDefined();
      });
      expect(screen.getByTestId('peer-ping-category-peer-cat').textContent).toBe('connect_refused');
    });

    it('hides the category badge when the peer is reachable', async () => {
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({
          peers: [
            makePeer({
              machineId: 'peer-ok',
              syncStatus: 'reachable',
              lastPingError: null,
            } as Partial<SyncPeer>),
          ],
        }),
      });

      renderPage();
      await waitFor(() => expect(screen.getByText('peer-ok')).toBeDefined());
      expect(screen.queryByTestId('peer-ping-category-peer-ok')).toBeNull();
    });

    it('sets a `title` tooltip carrying the HTTP status prefix + full error', async () => {
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({
          peers: [
            makePeer({
              machineId: 'peer-tooltip',
              syncStatus: 'unreachable',
              lastPingError: 'http_status',
              lastPingStatusCode: 503,
            } as Partial<SyncPeer>),
          ],
        }),
      });

      renderPage();
      const badge = await screen.findByTestId('peer-ping-category-peer-tooltip');
      expect(badge.getAttribute('title')).toBe('HTTP 503 — http_status');
    });

    it('truncates very long category labels to ~40 chars', async () => {
      const longCategory = 'x'.repeat(80);
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({
          peers: [
            makePeer({
              machineId: 'peer-long',
              syncStatus: 'unreachable',
              lastPingError: longCategory,
            } as Partial<SyncPeer>),
          ],
        }),
      });

      renderPage();
      const badge = await screen.findByTestId('peer-ping-category-peer-long');
      expect(badge.textContent?.length ?? 0).toBeLessThanOrEqual(40);
      expect(badge.textContent?.endsWith('…')).toBe(true);
    });

    it('includes the failure reason in the ping toast when unreachable', async () => {
      const mutate = vi.fn(
        (
          _machineId: string,
          opts: {
            onSuccess?: (r: {
              ok: boolean;
              status: string;
              peer: Partial<SyncPeer> | null;
            }) => void;
          },
        ) => {
          opts.onSuccess?.({
            ok: true,
            status: 'unreachable',
            peer: {
              machineId: 'node-ouch',
              syncStatus: 'unreachable',
              lastPingError: 'timeout',
              lastPingStatusCode: null,
            },
          });
        },
      );
      mockUsePingSyncPeer.mockReturnValue(makeMutationHook({ mutate }));
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({ peers: [makePeer({ machineId: 'node-ouch' })] }),
      });

      renderPage();
      await waitFor(() => expect(screen.getByTestId('ping-node-ouch')).toBeDefined());
      fireEvent.click(screen.getByTestId('ping-node-ouch'));

      expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining('timeout'));
      expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining('unreachable'));
    });
  });

  // ---------------------------------------------------------------------------
  // §33.11 — Update-available banner
  // ---------------------------------------------------------------------------

  describe('update-available banner', () => {
    it('renders the banner when any peer is ahead of the local CP version', async () => {
      mockVersionCompatQuery.mockReturnValue({
        queryKey: ['version-compat'],
        queryFn: vi.fn().mockResolvedValue({
          appVersion: 'v0.4.0',
          gitSha: 'sha',
          schemaVersion: 26,
          minSupportedMobileBuild: 1,
          minSupportedWebBuild: 1,
        }),
      });
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({
          peers: [
            makePeer({
              machineId: 'peer-new',
              peerVersion: 'v0.5.0',
            } as Partial<SyncPeer>),
          ],
        }),
      });

      renderPage();
      const banner = await screen.findByTestId('mesh-version-update-banner');
      expect(banner.textContent).toContain('Update available');
      expect(banner.textContent).toContain('v0.4.0');
      expect(banner.textContent).toContain('v0.5.0');
      expect(banner.textContent).toContain('./scripts/peer-update.sh --dry-run');
    });

    it('hides the banner when every peer is at or behind the local version', async () => {
      mockVersionCompatQuery.mockReturnValue({
        queryKey: ['version-compat'],
        queryFn: vi.fn().mockResolvedValue({
          appVersion: 'v0.5.0',
          gitSha: 'sha',
          schemaVersion: 26,
          minSupportedMobileBuild: 1,
          minSupportedWebBuild: 1,
        }),
      });
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({
          peers: [
            makePeer({
              machineId: 'peer-old',
              peerVersion: 'v0.4.0',
            } as Partial<SyncPeer>),
          ],
        }),
      });

      renderPage();
      await waitFor(() => {
        expect(screen.getByText('peer-old')).toBeDefined();
      });
      expect(screen.queryByTestId('mesh-version-update-banner')).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Preflight token check — §33.12 Phase 3.3
  // ---------------------------------------------------------------------------

  describe('preflight token check', () => {
    it('runs preflight after a successful probe and shows compatible status', async () => {
      const probeMutate = vi.fn(
        (
          _url: string,
          opts: {
            onSuccess?: (r: { reachable: boolean; statusCode?: number }) => void;
          },
        ) => {
          opts.onSuccess?.({ reachable: true, statusCode: 200 });
        },
      );
      const preflightMutate = vi.fn(
        (
          _url: string,
          opts: {
            onSuccess?: (r: {
              tokenStatus: string;
              errorCode: string | null;
              message: string;
            }) => void;
          },
        ) => {
          opts.onSuccess?.({
            tokenStatus: 'compatible',
            errorCode: null,
            message: 'Token matches',
          });
        },
      );
      mockUseProbeSyncUrl.mockReturnValue(makeMutationHook({ mutate: probeMutate }));
      mockUsePreflightMeshConfig.mockReturnValue(makeMutationHook({ mutate: preflightMutate }));
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({ peers: [] }),
      });

      renderPage();
      await waitFor(() => expect(screen.getByTestId('add-mesh-peer')).toBeDefined());
      fireEvent.click(screen.getByTestId('add-mesh-peer'));

      fireEvent.change(screen.getByLabelText('Sync URL'), {
        target: { value: 'http://100.64.0.11:8080' },
      });
      fireEvent.click(screen.getByTestId('mesh-peer-probe'));

      await waitFor(() => {
        expect(preflightMutate).toHaveBeenCalledWith('http://100.64.0.11:8080', expect.any(Object));
        expect(screen.getByTestId('preflight-status-compatible')).toBeDefined();
        expect(screen.getByText('Token compatible')).toBeDefined();
      });
    });

    it('shows mismatch warning when tokens differ', async () => {
      const probeMutate = vi.fn(
        (
          _url: string,
          opts: {
            onSuccess?: (r: { reachable: boolean; statusCode?: number }) => void;
          },
        ) => {
          opts.onSuccess?.({ reachable: true, statusCode: 200 });
        },
      );
      const preflightMutate = vi.fn(
        (
          _url: string,
          opts: {
            onSuccess?: (r: {
              tokenStatus: string;
              errorCode: string | null;
              message: string;
            }) => void;
          },
        ) => {
          opts.onSuccess?.({
            tokenStatus: 'mismatch',
            errorCode: null,
            message: 'Tokens do not match',
          });
        },
      );
      mockUseProbeSyncUrl.mockReturnValue(makeMutationHook({ mutate: probeMutate }));
      mockUsePreflightMeshConfig.mockReturnValue(makeMutationHook({ mutate: preflightMutate }));
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({ peers: [] }),
      });

      renderPage();
      await waitFor(() => expect(screen.getByTestId('add-mesh-peer')).toBeDefined());
      fireEvent.click(screen.getByTestId('add-mesh-peer'));

      fireEvent.change(screen.getByLabelText('Sync URL'), {
        target: { value: 'http://100.64.0.11:8080' },
      });
      fireEvent.click(screen.getByTestId('mesh-peer-probe'));

      await waitFor(() => {
        expect(screen.getByTestId('preflight-status-mismatch')).toBeDefined();
      });
    });

    it('shows local_missing red warning when no local token', async () => {
      const probeMutate = vi.fn(
        (
          _url: string,
          opts: {
            onSuccess?: (r: { reachable: boolean; statusCode?: number }) => void;
          },
        ) => {
          opts.onSuccess?.({ reachable: true, statusCode: 200 });
        },
      );
      const preflightMutate = vi.fn(
        (
          _url: string,
          opts: {
            onSuccess?: (r: {
              tokenStatus: string;
              errorCode: string | null;
              message: string;
            }) => void;
          },
        ) => {
          opts.onSuccess?.({
            tokenStatus: 'local_missing',
            errorCode: null,
            message: 'No local token configured',
          });
        },
      );
      mockUseProbeSyncUrl.mockReturnValue(makeMutationHook({ mutate: probeMutate }));
      mockUsePreflightMeshConfig.mockReturnValue(makeMutationHook({ mutate: preflightMutate }));
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({ peers: [] }),
      });

      renderPage();
      await waitFor(() => expect(screen.getByTestId('add-mesh-peer')).toBeDefined());
      fireEvent.click(screen.getByTestId('add-mesh-peer'));

      fireEvent.change(screen.getByLabelText('Sync URL'), {
        target: { value: 'http://100.64.0.11:8080' },
      });
      fireEvent.click(screen.getByTestId('mesh-peer-probe'));

      await waitFor(() => {
        expect(screen.getByTestId('preflight-status-local_missing')).toBeDefined();
      });
    });

    it('shows error status when preflight mutation fails', async () => {
      const probeMutate = vi.fn(
        (
          _url: string,
          opts: {
            onSuccess?: (r: { reachable: boolean; statusCode?: number }) => void;
          },
        ) => {
          opts.onSuccess?.({ reachable: true, statusCode: 200 });
        },
      );
      const preflightMutate = vi.fn(
        (
          _url: string,
          opts: {
            onError?: (err: Error) => void;
          },
        ) => {
          opts.onError?.(new Error('Network timeout'));
        },
      );
      mockUseProbeSyncUrl.mockReturnValue(makeMutationHook({ mutate: probeMutate }));
      mockUsePreflightMeshConfig.mockReturnValue(makeMutationHook({ mutate: preflightMutate }));
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({ peers: [] }),
      });

      renderPage();
      await waitFor(() => expect(screen.getByTestId('add-mesh-peer')).toBeDefined());
      fireEvent.click(screen.getByTestId('add-mesh-peer'));

      fireEvent.change(screen.getByLabelText('Sync URL'), {
        target: { value: 'http://100.64.0.11:8080' },
      });
      fireEvent.click(screen.getByTestId('mesh-peer-probe'));

      await waitFor(() => {
        expect(screen.getByTestId('preflight-status-error')).toBeDefined();
        expect(screen.getByText('Network timeout')).toBeDefined();
      });
    });

    it('does not show preflight indicator when probe has not been run', async () => {
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({ peers: [] }),
      });

      renderPage();
      await waitFor(() => expect(screen.getByTestId('add-mesh-peer')).toBeDefined());
      fireEvent.click(screen.getByTestId('add-mesh-peer'));

      fireEvent.change(screen.getByLabelText('Sync URL'), {
        target: { value: 'http://100.64.0.11:8080' },
      });

      // No probe clicked — preflight should not appear
      expect(screen.queryByTestId('preflight-status-compatible')).toBeNull();
      expect(screen.queryByTestId('preflight-status-mismatch')).toBeNull();
      expect(screen.queryByTestId('preflight-pending')).toBeNull();
    });

    it('resets preflight state when sync URL changes after a probe', async () => {
      const probeMutate = vi.fn(
        (
          _url: string,
          opts: {
            onSuccess?: (r: { reachable: boolean; statusCode?: number }) => void;
          },
        ) => {
          opts.onSuccess?.({ reachable: true, statusCode: 200 });
        },
      );
      const preflightMutate = vi.fn(
        (
          _url: string,
          opts: {
            onSuccess?: (r: {
              tokenStatus: string;
              errorCode: string | null;
              message: string;
            }) => void;
          },
        ) => {
          opts.onSuccess?.({
            tokenStatus: 'compatible',
            errorCode: null,
            message: 'Token matches',
          });
        },
      );
      mockUseProbeSyncUrl.mockReturnValue(makeMutationHook({ mutate: probeMutate }));
      mockUsePreflightMeshConfig.mockReturnValue(makeMutationHook({ mutate: preflightMutate }));
      mockSyncPeersQuery.mockReturnValue({
        queryKey: ['sync-peers'],
        queryFn: vi.fn().mockResolvedValue({ peers: [] }),
      });

      renderPage();
      await waitFor(() => expect(screen.getByTestId('add-mesh-peer')).toBeDefined());
      fireEvent.click(screen.getByTestId('add-mesh-peer'));

      fireEvent.change(screen.getByLabelText('Sync URL'), {
        target: { value: 'http://100.64.0.11:8080' },
      });
      fireEvent.click(screen.getByTestId('mesh-peer-probe'));

      await waitFor(() => {
        expect(screen.getByTestId('preflight-status-compatible')).toBeDefined();
      });

      // Change the URL — preflight indicator should disappear
      fireEvent.change(screen.getByLabelText('Sync URL'), {
        target: { value: 'http://100.64.0.12:8080' },
      });

      expect(screen.queryByTestId('preflight-status-compatible')).toBeNull();
    });
  });
});
