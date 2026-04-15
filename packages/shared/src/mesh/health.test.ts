import { describe, expect, it } from 'vitest';

import { MESH_STALE_THRESHOLD_MS, type MeshPeerForHealth, summarizeMeshHealth } from './health.js';

const NOW = Date.parse('2026-04-15T12:00:00.000Z');
const FRESH = new Date(NOW - 60_000).toISOString();
const BORDERLINE = new Date(NOW - MESH_STALE_THRESHOLD_MS).toISOString();
const STALE = new Date(NOW - MESH_STALE_THRESHOLD_MS - 1_000).toISOString();

function makePeer(overrides: Partial<MeshPeerForHealth> = {}): MeshPeerForHealth {
  return {
    isSelf: false,
    reverseRegistrationStatus: 'ok',
    lastPullAt: FRESH,
    ...overrides,
  };
}

describe('summarizeMeshHealth', () => {
  it('returns all-zero counts for an empty peer list', () => {
    expect(summarizeMeshHealth([], NOW)).toEqual({
      total: 0,
      bidirectional: 0,
      oneWay: 0,
      stale: 0,
    });
  });

  it('counts bidirectional + one-way + stale on a mixed fleet', () => {
    const peers: MeshPeerForHealth[] = [
      makePeer({ reverseRegistrationStatus: 'ok', lastPullAt: FRESH }),
      makePeer({ reverseRegistrationStatus: 'ok', lastPullAt: STALE }),
      makePeer({ reverseRegistrationStatus: 'failed', lastPullAt: FRESH }),
      makePeer({ reverseRegistrationStatus: null, lastPullAt: null }),
      makePeer({ reverseRegistrationStatus: 'pending', lastPullAt: FRESH }),
    ];

    expect(summarizeMeshHealth(peers, NOW)).toEqual({
      total: 5,
      bidirectional: 2,
      oneWay: 3,
      stale: 2,
    });
  });

  it('reports every peer as bidirectional when reverse registration is ok across the fleet', () => {
    const peers = [
      makePeer({ reverseRegistrationStatus: 'ok' }),
      makePeer({ reverseRegistrationStatus: 'ok' }),
      makePeer({ reverseRegistrationStatus: 'ok' }),
    ];
    const summary = summarizeMeshHealth(peers, NOW);
    expect(summary).toEqual({ total: 3, bidirectional: 3, oneWay: 0, stale: 0 });
  });

  it('reports every peer as stale when lastPullAt is null or beyond the threshold', () => {
    const peers = [
      makePeer({ lastPullAt: null }),
      makePeer({ lastPullAt: STALE }),
      makePeer({ lastPullAt: 'not-a-date' }),
    ];
    const summary = summarizeMeshHealth(peers, NOW);
    expect(summary.total).toBe(3);
    expect(summary.stale).toBe(3);
  });

  it('treats the exact threshold boundary as fresh (not stale)', () => {
    const peers = [makePeer({ lastPullAt: BORDERLINE })];
    expect(summarizeMeshHealth(peers, NOW).stale).toBe(0);
  });

  it('excludes self rows from all counts', () => {
    const peers = [
      makePeer({ isSelf: true, reverseRegistrationStatus: null, lastPullAt: null }),
      makePeer({ reverseRegistrationStatus: 'ok', lastPullAt: FRESH }),
    ];
    expect(summarizeMeshHealth(peers, NOW)).toEqual({
      total: 1,
      bidirectional: 1,
      oneWay: 0,
      stale: 0,
    });
  });

  it('accepts a Date for `now` in addition to an epoch number', () => {
    const peers = [makePeer({ lastPullAt: STALE })];
    const fromEpoch = summarizeMeshHealth(peers, NOW);
    const fromDate = summarizeMeshHealth(peers, new Date(NOW));
    expect(fromDate).toEqual(fromEpoch);
  });
});
