import { type DispatchSignature, verifyDispatchPayloadSignature } from '@agentctl/shared';

export const PEER_REGISTRATION_AGENT_ID = 'register-peer';
const REGISTRATION_SIGNATURE_WINDOW_MS = 60_000;

export type PeerRegistrationFields = {
  machineId: string;
  hostname: string;
  syncUrl: string;
  tailscaleIp: string | null;
  publicKey: string;
};

export function createPeerRegistrationPayload(fields: PeerRegistrationFields) {
  const payload: {
    action: typeof PEER_REGISTRATION_AGENT_ID;
    machineId: string;
    hostname: string;
    syncUrl: string;
    tailscaleIp?: string;
    publicKey: string;
  } = {
    action: PEER_REGISTRATION_AGENT_ID,
    machineId: fields.machineId,
    hostname: fields.hostname,
    syncUrl: fields.syncUrl,
    publicKey: fields.publicKey,
  };

  if (fields.tailscaleIp) {
    payload.tailscaleIp = fields.tailscaleIp;
  }

  return payload;
}

export function verifyPeerRegistrationSignature(
  signature: unknown,
  fields: PeerRegistrationFields,
): boolean {
  if (!isRegistrationSignature(signature)) {
    return false;
  }

  const issuedAtMs = Date.parse(signature.issuedAt);
  if (
    !Number.isFinite(issuedAtMs) ||
    Math.abs(Date.now() - issuedAtMs) > REGISTRATION_SIGNATURE_WINDOW_MS
  ) {
    return false;
  }

  return verifyDispatchPayloadSignature(createPeerRegistrationPayload(fields), signature, {
    publicKey: fields.publicKey,
    agentId: PEER_REGISTRATION_AGENT_ID,
    machineId: fields.machineId,
  });
}

function isRegistrationSignature(value: unknown): value is DispatchSignature {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.version === 'number' &&
    typeof candidate.algorithm === 'string' &&
    typeof candidate.agentId === 'string' &&
    typeof candidate.machineId === 'string' &&
    typeof candidate.issuedAt === 'string' &&
    typeof candidate.nonce === 'string' &&
    typeof candidate.signature === 'string'
  );
}
