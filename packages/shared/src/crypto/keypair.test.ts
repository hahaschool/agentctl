import nacl from 'tweetnacl';
import { describe, expect, it } from 'vitest';
import { AgentError } from '../types/errors.js';
import { decodeKey, encodeKey, generateKeyPair, keyPairFromSeed } from './keypair.js';

describe('generateKeyPair', () => {
  it('returns base64 public and secret keys', () => {
    const kp = generateKeyPair();

    expect(kp).toHaveProperty('publicKey');
    expect(kp).toHaveProperty('secretKey');
    expect(typeof kp.publicKey).toBe('string');
    expect(typeof kp.secretKey).toBe('string');

    // Verify they are valid base64 by decoding without error
    const pubBytes = decodeKey(kp.publicKey);
    const secBytes = decodeKey(kp.secretKey);

    expect(pubBytes.length).toBe(nacl.box.publicKeyLength);
    expect(secBytes.length).toBe(nacl.box.secretKeyLength);
  });
});

describe('keyPairFromSeed', () => {
  it('returns deterministic keypair from valid 32-byte seed', () => {
    const seed = nacl.randomBytes(32);

    const kp1 = keyPairFromSeed(seed);
    const kp2 = keyPairFromSeed(seed);

    expect(kp1.publicKey).toBe(kp2.publicKey);
    expect(kp1.secretKey).toBe(kp2.secretKey);

    // Verify key lengths are correct
    const pubBytes = decodeKey(kp1.publicKey);
    const secBytes = decodeKey(kp1.secretKey);
    expect(pubBytes.length).toBe(nacl.box.publicKeyLength);
    expect(secBytes.length).toBe(nacl.box.secretKeyLength);
  });

  it('throws AgentError with INVALID_SEED_LENGTH for wrong-length seed', () => {
    const shortSeed = new Uint8Array(16);
    const longSeed = new Uint8Array(64);

    try {
      keyPairFromSeed(shortSeed);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe('INVALID_SEED_LENGTH');
    }

    try {
      keyPairFromSeed(longSeed);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe('INVALID_SEED_LENGTH');
    }
  });
});

describe('decodeKey', () => {
  it('returns Uint8Array for valid base64 input', () => {
    const original = nacl.randomBytes(32);
    const encoded = encodeKey(original);

    const decoded = decodeKey(encoded);

    expect(decoded).toBeInstanceOf(Uint8Array);
    expect(decoded.length).toBe(32);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

  it('throws AgentError with INVALID_KEY_ENCODING for invalid base64', () => {
    const invalidBase64 = '!!!not-valid-base64!!!';

    try {
      decodeKey(invalidBase64);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe('INVALID_KEY_ENCODING');
    }
  });
});

describe('encodeKey', () => {
  it('roundtrips with decodeKey', () => {
    const original = nacl.randomBytes(32);

    const encoded = encodeKey(original);
    const decoded = decodeKey(encoded);

    expect(Array.from(decoded)).toEqual(Array.from(original));
  });
});
