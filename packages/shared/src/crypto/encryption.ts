import nacl from 'tweetnacl';
import util from 'tweetnacl-util';

import { AgentError } from '../types/errors.js';

const { encodeBase64, decodeBase64, decodeUTF8, encodeUTF8 } = util;

/**
 * Encrypt a message using NaCl box (asymmetric: sender secret key + receiver public key).
 * A random nonce is generated and prepended to the ciphertext before base64 encoding.
 *
 * @param message - Plaintext string to encrypt
 * @param receiverPublicKey - Receiver's public key (base64)
 * @param senderSecretKey - Sender's secret key (base64)
 * @returns Base64-encoded string with nonce prepended to ciphertext
 */
export function encryptBox(
  message: string,
  receiverPublicKey: string,
  senderSecretKey: string,
): string {
  const messageBytes = decodeUTF8(message);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const receiverPk = decodeBase64(receiverPublicKey);
  const senderSk = decodeBase64(senderSecretKey);

  const encrypted = nacl.box(messageBytes, nonce, receiverPk, senderSk);

  // Prepend nonce to ciphertext so the receiver can extract it
  const fullMessage = new Uint8Array(nonce.length + encrypted.length);
  fullMessage.set(nonce);
  fullMessage.set(encrypted, nonce.length);

  return encodeBase64(fullMessage);
}

/**
 * Decrypt a message encrypted with NaCl box (asymmetric).
 * Expects the nonce to be prepended to the ciphertext in the base64 payload.
 *
 * @param encryptedMessage - Base64-encoded string (nonce + ciphertext)
 * @param senderPublicKey - Sender's public key (base64)
 * @param receiverSecretKey - Receiver's secret key (base64)
 * @returns Decrypted plaintext string
 * @throws AgentError with code DECRYPT_FAILED if decryption fails
 */
export function decryptBox(
  encryptedMessage: string,
  senderPublicKey: string,
  receiverSecretKey: string,
): string {
  const fullMessage = decodeBase64(encryptedMessage);

  if (fullMessage.length < nacl.box.nonceLength + nacl.box.overheadLength) {
    throw new AgentError('DECRYPT_FAILED', 'Encrypted message is too short to contain nonce and ciphertext', {
      minLength: nacl.box.nonceLength + nacl.box.overheadLength,
      actualLength: fullMessage.length,
    });
  }

  const nonce = fullMessage.slice(0, nacl.box.nonceLength);
  const ciphertext = fullMessage.slice(nacl.box.nonceLength);
  const senderPk = decodeBase64(senderPublicKey);
  const receiverSk = decodeBase64(receiverSecretKey);

  const decrypted = nacl.box.open(ciphertext, nonce, senderPk, receiverSk);

  if (decrypted === null) {
    throw new AgentError('DECRYPT_FAILED', 'Box decryption failed — invalid keys, corrupted data, or tampered message');
  }

  return encodeUTF8(decrypted);
}

/**
 * Encrypt a message using NaCl secretbox (symmetric: shared secret).
 * A random nonce is generated and prepended to the ciphertext before base64 encoding.
 *
 * @param message - Plaintext string to encrypt
 * @param sharedSecret - 32-byte shared secret (base64)
 * @returns Base64-encoded string with nonce prepended to ciphertext
 */
export function encryptSecretBox(
  message: string,
  sharedSecret: string,
): string {
  const messageBytes = decodeUTF8(message);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const key = decodeBase64(sharedSecret);

  if (key.length !== nacl.secretbox.keyLength) {
    throw new AgentError('INVALID_KEY_LENGTH', `Shared secret must be exactly ${nacl.secretbox.keyLength} bytes, got ${key.length}`, {
      expected: nacl.secretbox.keyLength,
      actual: key.length,
    });
  }

  const encrypted = nacl.secretbox(messageBytes, nonce, key);

  // Prepend nonce to ciphertext
  const fullMessage = new Uint8Array(nonce.length + encrypted.length);
  fullMessage.set(nonce);
  fullMessage.set(encrypted, nonce.length);

  return encodeBase64(fullMessage);
}

/**
 * Decrypt a message encrypted with NaCl secretbox (symmetric).
 * Expects the nonce to be prepended to the ciphertext in the base64 payload.
 *
 * @param encryptedMessage - Base64-encoded string (nonce + ciphertext)
 * @param sharedSecret - 32-byte shared secret (base64)
 * @returns Decrypted plaintext string
 * @throws AgentError with code DECRYPT_FAILED if decryption fails
 */
export function decryptSecretBox(
  encryptedMessage: string,
  sharedSecret: string,
): string {
  const fullMessage = decodeBase64(encryptedMessage);

  if (fullMessage.length < nacl.secretbox.nonceLength + nacl.secretbox.overheadLength) {
    throw new AgentError('DECRYPT_FAILED', 'Encrypted message is too short to contain nonce and ciphertext', {
      minLength: nacl.secretbox.nonceLength + nacl.secretbox.overheadLength,
      actualLength: fullMessage.length,
    });
  }

  const nonce = fullMessage.slice(0, nacl.secretbox.nonceLength);
  const ciphertext = fullMessage.slice(nacl.secretbox.nonceLength);
  const key = decodeBase64(sharedSecret);

  if (key.length !== nacl.secretbox.keyLength) {
    throw new AgentError('INVALID_KEY_LENGTH', `Shared secret must be exactly ${nacl.secretbox.keyLength} bytes, got ${key.length}`, {
      expected: nacl.secretbox.keyLength,
      actual: key.length,
    });
  }

  const decrypted = nacl.secretbox.open(ciphertext, nonce, key);

  if (decrypted === null) {
    throw new AgentError('DECRYPT_FAILED', 'SecretBox decryption failed — invalid key, corrupted data, or tampered message');
  }

  return encodeUTF8(decrypted);
}

/**
 * Compute a shared secret from a Diffie-Hellman key exchange using NaCl box.before().
 * This precomputes the shared key that can be used with secretbox for faster
 * repeated encryption/decryption between the same pair of parties.
 *
 * @param theirPublicKey - The other party's public key (base64)
 * @param mySecretKey - Your secret key (base64)
 * @returns Base64-encoded 32-byte shared secret
 */
export function computeSharedSecret(
  theirPublicKey: string,
  mySecretKey: string,
): string {
  const theirPk = decodeBase64(theirPublicKey);
  const mySk = decodeBase64(mySecretKey);

  const sharedKey = nacl.box.before(theirPk, mySk);
  return encodeBase64(sharedKey);
}
