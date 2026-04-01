import { describe, expect, it } from 'vitest';

import { parseTailscalePeers } from './peer-discovery.js';

const SAMPLE_STATUS = {
  Self: {
    TailscaleIPs: ['100.64.0.1'],
    HostName: 'youhane-lori',
    Online: true,
    Tags: ['tag:mesh-node'],
  },
  Peer: {
    'nodekey:abc': {
      TailscaleIPs: ['100.64.0.2'],
      HostName: 'ec2-worker',
      Online: true,
      Tags: ['tag:mesh-node'],
    },
    'nodekey:def': {
      TailscaleIPs: ['100.64.0.3'],
      HostName: 'mac-mini',
      Online: true,
      Tags: ['tag:worker'],
    },
    'nodekey:ghi': {
      TailscaleIPs: ['100.64.0.4'],
      HostName: 'laptop',
      Online: false,
      Tags: ['tag:mesh-node'],
    },
  },
};

describe('parseTailscalePeers', () => {
  it('extracts only online peers with tag:mesh-node', () => {
    const peers = parseTailscalePeers(SAMPLE_STATUS);

    expect(peers).toHaveLength(1);
    expect(peers[0]).toEqual({ hostname: 'ec2-worker', tailscaleIp: '100.64.0.2' });
  });

  it('excludes non-mesh-node tags', () => {
    const peers = parseTailscalePeers(SAMPLE_STATUS);

    expect(peers.find((peer) => peer.hostname === 'mac-mini')).toBeUndefined();
  });

  it('excludes offline peers', () => {
    const peers = parseTailscalePeers(SAMPLE_STATUS);

    expect(peers.find((peer) => peer.hostname === 'laptop')).toBeUndefined();
  });

  it('returns empty for no peers', () => {
    expect(
      parseTailscalePeers({ Self: { TailscaleIPs: [], HostName: 'x', Online: true }, Peer: {} }),
    ).toEqual([]);
  });
});
