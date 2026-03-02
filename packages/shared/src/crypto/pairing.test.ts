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

  it('rejects wrong version', () => {
    const payload = makeValidPayload();
    // Force wrong version via type assertion
    const tampered = { ...payload, version: 2 } as unknown as PairingPayload;

    try {
      encodePairingPayload(tampered);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      const agentErr = err as AgentError;
      expect(agentErr.code).toBe('INVALID_PAIRING_VERSION');
      expect(agentErr.context?.expected).toBe(1);
      expect(agentErr.context?.actual).toBe(2);
    }
  });

  it('rejects empty devicePublicKey', () => {
    const payload = makeValidPayload({ devicePublicKey: '' });

    try {
      encodePairingPayload(payload);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      const agentErr = err as AgentError;
      expect(agentErr.code).toBe('INVALID_PAIRING_PAYLOAD');
      expect(agentErr.message).toContain('Device public key is required');
    }
  });

  it('rejects empty deviceName', () => {
    const payload = makeValidPayload({ deviceName: '' });

    try {
      encodePairingPayload(payload);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      const agentErr = err as AgentError;
      expect(agentErr.code).toBe('INVALID_PAIRING_PAYLOAD');
      expect(agentErr.message).toContain('Device name is required');
    }
  });

  it('includes maxLength and actualLength context when name too long', () => {
    const longName = 'B'.repeat(200);
    const payload = makeValidPayload({ deviceName: longName });

    try {
      encodePairingPayload(payload);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      const agentErr = err as AgentError;
      expect(agentErr.context?.maxLength).toBe(128);
      expect(agentErr.context?.actualLength).toBe(200);
    }
  });
});

describe('decodePairingPayload — additional error paths', () => {
  it('rejects valid base64 that is not valid JSON', () => {
    const notJson = encodeBase64(decodeUTF8('this is not json'));

    try {
      decodePairingPayload(notJson);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe('INVALID_PAIRING_PAYLOAD');
      expect((err as AgentError).message).toContain('not valid JSON');
    }
  });

  it('rejects JSON that is not an object (string)', () => {
    const jsonString = encodeBase64(decodeUTF8(JSON.stringify('just a string')));

    try {
      decodePairingPayload(jsonString);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe('INVALID_PAIRING_PAYLOAD');
      expect((err as AgentError).message).toContain('must be a JSON object');
    }
  });

  it('rejects JSON that is not an object (array falls through to version check)', () => {
    // Arrays pass typeof === 'object' && !== null, so they reach the version check.
    // [1,2,3].version is undefined !== 1, triggering INVALID_PAIRING_VERSION.
    const jsonArray = encodeBase64(decodeUTF8(JSON.stringify([1, 2, 3])));

    try {
      decodePairingPayload(jsonArray);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe('INVALID_PAIRING_VERSION');
    }
  });

  it('rejects JSON null', () => {
    const jsonNull = encodeBase64(decodeUTF8(JSON.stringify(null)));

    try {
      decodePairingPayload(jsonNull);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe('INVALID_PAIRING_PAYLOAD');
      expect((err as AgentError).message).toContain('must be a JSON object');
    }
  });

  it('rejects payload with empty devicePublicKey string', () => {
    const payload = {
      version: 1,
      devicePublicKey: '',
      deviceName: 'Test Device',
      timestamp: Date.now(),
    };
    const encoded = encodeBase64(decodeUTF8(JSON.stringify(payload)));

    try {
      decodePairingPayload(encoded);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe('INVALID_PAIRING_PAYLOAD');
      expect((err as AgentError).message).toContain('devicePublicKey');
    }
  });

  it('rejects payload with empty deviceName string', () => {
    const kp = generateKeyPair();
    const payload = {
      version: 1,
      devicePublicKey: kp.publicKey,
      deviceName: '',
      timestamp: Date.now(),
    };
    const encoded = encodeBase64(decodeUTF8(JSON.stringify(payload)));

    try {
      decodePairingPayload(encoded);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe('INVALID_PAIRING_PAYLOAD');
      expect((err as AgentError).message).toContain('deviceName');
    }
  });

  it('rejects payload with non-string devicePublicKey', () => {
    const payload = {
      version: 1,
      devicePublicKey: 12345,
      deviceName: 'Test Device',
      timestamp: Date.now(),
    };
    const encoded = encodeBase64(decodeUTF8(JSON.stringify(payload)));

    try {
      decodePairingPayload(encoded);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe('INVALID_PAIRING_PAYLOAD');
    }
  });

  it('rejects payload with non-string deviceName', () => {
    const kp = generateKeyPair();
    const payload = {
      version: 1,
      devicePublicKey: kp.publicKey,
      deviceName: 42,
      timestamp: Date.now(),
    };
    const encoded = encodeBase64(decodeUTF8(JSON.stringify(payload)));

    try {
      decodePairingPayload(encoded);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe('INVALID_PAIRING_PAYLOAD');
    }
  });

  it('rejects payload with non-finite timestamp (NaN)', () => {
    const kp = generateKeyPair();
    // JSON.stringify converts NaN to null, so we need to use a non-number type
    const payload = {
      version: 1,
      devicePublicKey: kp.publicKey,
      deviceName: 'Test Device',
      timestamp: 'not-a-number',
    };
    const encoded = encodeBase64(decodeUTF8(JSON.stringify(payload)));

    try {
      decodePairingPayload(encoded);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe('INVALID_PAIRING_PAYLOAD');
      expect((err as AgentError).message).toContain('timestamp');
    }
  });

  it('rejects payload with null timestamp', () => {
    const kp = generateKeyPair();
    const payload = {
      version: 1,
      devicePublicKey: kp.publicKey,
      deviceName: 'Test Device',
      timestamp: null,
    };
    const encoded = encodeBase64(decodeUTF8(JSON.stringify(payload)));

    try {
      decodePairingPayload(encoded);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe('INVALID_PAIRING_PAYLOAD');
      expect((err as AgentError).message).toContain('timestamp');
    }
  });

  it('includes ageMs and maxAgeMs context when payload is expired', () => {
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    const payload = makeValidPayload({ timestamp: tenMinutesAgo });
    const encoded = encodePairingPayload(payload);

    try {
      decodePairingPayload(encoded);
      expect.fail('Expected an error to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      const agentErr = err as AgentError;
      expect(agentErr.code).toBe('PAIRING_PAYLOAD_EXPIRED');
      expect(agentErr.context?.maxAgeMs).toBe(5 * 60 * 1000);
      expect(typeof agentErr.context?.ageMs).toBe('number');
      expect(agentErr.context?.ageMs as number).toBeGreaterThan(5 * 60 * 1000);
    }
  });
});
