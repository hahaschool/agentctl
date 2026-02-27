import nacl from 'tweetnacl';
import util from 'tweetnacl-util';

import { AgentError } from '../types/errors.js';

const { encodeBase64, decodeBase64 } = util;

type KeyPair = {
  publicKey: string; // base64 encoded
  secretKey: string; // base64 encoded
};

/**
 * Generate a new Curve25519 key pair for E2E box encryption.
 * Uses nacl.box.keyPair() which produces cryptographically random keys.
 */
export function generateKeyPair(): KeyPair {
  const kp = nacl.box.keyPair();
  return {
    publicKey: encodeBase64(kp.publicKey),
    secretKey: encodeBase64(kp.secretKey),
  };
}

/**
 * Derive a deterministic key pair from a 32-byte seed.
 * Useful for recovering keys from a stored seed or for testing.
 */
export function keyPairFromSeed(seed: Uint8Array): KeyPair {
  if (seed.length !== nacl.box.secretKeyLength) {
    throw new AgentError(
      'INVALID_SEED_LENGTH',
      `Seed must be exactly ${nacl.box.secretKeyLength} bytes, got ${seed.length}`,
      {
        expected: nacl.box.secretKeyLength,
        actual: seed.length,
      },
    );
  }

  const kp = nacl.box.keyPair.fromSecretKey(seed);
  return {
    publicKey: encodeBase64(kp.publicKey),
    secretKey: encodeBase64(kp.secretKey),
  };
}

/**
 * Decode a base64-encoded key to Uint8Array.
 * Validates that the decoded bytes are a plausible key length.
 */
export function decodeKey(base64Key: string): Uint8Array {
  try {
    return decodeBase64(base64Key);
  } catch {
    throw new AgentError('INVALID_KEY_ENCODING', 'Failed to decode base64 key', {
      keyPreview: base64Key.slice(0, 8) + '...',
    });
  }
}

/**
 * Encode a Uint8Array key to base64 string for transport/storage.
 */
export function encodeKey(key: Uint8Array): string {
  return encodeBase64(key);
}

export type { KeyPair };
