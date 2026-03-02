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

describe('encryptBox / decryptBox — additional coverage', () => {
  it('produces different ciphertext for the same plaintext (random nonce)', () => {
    const sender = generateKeyPair();
    const receiver = generateKeyPair();
    const plaintext = 'Determinism check';

    const encrypted1 = encryptBox(plaintext, receiver.publicKey, sender.secretKey);
    const encrypted2 = encryptBox(plaintext, receiver.publicKey, sender.secretKey);

    expect(encrypted1).not.toBe(encrypted2);
  });

  it('handles long messages', () => {
    const sender = generateKeyPair();
    const receiver = generateKeyPair();
    const plaintext = 'A'.repeat(10_000);

    const encrypted = encryptBox(plaintext, receiver.publicKey, sender.secretKey);
    const decrypted = decryptBox(encrypted, sender.publicKey, receiver.secretKey);

    expect(decrypted).toBe(plaintext);
  });
});

describe('decryptBox — error details', () => {
  it('throws DECRYPT_FAILED with code property when message is too short', () => {
    const sender = generateKeyPair();
    const receiver = generateKeyPair();
    const tooShort = Buffer.from(new Uint8Array(5)).toString('base64');

    try {
      decryptBox(tooShort, sender.publicKey, receiver.secretKey);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      const agentErr = err as AgentError;
      expect(agentErr.code).toBe('DECRYPT_FAILED');
      expect(agentErr.context).toBeDefined();
      expect(agentErr.context?.minLength).toBe(40); // nonceLength(24) + overheadLength(16)
      expect(agentErr.context?.actualLength).toBe(5);
    }
  });

  it('throws DECRYPT_FAILED when keys are corrupted/tampered', () => {
    const sender = generateKeyPair();
    const receiver = generateKeyPair();
    const attacker = generateKeyPair();
    const plaintext = 'Sensitive data';

    const encrypted = encryptBox(plaintext, receiver.publicKey, sender.secretKey);

    // Try to decrypt with attacker's public key as sender
    try {
      decryptBox(encrypted, attacker.publicKey, receiver.secretKey);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe('DECRYPT_FAILED');
      expect((err as AgentError).message).toContain('invalid keys');
    }
  });
});

describe('encryptSecretBox / decryptSecretBox — additional coverage', () => {
  it('roundtrips an empty string', () => {
    const sender = generateKeyPair();
    const receiver = generateKeyPair();
    const sharedSecret = computeSharedSecret(receiver.publicKey, sender.secretKey);

    const encrypted = encryptSecretBox('', sharedSecret);
    const decrypted = decryptSecretBox(encrypted, sharedSecret);

    expect(decrypted).toBe('');
  });

  it('roundtrips unicode messages', () => {
    const sender = generateKeyPair();
    const receiver = generateKeyPair();
    const sharedSecret = computeSharedSecret(receiver.publicKey, sender.secretKey);
    const plaintext = 'Unicode: \u{1F680}\u4F60\u597D\u{1F30D}';

    const encrypted = encryptSecretBox(plaintext, sharedSecret);
    const decrypted = decryptSecretBox(encrypted, sharedSecret);

    expect(decrypted).toBe(plaintext);
  });
});

describe('encryptSecretBox — INVALID_KEY_LENGTH', () => {
  it('throws INVALID_KEY_LENGTH when key is too short', () => {
    const shortKey = Buffer.from(new Uint8Array(16)).toString('base64');

    try {
      encryptSecretBox('test', shortKey);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      const agentErr = err as AgentError;
      expect(agentErr.code).toBe('INVALID_KEY_LENGTH');
      expect(agentErr.context?.expected).toBe(32);
      expect(agentErr.context?.actual).toBe(16);
    }
  });

  it('throws INVALID_KEY_LENGTH when key is too long', () => {
    const longKey = Buffer.from(new Uint8Array(64)).toString('base64');

    try {
      encryptSecretBox('test', longKey);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      const agentErr = err as AgentError;
      expect(agentErr.code).toBe('INVALID_KEY_LENGTH');
      expect(agentErr.context?.expected).toBe(32);
      expect(agentErr.context?.actual).toBe(64);
    }
  });
});

