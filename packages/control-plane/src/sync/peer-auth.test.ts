import { generateDispatchSigningKeyPair } from '@agentctl/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPeerSignedHeader, verifyPeerSignature } from './peer-auth.js';

describe('peer auth primitives', () => {
  const machineId = 'machine-a';
  const body = { cursor: 42, events: ['x', 'y'] };

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a signed header that verifies against the known peer registry', () => {
    const keyPair = generateDispatchSigningKeyPair();
    const header = createPeerSignedHeader(
      machineId,
      'POST',
      '/api/sync/pull',
      body,
      keyPair.secretKey,
    );

    expect(
      verifyPeerSignature(header, 'POST', '/api/sync/pull', body, {
        [machineId]: keyPair.publicKey,
      }),
    ).toEqual({
      valid: true,
      machineId,
    });
  });

  it('rejects requests when the method, path, or body does not match the signature', () => {
    const keyPair = generateDispatchSigningKeyPair();
    const header = createPeerSignedHeader(
      machineId,
      'POST',
      '/api/sync/pull',
      body,
      keyPair.secretKey,
    );

    expect(
      verifyPeerSignature(header, 'GET', '/api/sync/pull', body, {
        [machineId]: keyPair.publicKey,
      }).valid,
    ).toBe(false);
    expect(
      verifyPeerSignature(header, 'POST', '/api/sync/push', body, {
        [machineId]: keyPair.publicKey,
      }).valid,
    ).toBe(false);
    expect(
      verifyPeerSignature(
        header,
        'POST',
        '/api/sync/pull',
        { cursor: 7 },
        {
          [machineId]: keyPair.publicKey,
        },
      ).valid,
    ).toBe(false);
  });

  it('rejects stale signed headers', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T00:00:00.000Z'));

    const keyPair = generateDispatchSigningKeyPair();
    const header = createPeerSignedHeader(
      machineId,
      'POST',
      '/api/sync/pull',
      body,
      keyPair.secretKey,
    );

    vi.setSystemTime(new Date('2026-04-01T00:01:01.000Z'));

    expect(
      verifyPeerSignature(header, 'POST', '/api/sync/pull', body, {
        [machineId]: keyPair.publicKey,
      }),
    ).toEqual({
      valid: false,
      machineId: null,
    });
  });

  it('rejects replayed nonces within the accepted time window', () => {
    const keyPair = generateDispatchSigningKeyPair();
    const header = createPeerSignedHeader(
      machineId,
      'POST',
      '/api/sync/pull',
      body,
      keyPair.secretKey,
    );
    const knownPeers = { [machineId]: keyPair.publicKey };

    expect(verifyPeerSignature(header, 'POST', '/api/sync/pull', body, knownPeers)).toEqual({
      valid: true,
      machineId,
    });
    expect(verifyPeerSignature(header, 'POST', '/api/sync/pull', body, knownPeers)).toEqual({
      valid: false,
      machineId: null,
    });
  });
});
