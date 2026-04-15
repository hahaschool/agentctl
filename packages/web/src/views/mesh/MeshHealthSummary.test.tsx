import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { SyncPeer } from '@/lib/api';

import { MeshHealthSummary } from './MeshHealthSummary';

const NOW = Date.parse('2026-04-15T12:00:00.000Z');
const FRESH = new Date(NOW - 60_000).toISOString();
const STALE = new Date(NOW - 11 * 60 * 1000).toISOString();

function makePeer(overrides: Partial<SyncPeer>): SyncPeer {
  return {
    machineId: 'peer-1',
    hostname: 'peer-host',
    tailscaleIp: null,
    syncUrl: 'http://peer:8080',
    role: 'full',
    syncStatus: 'reachable',
    syncIntervalMs: 30_000,
    isSelf: false,
    publicKey: null,
    lastSeen: FRESH,
    createdAt: FRESH,
    reverseRegistrationStatus: 'ok',
    lastPullAt: FRESH,
    lastAckAt: FRESH,
    ...overrides,
  };
}

describe('MeshHealthSummary', () => {
  it('renders all-zero counts for an empty peer list', () => {
    render(<MeshHealthSummary peers={[]} now={NOW} />);
    expect(screen.getByTestId('mesh-health-total').textContent).toContain('0');
    expect(screen.getByTestId('mesh-health-bidirectional').textContent).toContain('0');
    expect(screen.getByTestId('mesh-health-one-way').textContent).toContain('0');
    expect(screen.getByTestId('mesh-health-stale').textContent).toContain('0');
  });

  it('renders counts for a mixed fleet', () => {
    const peers: SyncPeer[] = [
      makePeer({ machineId: 'a', reverseRegistrationStatus: 'ok', lastPullAt: FRESH }),
      makePeer({ machineId: 'b', reverseRegistrationStatus: 'ok', lastPullAt: STALE }),
      makePeer({ machineId: 'c', reverseRegistrationStatus: 'failed', lastPullAt: FRESH }),
      makePeer({ machineId: 'd', reverseRegistrationStatus: null, lastPullAt: null }),
    ];
    render(<MeshHealthSummary peers={peers} now={NOW} />);
    expect(screen.getByTestId('mesh-health-total').textContent).toContain('4');
    expect(screen.getByTestId('mesh-health-bidirectional').textContent).toContain('2');
    expect(screen.getByTestId('mesh-health-one-way').textContent).toContain('2');
    expect(screen.getByTestId('mesh-health-stale').textContent).toContain('2');
  });

  it('excludes self rows from the total', () => {
    const peers: SyncPeer[] = [
      makePeer({ machineId: 'self', isSelf: true }),
      makePeer({ machineId: 'p1', reverseRegistrationStatus: 'ok', lastPullAt: FRESH }),
    ];
    render(<MeshHealthSummary peers={peers} now={NOW} />);
    expect(screen.getByTestId('mesh-health-total').textContent).toContain('1');
    expect(screen.getByTestId('mesh-health-bidirectional').textContent).toContain('1');
  });

  it('labels the total "peer" when there is exactly one peer', () => {
    const peers: SyncPeer[] = [
      makePeer({ machineId: 'solo', reverseRegistrationStatus: 'ok', lastPullAt: FRESH }),
    ];
    render(<MeshHealthSummary peers={peers} now={NOW} />);
    expect(screen.getByTestId('mesh-health-total').textContent).toMatch(/1\s*peer\b/);
  });

  it('exposes the summary to assistive tech via aria-label', () => {
    render(<MeshHealthSummary peers={[]} now={NOW} />);
    expect(screen.getByLabelText('Mesh health summary')).toBeDefined();
  });
});
