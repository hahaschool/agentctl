import { describe, expect, it } from 'vitest';

import {
  computeNextInterval,
  EMPTY_PEER_VERSION_INFO,
  extractPeerVersionInfo,
  readPeerVersionInfo,
} from './peer-health.js';

describe('computeNextInterval', () => {
  it('keeps default on reachable', () => {
    expect(computeNextInterval(30000, 'reachable')).toBe(30000);
  });

  it('doubles on unreachable (capped at 300000)', () => {
    expect(computeNextInterval(30000, 'unreachable')).toBe(60000);
    expect(computeNextInterval(150000, 'unreachable')).toBe(300000);
    expect(computeNextInterval(300000, 'unreachable')).toBe(300000);
  });

  it('resets on reachable after backoff', () => {
    expect(computeNextInterval(120000, 'reachable')).toBe(30000);
  });
});

describe('extractPeerVersionInfo', () => {
  it('pulls well-typed appVersion / gitSha / schemaVersion', () => {
    expect(
      extractPeerVersionInfo({
        status: 'ok',
        appVersion: '0.4.0',
        gitSha: 'abc1234',
        schemaVersion: 24,
      }),
    ).toEqual({ appVersion: '0.4.0', gitSha: 'abc1234', schemaVersion: 24 });
  });

  it('returns empty info for missing fields (older peer)', () => {
    expect(extractPeerVersionInfo({ status: 'ok' })).toEqual(EMPTY_PEER_VERSION_INFO);
  });

  it('rejects wrongly-typed fields defensively', () => {
    expect(
      extractPeerVersionInfo({
        appVersion: 123,
        gitSha: null,
        schemaVersion: '24',
      }),
    ).toEqual(EMPTY_PEER_VERSION_INFO);
  });

  it('rejects negative or non-integer schemaVersion', () => {
    expect(extractPeerVersionInfo({ schemaVersion: -1 }).schemaVersion).toBeNull();
    expect(extractPeerVersionInfo({ schemaVersion: 1.5 }).schemaVersion).toBeNull();
    expect(extractPeerVersionInfo({ schemaVersion: Number.NaN }).schemaVersion).toBeNull();
  });

  it('rejects empty-string or overlong appVersion / gitSha', () => {
    expect(extractPeerVersionInfo({ appVersion: '', gitSha: '' })).toEqual(EMPTY_PEER_VERSION_INFO);
    expect(extractPeerVersionInfo({ appVersion: 'x'.repeat(129) }).appVersion).toBeNull();
    expect(extractPeerVersionInfo({ gitSha: 'x'.repeat(65) }).gitSha).toBeNull();
  });

  it('returns empty info for non-object input', () => {
    expect(extractPeerVersionInfo(null)).toEqual(EMPTY_PEER_VERSION_INFO);
    expect(extractPeerVersionInfo('not json')).toEqual(EMPTY_PEER_VERSION_INFO);
    expect(extractPeerVersionInfo(42)).toEqual(EMPTY_PEER_VERSION_INFO);
  });
});

describe('readPeerVersionInfo', () => {
  it('extracts version fields from a well-formed JSON body', async () => {
    const response = {
      json: async () => ({ appVersion: '0.4.1', gitSha: 'def5678', schemaVersion: 25 }),
    } as unknown as Response;

    expect(await readPeerVersionInfo(response)).toEqual({
      appVersion: '0.4.1',
      gitSha: 'def5678',
      schemaVersion: 25,
    });
  });

  it('returns empty info when the body is malformed JSON', async () => {
    const response = {
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    } as unknown as Response;

    expect(await readPeerVersionInfo(response)).toEqual(EMPTY_PEER_VERSION_INFO);
  });
});
