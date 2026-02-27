import { describe, expect, it } from 'vitest';
import { AgentError } from '../types/errors.js';
import {
  computeSharedSecret,
  decryptBox,
  decryptSecretBox,
  encryptBox,
  encryptSecretBox,
} from './encryption.js';
import { generateKeyPair } from './keypair.js';

describe('encryptBox / decryptBox', () => {
  it('roundtrips a message with generated keypairs', () => {
    const sender = generateKeyPair();
    const receiver = generateKeyPair();
    const plaintext = 'Hello, encrypted world!';

    const encrypted = encryptBox(plaintext, receiver.publicKey, sender.secretKey);
    const decrypted = decryptBox(encrypted, sender.publicKey, receiver.secretKey);

    expect(decrypted).toBe(plaintext);
  });

  it('handles empty string messages', () => {
    const sender = generateKeyPair();
    const receiver = generateKeyPair();
    const plaintext = '';

    const encrypted = encryptBox(plaintext, receiver.publicKey, sender.secretKey);
    const decrypted = decryptBox(encrypted, sender.publicKey, receiver.secretKey);

    expect(decrypted).toBe(plaintext);
  });

  it('handles unicode messages', () => {
    const sender = generateKeyPair();
    const receiver = generateKeyPair();
    const plaintext = 'Emoji test: \u{1F680}\u{1F30D}\u{1F525} and CJK: \u4F60\u597D\u4E16\u754C';

    const encrypted = encryptBox(plaintext, receiver.publicKey, sender.secretKey);
    const decrypted = decryptBox(encrypted, sender.publicKey, receiver.secretKey);

    expect(decrypted).toBe(plaintext);
  });
});

describe('decryptBox error cases', () => {
  it('throws DECRYPT_FAILED with wrong key', () => {
    const sender = generateKeyPair();
    const receiver = generateKeyPair();
    const wrongReceiver = generateKeyPair();
    const plaintext = 'Secret message';

    const encrypted = encryptBox(plaintext, receiver.publicKey, sender.secretKey);

    try {
      decryptBox(encrypted, sender.publicKey, wrongReceiver.secretKey);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe('DECRYPT_FAILED');
    }
  });

  it('throws DECRYPT_FAILED with truncated message', () => {
    const sender = generateKeyPair();
    const receiver = generateKeyPair();

    // Create a valid base64 string that decodes to fewer bytes than nonce + overhead
    // nacl.box.nonceLength is 24, overheadLength is 16, so we need < 40 bytes
    const tooShort = new Uint8Array(10);
    const truncated = Buffer.from(tooShort).toString('base64');

    try {
      decryptBox(truncated, sender.publicKey, receiver.secretKey);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe('DECRYPT_FAILED');
    }
  });
});

describe('encryptSecretBox / decryptSecretBox', () => {
  it('roundtrips a message with a shared secret', () => {
    const sender = generateKeyPair();
    const receiver = generateKeyPair();
    const sharedSecret = computeSharedSecret(receiver.publicKey, sender.secretKey);
    const plaintext = 'Symmetric encryption works!';

    const encrypted = encryptSecretBox(plaintext, sharedSecret);
    const decrypted = decryptSecretBox(encrypted, sharedSecret);

    expect(decrypted).toBe(plaintext);
  });

  it('throws DECRYPT_FAILED with wrong key', () => {
    const sender = generateKeyPair();
    const receiver = generateKeyPair();
    const wrongPair = generateKeyPair();
    const sharedSecret = computeSharedSecret(receiver.publicKey, sender.secretKey);
    const wrongSecret = computeSharedSecret(wrongPair.publicKey, sender.secretKey);
    const plaintext = 'Symmetric encryption works!';

    const encrypted = encryptSecretBox(plaintext, sharedSecret);

    try {
      decryptSecretBox(encrypted, wrongSecret);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe('DECRYPT_FAILED');
    }
  });
});

describe('computeSharedSecret', () => {
  it('returns consistent results for same keypair combination', () => {
    const alice = generateKeyPair();
    const bob = generateKeyPair();

    const secret1 = computeSharedSecret(bob.publicKey, alice.secretKey);
    const secret2 = computeSharedSecret(bob.publicKey, alice.secretKey);

    expect(secret1).toBe(secret2);
  });

  it('is symmetric: A->B equals B->A', () => {
    const alice = generateKeyPair();
    const bob = generateKeyPair();

    const secretAB = computeSharedSecret(bob.publicKey, alice.secretKey);
    const secretBA = computeSharedSecret(alice.publicKey, bob.secretKey);

    expect(secretAB).toBe(secretBA);
  });
});
