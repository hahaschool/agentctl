import { createHash } from 'node:crypto';

import { signDispatchPayload, verifyDispatchPayloadSignature } from '@agentctl/shared';

const PEER_SIGNATURE_AGENT_ID = 'mesh-peer';
const NONCE_WINDOW_MS = 60_000;
const NONCE_CACHE_LIMIT = 10_000;

type PeerSignedHeader = {
  version: number;
  algorithm: string;
  machineId: string;
  issuedAt: string;
  nonce: string;
  bodyHash: string;
  signature: string;
};

type KnownPeers = Record<string, string>;

const seenNonces = new Map<string, number>();

export function createPeerSignedHeader(
  machineId: string,
  method: string,
  path: string,
  body: unknown,
  secretKey: string,
): string {
  const bodyHash = hashBody(body);
  const signature = signDispatchPayload(
    {
      method: method.toUpperCase(),
      path,
      bodyHash,
    },
    {
      agentId: PEER_SIGNATURE_AGENT_ID,
      machineId,
      secretKey,
    },
  );

  return JSON.stringify({
    version: signature.version,
    algorithm: signature.algorithm,
    machineId: signature.machineId,
    issuedAt: signature.issuedAt,
    nonce: signature.nonce,
    bodyHash,
    signature: signature.signature,
  } satisfies PeerSignedHeader);
}

export function verifyPeerSignature(
  header: string,
  method: string,
  path: string,
  body: unknown,
  knownPeers: KnownPeers,
): { valid: boolean; machineId: string | null } {
  const parsed = parseHeader(header);
  if (!parsed) {
    return { valid: false, machineId: null };
  }

  const publicKey = knownPeers[parsed.machineId];
  if (!publicKey) {
    return { valid: false, machineId: null };
  }

  const issuedAtMs = Date.parse(parsed.issuedAt);
  const now = Date.now();
  if (!Number.isFinite(issuedAtMs) || Math.abs(now - issuedAtMs) > NONCE_WINDOW_MS) {
    return { valid: false, machineId: null };
  }

  pruneSeenNonces(now);
  const nonceKey = `${parsed.machineId}:${parsed.nonce}`;
  if (seenNonces.has(nonceKey)) {
    return { valid: false, machineId: null };
  }

  const valid = verifyDispatchPayloadSignature(
    {
      method: method.toUpperCase(),
      path,
      bodyHash: hashBody(body),
    },
    {
      version: parsed.version,
      algorithm: parsed.algorithm,
      agentId: PEER_SIGNATURE_AGENT_ID,
      machineId: parsed.machineId,
      issuedAt: parsed.issuedAt,
      nonce: parsed.nonce,
      signature: parsed.signature,
    },
    {
      publicKey,
      agentId: PEER_SIGNATURE_AGENT_ID,
      machineId: parsed.machineId,
    },
  );

  if (!valid) {
    return { valid: false, machineId: null };
  }

  seenNonces.set(nonceKey, now);
  enforceNonceCacheLimit();

  return {
    valid: true,
    machineId: parsed.machineId,
  };
}

function hashBody(body: unknown): string {
  return createHash('sha256').update(stableStringify(body)).digest('base64');
}

function parseHeader(header: string): PeerSignedHeader | null {
  try {
    const parsed = JSON.parse(header) as Record<string, unknown>;

    if (
      typeof parsed.version !== 'number' ||
      typeof parsed.algorithm !== 'string' ||
      typeof parsed.machineId !== 'string' ||
      typeof parsed.issuedAt !== 'string' ||
      typeof parsed.nonce !== 'string' ||
      typeof parsed.bodyHash !== 'string' ||
      typeof parsed.signature !== 'string'
    ) {
      return null;
    }

    return {
      version: parsed.version,
      algorithm: parsed.algorithm,
      machineId: parsed.machineId,
      issuedAt: parsed.issuedAt,
      nonce: parsed.nonce,
      bodyHash: parsed.bodyHash,
      signature: parsed.signature,
    };
  } catch {
    return null;
  }
}

function pruneSeenNonces(now: number): void {
  for (const [nonceKey, timestamp] of seenNonces) {
    if (now - timestamp > NONCE_WINDOW_MS) {
      seenNonces.delete(nonceKey);
    }
  }
}

function enforceNonceCacheLimit(): void {
  while (seenNonces.size > NONCE_CACHE_LIMIT) {
    const oldestKey = seenNonces.keys().next().value;
    if (!oldestKey) {
      return;
    }
    seenNonces.delete(oldestKey);
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const json = JSON.stringify(value);
    return json === undefined ? 'null' : json;
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(',')}}`;
}
