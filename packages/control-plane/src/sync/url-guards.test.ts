import { describe, expect, it } from 'vitest';

import { isAllowedPeerTarget, stripTrailingSlashes } from './url-guards.js';

describe('stripTrailingSlashes', () => {
  it('removes a single trailing slash', () => {
    expect(stripTrailingSlashes('http://host:8080/')).toBe('http://host:8080');
  });

  it('removes multiple trailing slashes', () => {
    expect(stripTrailingSlashes('http://host:8080///')).toBe('http://host:8080');
  });

  it('returns the same string when no trailing slash', () => {
    expect(stripTrailingSlashes('http://host:8080')).toBe('http://host:8080');
  });

  it('handles an empty string', () => {
    expect(stripTrailingSlashes('')).toBe('');
  });

  it('handles a string of only slashes', () => {
    expect(stripTrailingSlashes('///')).toBe('');
  });

  it('preserves slashes in path segments', () => {
    expect(stripTrailingSlashes('http://host:8080/api/sync/')).toBe('http://host:8080/api/sync');
  });
});

describe('isAllowedPeerTarget', () => {
  it('allows localhost', () => {
    expect(isAllowedPeerTarget('localhost')).toBe(true);
  });

  it('allows 127.0.0.1', () => {
    expect(isAllowedPeerTarget('127.0.0.1')).toBe(true);
  });

  it('allows Tailscale CGNAT lower bound (100.64.0.0)', () => {
    expect(isAllowedPeerTarget('100.64.0.0')).toBe(true);
  });

  it('allows Tailscale CGNAT upper bound (100.127.255.255)', () => {
    expect(isAllowedPeerTarget('100.127.255.255')).toBe(true);
  });

  it('allows mid-range Tailscale IP (100.100.50.25)', () => {
    expect(isAllowedPeerTarget('100.100.50.25')).toBe(true);
  });

  it('rejects IPs outside CGNAT first octet', () => {
    expect(isAllowedPeerTarget('192.168.1.1')).toBe(false);
  });

  it('rejects IPs below CGNAT second-octet lower bound', () => {
    expect(isAllowedPeerTarget('100.63.0.1')).toBe(false);
  });

  it('rejects IPs above CGNAT second-octet upper bound', () => {
    expect(isAllowedPeerTarget('100.128.0.1')).toBe(false);
  });

  it('rejects DNS hostnames', () => {
    expect(isAllowedPeerTarget('evil.example.com')).toBe(false);
  });

  it('rejects IPv6-style strings', () => {
    expect(isAllowedPeerTarget('::1')).toBe(false);
  });

  it('rejects octets above 255', () => {
    expect(isAllowedPeerTarget('100.64.256.1')).toBe(false);
  });

  it('rejects negative octets', () => {
    expect(isAllowedPeerTarget('100.64.-1.1')).toBe(false);
  });

  it('rejects non-numeric octets', () => {
    expect(isAllowedPeerTarget('100.64.abc.1')).toBe(false);
  });

  it('rejects too few octets', () => {
    expect(isAllowedPeerTarget('100.64.0')).toBe(false);
  });

  it('rejects too many octets', () => {
    expect(isAllowedPeerTarget('100.64.0.1.2')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isAllowedPeerTarget('')).toBe(false);
  });
});
