import { describe, expect, it } from 'vitest';

import { decryptCredential, encryptCredential, maskCredential } from './credential-crypto.js';

const TEST_KEY = 'a'.repeat(64); // 32-byte hex key

describe('credential-crypto', () => {
  it('encrypts and decrypts a credential round-trip', () => {
    const original = 'sk-ant-api03-xxxxxxxxxxxx';
    const { encrypted, iv } = encryptCredential(original, TEST_KEY);
    expect(encrypted).not.toBe(original);
    expect(iv).toBeTruthy();
    const decrypted = decryptCredential(encrypted, iv, TEST_KEY);
    expect(decrypted).toBe(original);
  });

  it('produces different ciphertext for the same plaintext', () => {
    const original = 'sk-ant-api03-xxxxxxxxxxxx';
    const a = encryptCredential(original, TEST_KEY);
    const b = encryptCredential(original, TEST_KEY);
    expect(a.encrypted).not.toBe(b.encrypted);
  });

  it('masks API keys correctly', () => {
    expect(maskCredential('sk-ant-api03-abcdefghijklmnop')).toBe('sk-ant-...mnop');
    expect(maskCredential('short')).toBe('***ort');
    expect(maskCredential('')).toBe('***');
  });
});
