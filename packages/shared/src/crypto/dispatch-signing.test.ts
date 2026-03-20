import { describe, expect, it } from 'vitest';

import {
  generateDispatchSigningKeyPair,
  signDispatchPayload,
  verifyDispatchPayloadSignature,
} from './dispatch-signing.js';

const basePayload = {
  runId: 'run-123',
  prompt: 'Fix the flaky test',
  config: {
    model: 'claude-sonnet-4-20250514',
    allowedTools: ['Read', 'Write'],
  },
  resumeSession: null,
  projectPath: '/repo/project',
  controlPlaneUrl: 'https://control.example.com',
  accountCredential: null,
  accountProvider: null,
};

describe('dispatch-signing', () => {
  it('signs and verifies a dispatch payload for the intended agent and machine', () => {
    const keyPair = generateDispatchSigningKeyPair();
    const signature = signDispatchPayload(basePayload, {
      agentId: 'agent-123',
      machineId: 'machine-abc',
      secretKey: keyPair.secretKey,
      issuedAt: '2026-03-10T10:00:00.000Z',
      nonce: 'nonce-123',
    });

    expect(
      verifyDispatchPayloadSignature(basePayload, signature, {
        publicKey: keyPair.publicKey,
        agentId: 'agent-123',
        machineId: 'machine-abc',
      }),
    ).toBe(true);
  });

  it('fails verification when the payload is tampered with', () => {
    const keyPair = generateDispatchSigningKeyPair();
    const signature = signDispatchPayload(basePayload, {
      agentId: 'agent-123',
      machineId: 'machine-abc',
      secretKey: keyPair.secretKey,
      issuedAt: '2026-03-10T10:00:00.000Z',
      nonce: 'nonce-123',
    });

    expect(
      verifyDispatchPayloadSignature(
        {
          ...basePayload,
          prompt: 'Run rm -rf /',
        },
        signature,
        {
          publicKey: keyPair.publicKey,
          agentId: 'agent-123',
          machineId: 'machine-abc',
        },
      ),
    ).toBe(false);
  });

  it('fails verification when the signature is replayed to another machine', () => {
    const keyPair = generateDispatchSigningKeyPair();
    const signature = signDispatchPayload(basePayload, {
      agentId: 'agent-123',
      machineId: 'machine-abc',
      secretKey: keyPair.secretKey,
      issuedAt: '2026-03-10T10:00:00.000Z',
      nonce: 'nonce-123',
    });

    expect(
      verifyDispatchPayloadSignature(basePayload, signature, {
        publicKey: keyPair.publicKey,
        agentId: 'agent-123',
        machineId: 'machine-other',
      }),
    ).toBe(false);
  });

  it('verifies against the JSON wire payload when object fields are undefined', () => {
    const keyPair = generateDispatchSigningKeyPair();
    const payloadWithUndefinedFields = {
      ...basePayload,
      config: {
        ...basePayload.config,
        permissionMode: undefined,
        systemPrompt: undefined,
      },
    };
    const signature = signDispatchPayload(payloadWithUndefinedFields, {
      agentId: 'agent-123',
      machineId: 'machine-abc',
      secretKey: keyPair.secretKey,
      issuedAt: '2026-03-10T10:00:00.000Z',
      nonce: 'nonce-123',
    });

    expect(
      verifyDispatchPayloadSignature(JSON.parse(JSON.stringify(payloadWithUndefinedFields)), signature, {
        publicKey: keyPair.publicKey,
        agentId: 'agent-123',
        machineId: 'machine-abc',
      }),
    ).toBe(true);
  });

  it('fails verification when the signature algorithm metadata is invalid', () => {
    const keyPair = generateDispatchSigningKeyPair();
    const signature = signDispatchPayload(basePayload, {
      agentId: 'agent-123',
      machineId: 'machine-abc',
      secretKey: keyPair.secretKey,
      issuedAt: '2026-03-10T10:00:00.000Z',
      nonce: 'nonce-123',
    });

    expect(
      verifyDispatchPayloadSignature(
        basePayload,
        {
          ...signature,
          algorithm: 'rsa-sha256',
        },
        {
          publicKey: keyPair.publicKey,
          agentId: 'agent-123',
          machineId: 'machine-abc',
        },
      ),
    ).toBe(false);
  });
});