describe('decryptSecretBox — error paths', () => {
  it('throws DECRYPT_FAILED when message is too short', () => {
    const sender = generateKeyPair();
    const receiver = generateKeyPair();
    const sharedSecret = computeSharedSecret(receiver.publicKey, sender.secretKey);
    const tooShort = Buffer.from(new Uint8Array(10)).toString('base64');

    try {
      decryptSecretBox(tooShort, sharedSecret);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      const agentErr = err as AgentError;
      expect(agentErr.code).toBe('DECRYPT_FAILED');
      expect(agentErr.context?.minLength).toBe(40); // nonceLength(24) + overheadLength(16)
      expect(agentErr.context?.actualLength).toBe(10);
    }
  });

  it('throws INVALID_KEY_LENGTH when key is wrong size during decrypt', () => {
    const sender = generateKeyPair();
    const receiver = generateKeyPair();
    const sharedSecret = computeSharedSecret(receiver.publicKey, sender.secretKey);
    const encrypted = encryptSecretBox('test', sharedSecret);
    const wrongSizeKey = Buffer.from(new Uint8Array(16)).toString('base64');

    try {
      decryptSecretBox(encrypted, wrongSizeKey);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      const agentErr = err as AgentError;
      expect(agentErr.code).toBe('INVALID_KEY_LENGTH');
      expect(agentErr.context?.expected).toBe(32);
      expect(agentErr.context?.actual).toBe(16);
    }
  });

  it('throws DECRYPT_FAILED on tampered ciphertext', () => {
    const sender = generateKeyPair();
    const receiver = generateKeyPair();
    const sharedSecret = computeSharedSecret(receiver.publicKey, sender.secretKey);
    const encrypted = encryptSecretBox('original message', sharedSecret);

    // Tamper with the ciphertext by flipping bits
    const bytes = Buffer.from(encrypted, 'base64');
    bytes[bytes.length - 1] ^= 0xff; // flip last byte
    const tampered = bytes.toString('base64');

    try {
      decryptSecretBox(tampered, sharedSecret);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe('DECRYPT_FAILED');
    }
  });

  it('throws DECRYPT_FAILED with wrong shared secret', () => {
    const alice = generateKeyPair();
    const bob = generateKeyPair();
    const charlie = generateKeyPair();
    const correctSecret = computeSharedSecret(bob.publicKey, alice.secretKey);
    const wrongSecret = computeSharedSecret(charlie.publicKey, alice.secretKey);

    const encrypted = encryptSecretBox('secret data', correctSecret);

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

  it('produces different shared secrets for different keypairs', () => {
    const alice = generateKeyPair();
    const bob = generateKeyPair();
    const charlie = generateKeyPair();

    const secretAB = computeSharedSecret(bob.publicKey, alice.secretKey);
    const secretAC = computeSharedSecret(charlie.publicKey, alice.secretKey);

    expect(secretAB).not.toBe(secretAC);
  });

  it('returns a base64 string that decodes to 32 bytes', () => {
    const alice = generateKeyPair();
    const bob = generateKeyPair();

    const secret = computeSharedSecret(bob.publicKey, alice.secretKey);
    const decoded = Buffer.from(secret, 'base64');

    expect(decoded.length).toBe(32);
  });
});

describe('Full E2E flow: keypairs → shared secret → secretbox roundtrip', () => {
  it('generates keypairs, computes shared secret, encrypts and decrypts', () => {
    // Step 1: Both parties generate keypairs
    const alice = generateKeyPair();
    const bob = generateKeyPair();

    // Step 2: Each computes the shared secret from their private key + other's public key
    const aliceShared = computeSharedSecret(bob.publicKey, alice.secretKey);
    const bobShared = computeSharedSecret(alice.publicKey, bob.secretKey);

    // Step 3: Shared secrets must match (DH exchange property)
    expect(aliceShared).toBe(bobShared);

    // Step 4: Alice encrypts with her shared secret
    const plaintext = 'End-to-end encrypted message via DH exchange';
    const encrypted = encryptSecretBox(plaintext, aliceShared);

    // Step 5: Bob decrypts with his (identical) shared secret
    const decrypted = decryptSecretBox(encrypted, bobShared);
    expect(decrypted).toBe(plaintext);
  });

  it('works bidirectionally: both parties can encrypt and decrypt', () => {
    const alice = generateKeyPair();
    const bob = generateKeyPair();
    const sharedSecret = computeSharedSecret(bob.publicKey, alice.secretKey);

    // Alice sends to Bob
    const msgFromAlice = 'Hello Bob!';
    const encFromAlice = encryptSecretBox(msgFromAlice, sharedSecret);
    const decByBob = decryptSecretBox(encFromAlice, sharedSecret);
    expect(decByBob).toBe(msgFromAlice);

    // Bob sends to Alice
    const msgFromBob = 'Hello Alice!';
    const encFromBob = encryptSecretBox(msgFromBob, sharedSecret);
    const decByAlice = decryptSecretBox(encFromBob, sharedSecret);
    expect(decByAlice).toBe(msgFromBob);
  });
});
