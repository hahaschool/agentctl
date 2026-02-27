import util from 'tweetnacl-util';

import { AgentError } from '../types/errors.js';

const { decodeUTF8, encodeUTF8, encodeBase64, decodeBase64 } = util;

/**
 * Pairing payload displayed as QR code by the iOS device.
 * The device generates a key pair and encodes this payload as JSON -> base64 for the QR code.
 */
type PairingPayload = {
  version: 1;
  devicePublicKey: string; // base64-encoded Curve25519 public key
  deviceName: string; // e.g., "iPhone 15 Pro"
  timestamp: number; // Unix milliseconds
};

/**
 * Response sent by the server after scanning the QR code.
 * Contains the server's public key so both sides can compute a shared secret.
 */
type PairingResponse = {
  version: 1;
  serverPublicKey: string; // base64-encoded Curve25519 public key
  serverId: string; // control plane instance identifier
  paired: boolean;
};

/**
 * Represents a successfully paired device with its precomputed shared secret.
 */
type PairedDevice = {
  devicePublicKey: string; // base64
  deviceName: string;
  sharedSecret: string; // base64 (computed from nacl.box.before)
  pairedAt: Date;
};

const PAIRING_VERSION = 1;
const MAX_DEVICE_NAME_LENGTH = 128;
const MAX_PAIRING_PAYLOAD_AGE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Encode a pairing payload for display as a QR code.
 * The payload is serialized as JSON and then base64-encoded.
 *
 * @param payload - The pairing payload to encode
 * @returns Base64-encoded JSON string suitable for QR code generation
 */
export function encodePairingPayload(payload: PairingPayload): string {
  if (payload.version !== PAIRING_VERSION) {
    throw new AgentError('INVALID_PAIRING_VERSION', `Unsupported pairing version: ${payload.version}`, {
      expected: PAIRING_VERSION,
      actual: payload.version,
    });
  }

  if (!payload.devicePublicKey || payload.devicePublicKey.length === 0) {
    throw new AgentError('INVALID_PAIRING_PAYLOAD', 'Device public key is required');
  }

  if (!payload.deviceName || payload.deviceName.length === 0) {
    throw new AgentError('INVALID_PAIRING_PAYLOAD', 'Device name is required');
  }

  if (payload.deviceName.length > MAX_DEVICE_NAME_LENGTH) {
    throw new AgentError('INVALID_PAIRING_PAYLOAD', `Device name exceeds maximum length of ${MAX_DEVICE_NAME_LENGTH} characters`, {
      maxLength: MAX_DEVICE_NAME_LENGTH,
      actualLength: payload.deviceName.length,
    });
  }

  const json = JSON.stringify(payload);
  return encodeBase64(decodeUTF8(json));
}

/**
 * Decode a pairing payload from a QR code scan.
 * Validates the structure and version of the payload.
 *
 * @param encoded - Base64-encoded JSON string from QR code
 * @returns Decoded and validated PairingPayload
 * @throws AgentError if the payload is malformed, expired, or has wrong version
 */
export function decodePairingPayload(encoded: string): PairingPayload {
  let json: string;
  try {
    const bytes = decodeBase64(encoded);
    json = encodeUTF8(bytes);
  } catch {
    throw new AgentError('INVALID_PAIRING_ENCODING', 'Failed to decode base64 pairing payload');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new AgentError('INVALID_PAIRING_PAYLOAD', 'Pairing payload is not valid JSON');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new AgentError('INVALID_PAIRING_PAYLOAD', 'Pairing payload must be a JSON object');
  }

  const payload = parsed as Record<string, unknown>;

  if (payload['version'] !== PAIRING_VERSION) {
    throw new AgentError('INVALID_PAIRING_VERSION', `Unsupported pairing version: ${payload['version']}`, {
      expected: PAIRING_VERSION,
      actual: payload['version'],
    });
  }

  if (typeof payload['devicePublicKey'] !== 'string' || payload['devicePublicKey'].length === 0) {
    throw new AgentError('INVALID_PAIRING_PAYLOAD', 'Missing or invalid devicePublicKey');
  }

  if (typeof payload['deviceName'] !== 'string' || payload['deviceName'].length === 0) {
    throw new AgentError('INVALID_PAIRING_PAYLOAD', 'Missing or invalid deviceName');
  }

  if (typeof payload['timestamp'] !== 'number' || !Number.isFinite(payload['timestamp'])) {
    throw new AgentError('INVALID_PAIRING_PAYLOAD', 'Missing or invalid timestamp');
  }

  const age = Date.now() - (payload['timestamp'] as number);
  if (age > MAX_PAIRING_PAYLOAD_AGE_MS) {
    throw new AgentError('PAIRING_PAYLOAD_EXPIRED', `Pairing payload is ${Math.round(age / 1000)}s old, maximum is ${MAX_PAIRING_PAYLOAD_AGE_MS / 1000}s`, {
      ageMs: age,
      maxAgeMs: MAX_PAIRING_PAYLOAD_AGE_MS,
    });
  }

  return {
    version: PAIRING_VERSION,
    devicePublicKey: payload['devicePublicKey'] as string,
    deviceName: payload['deviceName'] as string,
    timestamp: payload['timestamp'] as number,
  };
}

export type { PairingPayload, PairingResponse, PairedDevice };
