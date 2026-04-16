import { describe, expect, it } from 'vitest';

import { describeReverseRegistrationError } from './mesh-errors';

describe('describeReverseRegistrationError', () => {
  it('maps PEER_REGISTRATION_DISABLED', () => {
    const result = describeReverseRegistrationError('PEER_REGISTRATION_DISABLED', null);
    expect(result.title).toBe('Remote has no registration token');
    expect(result.action).toContain('configure a token');
  });

  it('maps PEER_REGISTRATION_TOKEN_INVALID', () => {
    const result = describeReverseRegistrationError('PEER_REGISTRATION_TOKEN_INVALID', null);
    expect(result.title).toBe('Token mismatch');
    expect(result.action).toContain("don't match");
  });

  it('maps PEER_REGISTRATION_TOKEN_MISSING', () => {
    const result = describeReverseRegistrationError('PEER_REGISTRATION_TOKEN_MISSING', null);
    expect(result.title).toBe('No token configured locally');
    expect(result.action).toContain('Set a registration token');
  });

  it('maps INVALID_SYNC_URL and interpolates syncUrl', () => {
    const result = describeReverseRegistrationError('INVALID_SYNC_URL', null, {
      syncUrl: 'http://100.64.0.1:8080',
    });
    expect(result.title).toBe('Sync URL not reachable from remote');
    expect(result.action).toContain('http://100.64.0.1:8080');
  });

  it('maps INVALID_SYNC_URL with unknown syncUrl when not provided', () => {
    const result = describeReverseRegistrationError('INVALID_SYNC_URL', null);
    expect(result.action).toContain('unknown');
  });

  it('maps PEER_REGISTRATION_INVALID_SIGNATURE', () => {
    const result = describeReverseRegistrationError('PEER_REGISTRATION_INVALID_SIGNATURE', null);
    expect(result.title).toBe('Signature verification failed');
    expect(result.action).toContain('clock skew');
  });

  it('maps NETWORK_ERROR', () => {
    const result = describeReverseRegistrationError('NETWORK_ERROR', null);
    expect(result.title).toBe('Peer unreachable');
    expect(result.action).toContain('Tailscale');
  });

  it('maps REVERSE_REGISTRATION_DISABLED', () => {
    const result = describeReverseRegistrationError('REVERSE_REGISTRATION_DISABLED', null);
    expect(result.title).toBe('Remote disabled reverse registration');
    expect(result.action).toContain('manually');
  });

  it('falls back to generic message for unknown error code', () => {
    const result = describeReverseRegistrationError('UNKNOWN_CODE', 'some raw error message');
    expect(result.title).toBe('Reverse registration failed');
    expect(result.action).toBe('some raw error message');
  });

  it('falls back to generic message when errorCode is null', () => {
    const result = describeReverseRegistrationError(null, 'HTTP 500 Internal Server Error');
    expect(result.title).toBe('Reverse registration failed');
    expect(result.action).toBe('HTTP 500 Internal Server Error');
  });

  it('shows "Check logs" when both errorCode and errorMessage are null', () => {
    const result = describeReverseRegistrationError(null, null);
    expect(result.title).toBe('Reverse registration failed');
    expect(result.action).toBe('Check logs for details.');
  });

  it('falls back when errorCode is undefined', () => {
    const result = describeReverseRegistrationError(undefined, undefined);
    expect(result.title).toBe('Reverse registration failed');
    expect(result.action).toBe('Check logs for details.');
  });
});
