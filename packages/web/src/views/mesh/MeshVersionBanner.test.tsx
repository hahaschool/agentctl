import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SyncPeerWithVersion } from '@/lib/mesh-version';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockVersionCompatQuery } = vi.hoisted(() => ({
  mockVersionCompatQuery: vi.fn(),
}));

vi.mock('@/lib/queries', () => ({
  versionCompatQuery: () => mockVersionCompatQuery(),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// ---------------------------------------------------------------------------
// Component import — AFTER mocks
// ---------------------------------------------------------------------------

import { MeshVersionBanner, pickMaxPeerVersion } from './MeshVersionBanner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePeer(overrides?: Partial<SyncPeerWithVersion>): SyncPeerWithVersion {
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

function renderBanner(peers: readonly SyncPeerWithVersion[]): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MeshVersionBanner peers={peers} />
    </QueryClientProvider>,
  );
}

function mockVersionCompat(data: Record<string, unknown> | null): void {
  mockVersionCompatQuery.mockReturnValue({
    queryKey: ['version-compat'],
    queryFn: vi.fn().mockResolvedValue(
      data ?? {
        appVersion: 'v0.4.0',
        gitSha: 'abc',
        schemaVersion: 26,
        minSupportedMobileBuild: 1,
        minSupportedWebBuild: 1,
      },
    ),
  });
}

// ---------------------------------------------------------------------------
// pickMaxPeerVersion — pure helper
// ---------------------------------------------------------------------------

describe('pickMaxPeerVersion', () => {
  it('returns the highest peer version when it exceeds local', () => {
    const peers = [
      makePeer({ machineId: 'a', peerVersion: 'v0.4.0' }),
      makePeer({ machineId: 'b', peerVersion: 'v0.5.1' }),
      makePeer({ machineId: 'c', peerVersion: 'v0.5.0' }),
    ];
    expect(pickMaxPeerVersion(peers, 'v0.4.0')).toBe('v0.5.1');
  });

  it('returns null when no peer is ahead of local', () => {
    const peers = [
      makePeer({ machineId: 'a', peerVersion: 'v0.4.0' }),
      makePeer({ machineId: 'b', peerVersion: 'v0.3.5' }),
    ];
    expect(pickMaxPeerVersion(peers, 'v0.4.0')).toBeNull();
  });

  it('ignores self peers even if ahead', () => {
    const peers = [
      makePeer({ machineId: 'self', isSelf: true, peerVersion: 'v9.9.9' }),
      makePeer({ machineId: 'b', peerVersion: 'v0.3.0' }),
    ];
    expect(pickMaxPeerVersion(peers, 'v0.4.0')).toBeNull();
  });

  it('ignores peers with missing or unparseable versions', () => {
    const peers = [
      makePeer({ machineId: 'a', peerVersion: null }),
      makePeer({ machineId: 'b', peerVersion: 'not-a-version' }),
      makePeer({ machineId: 'c', peerVersion: 'v0.4.1' }),
    ];
    expect(pickMaxPeerVersion(peers, 'v0.4.0')).toBe('v0.4.1');
  });

  it('returns null when local version is missing', () => {
    const peers = [makePeer({ machineId: 'a', peerVersion: 'v1.0.0' })];
    expect(pickMaxPeerVersion(peers, null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// MeshVersionBanner — component behaviour
// ---------------------------------------------------------------------------

describe('MeshVersionBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the banner when a peer is ahead of local', async () => {
    mockVersionCompat({
      appVersion: 'v0.4.0',
      gitSha: 'abc',
      schemaVersion: 26,
      minSupportedMobileBuild: 1,
      minSupportedWebBuild: 1,
    });
    renderBanner([makePeer({ machineId: 'alpha', peerVersion: 'v0.5.0' })]);
    const banner = await screen.findByTestId('mesh-version-update-banner');
    expect(banner.textContent).toContain('Update available');
    expect(banner.textContent).toContain('v0.4.0');
    expect(banner.textContent).toContain('v0.5.0');
    expect(screen.getByTestId('mesh-version-update-command').textContent).toBe(
      './scripts/peer-update.sh --dry-run',
    );
    expect(
      (screen.getByTestId('mesh-version-update-settings-link') as HTMLAnchorElement).getAttribute(
        'href',
      ),
    ).toBe('/settings');
  });

  it('hides the banner when local matches max peer version', async () => {
    mockVersionCompat({
      appVersion: 'v0.5.0',
      gitSha: 'abc',
      schemaVersion: 26,
      minSupportedMobileBuild: 1,
      minSupportedWebBuild: 1,
    });
    renderBanner([makePeer({ machineId: 'alpha', peerVersion: 'v0.5.0' })]);
    await waitFor(() => {
      expect(screen.queryByTestId('mesh-version-update-banner')).toBeNull();
    });
  });

  it('hides the banner when the version-compat query has no data yet', async () => {
    mockVersionCompatQuery.mockReturnValue({
      queryKey: ['version-compat'],
      queryFn: vi.fn().mockReturnValue(new Promise(() => {})),
    });
    const { container } = renderBanner([makePeer({ machineId: 'alpha', peerVersion: 'v0.5.0' })]);
    expect(container.querySelector('[data-testid="mesh-version-update-banner"]')).toBeNull();
  });

  it('hides the banner when the version-compat query errors', async () => {
    mockVersionCompatQuery.mockReturnValue({
      queryKey: ['version-compat'],
      queryFn: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const { container } = renderBanner([makePeer({ machineId: 'alpha', peerVersion: 'v0.5.0' })]);
    // The query rejects before data arrives → `appVersion` stays undefined →
    // banner must not render at any point.
    await waitFor(() => {
      expect(container.querySelector('[data-testid="mesh-version-update-banner"]')).toBeNull();
    });
  });

  it('hides the banner when no peer has a parseable version', async () => {
    mockVersionCompat({
      appVersion: 'v0.4.0',
      gitSha: 'abc',
      schemaVersion: 26,
      minSupportedMobileBuild: 1,
      minSupportedWebBuild: 1,
    });
    renderBanner([makePeer({ machineId: 'alpha', peerVersion: null })]);
    await waitFor(() => {
      expect(screen.queryByTestId('mesh-version-update-banner')).toBeNull();
    });
  });
});
