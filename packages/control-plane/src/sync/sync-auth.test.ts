import { generateDispatchSigningKeyPair } from '@agentctl/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPeerSignedHeader } from './peer-auth.js';
import { createSyncAuthHook, loadKnownPeers } from './sync-auth.js';

describe('loadKnownPeers', () => {
  it('returns machineId -> publicKey map from sync_nodes', async () => {
    const mockDb = {
      execute: vi.fn().mockResolvedValue({
        rows: [
          { id: 'node-a', public_key: 'key-a' },
          { id: 'node-b', public_key: 'key-b' },
          { id: 'node-c', public_key: null },
        ],
      }),
    };

    const result = await loadKnownPeers(mockDb as never);

    expect(result).toEqual({
      'node-a': 'key-a',
      'node-b': 'key-b',
    });
  });

  it('returns empty map when no peers have public keys', async () => {
    const mockDb = {
      execute: vi.fn().mockResolvedValue({ rows: [] }),
    };

    const result = await loadKnownPeers(mockDb as never);

    expect(result).toEqual({});
  });
});

describe('createSyncAuthHook', () => {
  const keyPair = generateDispatchSigningKeyPair();

  function createMockRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      headers: {},
      method: 'GET',
      url: '/api/sync/changes?since=0&limit=500',
      body: '',
      ...overrides,
    };
  }

  function createMockReply() {
    const reply = {
      statusCode: 200,
      code: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };
    return reply;
  }

  function createMockDb(peers: Array<{ id: string; public_key: string | null }> = []) {
    return {
      execute: vi.fn().mockResolvedValue({ rows: peers }),
    };
  }

  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects requests without X-Sync-Auth header', async () => {
    const db = createMockDb();
    const hook = createSyncAuthHook({ db: db as never, logger: logger as never });
    const request = createMockRequest();
    const reply = createMockReply();

    await hook(request as never, reply as never);

    expect(reply.code).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'SYNC_AUTH_MISSING' }),
    );
  });

  it('rejects requests from unknown peers', async () => {
    const db = createMockDb([]);
    const hook = createSyncAuthHook({ db: db as never, logger: logger as never });

    const header = createPeerSignedHeader(
      'unknown-node',
      'GET',
      '/api/sync/changes',
      '',
      keyPair.secretKey,
    );

    const request = createMockRequest({
      headers: { 'x-sync-auth': header },
    });
    const reply = createMockReply();

    await hook(request as never, reply as never);

    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'SYNC_AUTH_INVALID' }),
    );
  });

  it('accepts valid signed requests and sets x-verified-peer-id header', async () => {
    const db = createMockDb([{ id: 'node-a', public_key: keyPair.publicKey }]);
    const hook = createSyncAuthHook({ db: db as never, logger: logger as never });

    const header = createPeerSignedHeader(
      'node-a',
      'GET',
      '/api/sync/changes',
      '',
      keyPair.secretKey,
    );

    const headers: Record<string, string> = { 'x-sync-auth': header };
    const request = createMockRequest({
      headers,
    });
    const reply = createMockReply();

    await hook(request as never, reply as never);

    expect(reply.code).not.toHaveBeenCalled();
    expect(headers['x-verified-peer-id']).toBe('node-a');
  });

  it('verifies POST requests with body', async () => {
    const db = createMockDb([{ id: 'node-a', public_key: keyPair.publicKey }]);
    const hook = createSyncAuthHook({ db: db as never, logger: logger as never });

    const body = { machineId: 'node-a', cursor: 42 };
    const header = createPeerSignedHeader(
      'node-a',
      'POST',
      '/api/sync/ack',
      body,
      keyPair.secretKey,
    );

    const headers: Record<string, string> = { 'x-sync-auth': header };
    const request = createMockRequest({
      headers,
      method: 'POST',
      url: '/api/sync/ack',
      body,
    });
    const reply = createMockReply();

    await hook(request as never, reply as never);

    expect(reply.code).not.toHaveBeenCalled();
    expect(headers['x-verified-peer-id']).toBe('node-a');
  });
});
