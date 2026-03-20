import { randomBytes } from 'node:crypto';

import nacl from 'tweetnacl';
import util from 'tweetnacl-util';

import { AgentError } from '../types/errors.js';

const { decodeBase64, encodeBase64 } = util;

export const DISPATCH_SIGNATURE_VERSION = 1 as const;
export const DISPATCH_SIGNATURE_ALGORITHM = 'ed25519' as const;

export type DispatchSignature = {
  version: typeof DISPATCH_SIGNATURE_VERSION;
  algorithm: typeof DISPATCH_SIGNATURE_ALGORITHM;
  agentId: string;
  machineId: string;
  issuedAt: string;
  nonce: string;
  signature: string;
};

export type DispatchVerificationConfig = {
  version: typeof DISPATCH_SIGNATURE_VERSION;
  algorithm: typeof DISPATCH_SIGNATURE_ALGORITHM;
  publicKey: string;
};

export type DispatchSigningKeyPair = {
  publicKey: string;
  secretKey: string;
};

type SignDispatchPayloadOptions = {
  agentId: string;
  machineId: string;
  secretKey: string;
  issuedAt?: string;
  nonce?: string;
};

type VerifyDispatchPayloadSignatureOptions = {
  publicKey: string;
  agentId: string;
  machineId: string;
};

export function generateDispatchSigningKeyPair(): DispatchSigningKeyPair {
  const keyPair = nacl.sign.keyPair();

  return {
    publicKey: encodeBase64(keyPair.publicKey),
    secretKey: encodeBase64(keyPair.secretKey),
  };
}

export function dispatchSigningKeyPairFromSecretKey(secretKey: string): DispatchSigningKeyPair {
  const decodedSecretKey = decodeSigningSecretKey(secretKey);
  const keyPair = nacl.sign.keyPair.fromSecretKey(decodedSecretKey);

  return {
    publicKey: encodeBase64(keyPair.publicKey),
    secretKey: encodeBase64(keyPair.secretKey),
  };
}

export function createDispatchVerificationConfig(publicKey: string): DispatchVerificationConfig {
  return {
    version: DISPATCH_SIGNATURE_VERSION,
    algorithm: DISPATCH_SIGNATURE_ALGORITHM,
    publicKey,
  };
}

export function signDispatchPayload(
  payload: unknown,
  options: SignDispatchPayloadOptions,
): DispatchSignature {
  const secretKey = decodeSigningSecretKey(options.secretKey);
  const signaturePayload = {
    version: DISPATCH_SIGNATURE_VERSION,
    algorithm: DISPATCH_SIGNATURE_ALGORITHM,
    agentId: options.agentId,
    machineId: options.machineId,
    issuedAt: options.issuedAt ?? new Date().toISOString(),
    nonce: options.nonce ?? randomBytes(16).toString('base64url'),
    payload,
  };

  const signature = nacl.sign.detached(
    new TextEncoder().encode(stableStringify(signaturePayload)),
    secretKey,
  );

  return {
    version: signaturePayload.version,
    algorithm: signaturePayload.algorithm,
    agentId: signaturePayload.agentId,
    machineId: signaturePayload.machineId,
    issuedAt: signaturePayload.issuedAt,
    nonce: signaturePayload.nonce,
    signature: encodeBase64(signature),
  };
}

export function verifyDispatchPayloadSignature(
  payload: unknown,
  dispatchSignature: unknown,
  options: VerifyDispatchPayloadSignatureOptions,
): boolean {
  if (!isDispatchSignature(dispatchSignature)) {
    return false;
  }

  if (
    dispatchSignature.version !== DISPATCH_SIGNATURE_VERSION ||
    dispatchSignature.algorithm !== DISPATCH_SIGNATURE_ALGORITHM ||
    dispatchSignature.agentId !== options.agentId ||
    dispatchSignature.machineId !== options.machineId
  ) {
    return false;
  }

  try {
    const publicKey = decodeSigningPublicKey(options.publicKey);
    const signature = decodeBase64(dispatchSignature.signature);

    if (signature.length !== nacl.sign.signatureLength) {
      return false;
    }

    return nacl.sign.detached.verify(
      new TextEncoder().encode(
        stableStringify({
          version: dispatchSignature.version,
          algorithm: dispatchSignature.algorithm,
          agentId: dispatchSignature.agentId,
          machineId: dispatchSignature.machineId,
          issuedAt: dispatchSignature.issuedAt,
          nonce: dispatchSignature.nonce,
          payload,
        }),
      ),
      signature,
      publicKey,
    );
  } catch {
    return false;
  }
}

export function isDispatchVerificationConfig(value: unknown): value is DispatchVerificationConfig {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === DISPATCH_SIGNATURE_VERSION &&
    candidate.algorithm === DISPATCH_SIGNATURE_ALGORITHM &&
    typeof candidate.publicKey === 'string' &&
    candidate.publicKey.length > 0
  );
}

function isDispatchSignature(value: unknown): value is DispatchSignature {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === DISPATCH_SIGNATURE_VERSION &&
    typeof candidate.algorithm === 'string' &&
    typeof candidate.agentId === 'string' &&
    typeof candidate.machineId === 'string' &&
    typeof candidate.issuedAt === 'string' &&
    typeof candidate.nonce === 'string' &&
    typeof candidate.signature === 'string'
  );
}

function decodeSigningSecretKey(secretKey: string): Uint8Array {
  const decoded = decodeBase64(secretKey);

  if (decoded.length !== nacl.sign.secretKeyLength) {
    throw new AgentError(
      'INVALID_KEY_LENGTH',
      `Signing secret key must be exactly ${nacl.sign.secretKeyLength} bytes, got ${decoded.length}`,
      {
        expected: nacl.sign.secretKeyLength,
        actual: decoded.length,
      },
    );
  }

  return decoded;
}

function decodeSigningPublicKey(publicKey: string): Uint8Array {
  const decoded = decodeBase64(publicKey);

  if (decoded.length !== nacl.sign.publicKeyLength) {
    throw new AgentError(
      'INVALID_KEY_LENGTH',
      `Signing public key must be exactly ${nacl.sign.publicKeyLength} bytes, got ${decoded.length}`,
      {
        expected: nacl.sign.publicKeyLength,
        actual: decoded.length,
      },
    );
  }

  return decoded;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const json = JSON.stringify(value);
    return json === undefined ? 'null' : json;
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => JSON.stringify(entryValue) !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);

  return `{${entries.join(',')}}`;
}
