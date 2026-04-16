import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DiscoverCandidate, DiscoverSyncPeersResponse } from '@/lib/api';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockDiscoverMutate, mockUpsertMutateAsync } = vi.hoisted(() => ({
  mockDiscoverMutate: vi.fn(),
  mockUpsertMutateAsync: vi.fn(),
}));

vi.mock('@/lib/queries', () => ({
  useDiscoverSyncPeers: () => ({
    mutate: mockDiscoverMutate,
    isPending: false,
  }),
  useUpsertSyncPeer: () => ({
    mutateAsync: mockUpsertMutateAsync,
    isPending: false,
  }),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// ---------------------------------------------------------------------------
// Component import -- AFTER mocks
// ---------------------------------------------------------------------------

import { DiscoverPeersDialog } from './DiscoverPeersDialog';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCandidate(overrides?: Partial<DiscoverCandidate>): DiscoverCandidate {
  return {
    hostname: 'mac-mini',
    tailscaleIp: '100.64.0.10',
    syncUrl: 'http://100.64.0.10:8080',
    reachable: true,
    machineId: 'machine-beta',
    nodePublicKey: 'pubkey-abc',
    appVersion: '0.5.1',
    schemaVersion: 7,
    error: null,
    ...overrides,
  };
}

function renderDialog(open: boolean, onClose?: () => void): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <DiscoverPeersDialog open={open} onClose={onClose ?? vi.fn()} />
    </QueryClientProvider>,
  );
}

/**
 * After rendering, the dialog calls `discoverMutation.mutate(undefined, { onSuccess, onError })`.
 * This helper extracts the stored onSuccess callback and invokes it inside `act()` so
 * React processes the resulting state updates.
 */
function simulateDiscoverSuccess(peers: DiscoverCandidate[], source: 'tailscale' | 'none'): void {
  const callArgs = mockDiscoverMutate.mock.calls[0];
  const onSuccess = callArgs?.[1]?.onSuccess as
    | ((data: DiscoverSyncPeersResponse) => void)
    | undefined;
  expect(onSuccess).toBeDefined();
  act(() => {
    onSuccess?.({ peers, source });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DiscoverPeersDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsertMutateAsync.mockResolvedValue({ ok: true, peer: null });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when closed', () => {
    renderDialog(false);
    expect(screen.queryByTestId('discover-peers-dialog')).toBeNull();
  });

  it('triggers discovery when opened and shows loading state', () => {
    renderDialog(true);
    expect(mockDiscoverMutate).toHaveBeenCalledTimes(1);
    // Dialog should be in loading state
    expect(screen.getByTestId('discover-peers-dialog')).toBeDefined();
  });

  it('shows empty state when no candidates are found', () => {
    renderDialog(true);
    simulateDiscoverSuccess([], 'none');

    expect(screen.getByTestId('discover-empty')).toBeDefined();
    expect(screen.getByText(/No Tailscale mesh-node peers found/)).toBeDefined();
  });

  it('renders discovered candidates with reachability badges', () => {
    renderDialog(true);
    simulateDiscoverSuccess(
      [
        makeCandidate({ hostname: 'reachable-host' }),
        makeCandidate({
          hostname: 'unreachable-host',
          reachable: false,
          machineId: null,
          error: 'timeout',
        }),
      ],
      'tailscale',
    );

    expect(screen.getByTestId('discover-row-reachable-host')).toBeDefined();
    expect(screen.getByTestId('discover-row-unreachable-host')).toBeDefined();
    expect(screen.getByText('Reachable')).toBeDefined();
    expect(screen.getByText('Unreachable')).toBeDefined();
  });

  it('pre-selects reachable candidates by default', () => {
    renderDialog(true);
    simulateDiscoverSuccess(
      [
        makeCandidate({ hostname: 'reachable-host' }),
        makeCandidate({ hostname: 'dead-host', reachable: false, error: 'dns' }),
      ],
      'tailscale',
    );

    const reachableRow = screen.getByTestId('discover-row-reachable-host');
    const checkbox = reachableRow.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    const deadRow = screen.getByTestId('discover-row-dead-host');
    const deadCheckbox = deadRow.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(deadCheckbox.checked).toBe(false);
    expect(deadCheckbox.disabled).toBe(true);
  });

  it('disables the Next button when no candidates are selected', () => {
    renderDialog(true);
    simulateDiscoverSuccess(
      [makeCandidate({ hostname: 'dead', reachable: false, error: 'timeout' })],
      'tailscale',
    );

    const nextBtn = screen.getByTestId('discover-next') as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(true);
  });

  it('advances to confirm step with selected count', () => {
    renderDialog(true);
    simulateDiscoverSuccess(
      [makeCandidate({ hostname: 'peer-a' }), makeCandidate({ hostname: 'peer-b' })],
      'tailscale',
    );

    fireEvent.click(screen.getByTestId('discover-next'));

    expect(screen.getByTestId('discover-confirm')).toBeDefined();
    expect(screen.getByText(/2 peers will be/)).toBeDefined();
  });

  it('shows source label from the discovery response', () => {
    renderDialog(true);
    simulateDiscoverSuccess([makeCandidate()], 'tailscale');

    expect(screen.getByText('tailscale')).toBeDefined();
    expect(screen.getByText(/1 candidate found/)).toBeDefined();
  });

  it('shows the bulk interval input on confirm step', () => {
    renderDialog(true);
    simulateDiscoverSuccess([makeCandidate()], 'tailscale');

    fireEvent.click(screen.getByTestId('discover-next'));

    expect(screen.getByTestId('discover-bulk-interval')).toBeDefined();
  });

  it('navigates back from confirm to select', () => {
    renderDialog(true);
    simulateDiscoverSuccess([makeCandidate()], 'tailscale');

    fireEvent.click(screen.getByTestId('discover-next'));
    expect(screen.getByTestId('discover-confirm')).toBeDefined();

    fireEvent.click(screen.getByText('Back'));
    expect(screen.getByTestId('discover-next')).toBeDefined();
  });
});
