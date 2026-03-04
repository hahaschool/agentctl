import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

export function encryptCredential(
  plaintext: string,
  hexKey: string,
): { encrypted: string; iv: string } {
  const key = Buffer.from(hexKey, 'hex');
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encrypted: Buffer.concat([encrypted, authTag]).toString('base64'),
    iv: iv.toString('base64'),
  };
}

export function decryptCredential(
  encryptedBase64: string,
  ivBase64: string,
  hexKey: string,
): string {
  const key = Buffer.from(hexKey, 'hex');
  const iv = Buffer.from(ivBase64, 'base64');
  const data = Buffer.from(encryptedBase64, 'base64');
  const authTag = data.subarray(data.length - AUTH_TAG_LENGTH);
  const ciphertext = data.subarray(0, data.length - AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final('utf8');
}

export function maskCredential(credential: string): string {
  if (credential.length === 0) return '***';
  if (credential.startsWith('sk-ant-')) {
    const last4 = credential.slice(-4);
    return `sk-ant-...${last4}`;
  }
  if (credential.length <= 6) {
    const last3 = credential.slice(-Math.min(3, credential.length));
    return `***${last3}`;
  }
  const last4 = credential.slice(-4);
  return `${credential.slice(0, 4)}...${last4}`;
}
