import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  performReverseRegistration,
  type ReverseRegistrationOptions,
  truncateReverseRegistrationError,
} from './peer-reverse-registration.js';

// Mock the signing/payload dependencies so tests don't need real Ed25519 keys.
vi.mock('@agentctl/shared', () => ({
  signDispatchPayload: vi.fn(() => 'mock-signature'),
}));
vi.mock('./peer-registration.js', () => ({
  createPeerRegistrationPayload: vi.fn(() => 'mock-payload'),
  PEER_REGISTRATION_AGENT_ID: 'peer-registration',
}));

// Use a Tailscale CGNAT IP for all test targets (SSRF guard blocks arbitrary hostnames)
const TAILSCALE_PEER_URL = 'http://100.64.0.10:8080';

afterEach(() => {
  vi.restoreAllMocks();
});

function makeOpts(overrides?: Partial<ReverseRegistrationOptions>): ReverseRegistrationOptions {
  return {
    targetSyncUrl: TAILSCALE_PEER_URL,
    self: {
      machineId: 'machine-a',
      hostname: 'host-a',
      tailscaleIp: '100.64.0.1',
      syncUrl: 'http://100.64.0.1:8080',
      publicKey: 'pk-a',
    },
    signingSecretKey: 'sk-a',
    registrationToken: 'shared-token',
    ...overrides,
  };
}

function mockResponse(status: number, body: string, statusText = ''): Response {
  return new Response(body, { status, statusText });
}

describe('performReverseRegistration', () => {
  it('returns ok with null error fields on 200', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse(200, ''));
    const result = await performReverseRegistration(makeOpts({ fetchImpl }));
    expect(result).toEqual({
      status: 'ok',
      error: null,
      errorCode: null,
      httpStatus: null,
    });
  });

  it('extracts errorCode from JSON response body on failure', async () => {
    const body = JSON.stringify({ error: 'TOKEN_MISMATCH', message: 'Token does not match' });
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse(403, body, 'Forbidden'));
    const result = await performReverseRegistration(makeOpts({ fetchImpl }));
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('TOKEN_MISMATCH');
    expect(result.httpStatus).toBe(403);
    expect(result.error).toContain('HTTP 403');
  });

  it('returns null errorCode when response body is not JSON', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(mockResponse(500, 'Internal Server Error', 'Internal Server Error'));
    const result = await performReverseRegistration(makeOpts({ fetchImpl }));
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBeNull();
    expect(result.httpStatus).toBe(500);
    expect(result.error).toContain('HTTP 500');
  });

  it('returns null errorCode when JSON has no error field', async () => {
    const body = JSON.stringify({ message: 'something went wrong' });
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse(400, body, 'Bad Request'));
    const result = await performReverseRegistration(makeOpts({ fetchImpl }));
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBeNull();
    expect(result.httpStatus).toBe(400);
  });

  it('returns NETWORK_ERROR errorCode on fetch exception', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));
    const result = await performReverseRegistration(makeOpts({ fetchImpl }));
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('NETWORK_ERROR');
    expect(result.httpStatus).toBeNull();
    expect(result.error).toContain('ECONNREFUSED');
  });

  it('returns NETWORK_ERROR on timeout (AbortError)', async () => {
    const err = new DOMException('The operation was aborted', 'AbortError');
    const fetchImpl = vi.fn().mockRejectedValue(err);
    const result = await performReverseRegistration(makeOpts({ fetchImpl }));
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('NETWORK_ERROR');
    expect(result.httpStatus).toBeNull();
  });

  it('extracts SIGNATURE_INVALID error code', async () => {
    const body = JSON.stringify({
      error: 'SIGNATURE_INVALID',
      message: 'Ed25519 signature verification failed',
    });
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse(401, body, 'Unauthorized'));
    const result = await performReverseRegistration(makeOpts({ fetchImpl }));
    expect(result.errorCode).toBe('SIGNATURE_INVALID');
    expect(result.httpStatus).toBe(401);
  });

  it('logs errorCode in the warn call on HTTP failure', async () => {
    const body = JSON.stringify({ error: 'TOKEN_MISMATCH' });
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse(403, body, 'Forbidden'));
    const logger = { warn: vi.fn(), debug: vi.fn() };
    await performReverseRegistration(makeOpts({ fetchImpl, logger }));
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'TOKEN_MISMATCH', status: 403 }),
      expect.any(String),
    );
  });

  it('blocks non-Tailscale hostnames (SSRF guard)', async () => {
    const fetchImpl = vi.fn();
    const result = await performReverseRegistration(
      makeOpts({ targetSyncUrl: 'http://evil.example.com:8080', fetchImpl }),
    );
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('INVALID_TARGET');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('blocks private IPs outside CGNAT (SSRF guard)', async () => {
    const fetchImpl = vi.fn();
    const result = await performReverseRegistration(
      makeOpts({ targetSyncUrl: 'http://192.168.1.1:8080', fetchImpl }),
    );
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('INVALID_TARGET');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('allows localhost target', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse(200, ''));
    const result = await performReverseRegistration(
      makeOpts({ targetSyncUrl: 'http://localhost:8080', fetchImpl }),
    );
    expect(result.status).toBe('ok');
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('returns INVALID_TARGET for malformed URLs', async () => {
    const fetchImpl = vi.fn();
    const result = await performReverseRegistration(
      makeOpts({ targetSyncUrl: 'not-a-url', fetchImpl }),
    );
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('INVALID_TARGET');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('truncateReverseRegistrationError', () => {
  it('redacts long token-like strings', () => {
    const input = 'Token abcdefghijklmnopqrstuvwxyz123 is invalid';
    expect(truncateReverseRegistrationError(input)).toBe('Token [redacted] is invalid');
  });

  it('truncates strings exceeding 512 chars', () => {
    // Use a pattern that won't be redacted (mix of words + spaces to avoid 24+ alphanum match)
    const long = Array.from({ length: 120 }, (_, i) => `err${i}`).join(' ');
    expect(long.length).toBeGreaterThan(512);
    const result = truncateReverseRegistrationError(long);
    expect(result.length).toBe(512);
    expect(result.endsWith('…')).toBe(true);
  });
});
