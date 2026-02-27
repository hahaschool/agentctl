import util from 'tweetnacl-util';
import { describe, expect, it } from 'vitest';
import { AgentError } from '../types/errors.js';
import { generateKeyPair } from './keypair.js';
import type { PairingPayload } from './pairing.js';
import { decodePairingPayload, encodePairingPayload } from './pairing.js';

const { encodeBase64, decodeUTF8 } = util;

function makeValidPayload(overrides?: Partial<PairingPayload>): PairingPayload {
  const kp = generateKeyPair();
  return {
    version: 1,
    devicePublicKey: kp.publicKey,
    deviceName: 'Test Device',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('encodePairingPayload / decodePairingPayload', () => {
  it('roundtrips a valid pairing payload', () => {
    const original = makeValidPayload();

    const encoded = encodePairingPayload(original);
    const decoded = decodePairingPayload(encoded);

    expect(decoded.version).toBe(original.version);
    expect(decoded.devicePublicKey).toBe(original.devicePublicKey);
    expect(decoded.deviceName).toBe(original.deviceName);
    expect(decoded.timestamp).toBe(original.timestamp);
  });
});

describe('decodePairingPayload rejection cases', () => {
  it('rejects expired payload older than 5 minutes', () => {
    const sixMinutesAgo = Date.now() - 6 * 60 * 1000;
    const payload = makeValidPayload({ timestamp: sixMinutesAgo });
    const encoded = encodePairingPayload(payload);

    try {
      decodePairingPayload(encoded);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe('PAIRING_PAYLOAD_EXPIRED');
    }
  });

  it('rejects wrong version', () => {
    const payload = makeValidPayload();
    // Manually encode with wrong version to bypass encodePairingPayload validation
    const tampered = { ...payload, version: 99 };
    const encoded = encodeBase64(decodeUTF8(JSON.stringify(tampered)));

    try {
      decodePairingPayload(encoded);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe('INVALID_PAIRING_VERSION');
    }
  });

  it('rejects missing fields', () => {
    // Missing devicePublicKey
    const incomplete = { version: 1, deviceName: 'Test', timestamp: Date.now() };
    const encoded = encodeBase64(decodeUTF8(JSON.stringify(incomplete)));

    try {
      decodePairingPayload(encoded);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe('INVALID_PAIRING_PAYLOAD');
    }
  });

  it('rejects missing deviceName', () => {
    const kp = generateKeyPair();
    const incomplete = { version: 1, devicePublicKey: kp.publicKey, timestamp: Date.now() };
    const encoded = encodeBase64(decodeUTF8(JSON.stringify(incomplete)));

    try {
      decodePairingPayload(encoded);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe('INVALID_PAIRING_PAYLOAD');
    }
  });

  it('rejects missing timestamp', () => {
    const kp = generateKeyPair();
    const incomplete = { version: 1, devicePublicKey: kp.publicKey, deviceName: 'Test' };
    const encoded = encodeBase64(decodeUTF8(JSON.stringify(incomplete)));

    try {
      decodePairingPayload(encoded);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe('INVALID_PAIRING_PAYLOAD');
    }
  });

  it('rejects invalid base64', () => {
    try {
      decodePairingPayload('!!!not-valid-base64!!!');
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe('INVALID_PAIRING_ENCODING');
    }
  });
});

describe('encodePairingPayload validation', () => {
  it('rejects device name exceeding max length', () => {
    const longName = 'A'.repeat(129);
    const payload = makeValidPayload({ deviceName: longName });

    try {
      encodePairingPayload(payload);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe('INVALID_PAIRING_PAYLOAD');
    }
  });

  it('accepts device name at exactly max length', () => {
    const maxName = 'A'.repeat(128);
    const payload = makeValidPayload({ deviceName: maxName });

    // Should not throw
    const encoded = encodePairingPayload(payload);
    expect(typeof encoded).toBe('string');
  });
});
