import { describe, expect, it } from 'vitest';

import type {
  WebhookConfig,
  WebhookEventType,
  WebhookPayload,
  WebhookProvider,
} from './webhook.js';
import { WEBHOOK_EVENT_TYPES, WEBHOOK_PROVIDERS } from './webhook.js';

// ── WebhookProvider union ───────────────────────────────────────────

describe('WebhookProvider', () => {
  it('covers all three provider types', () => {
    const providers: WebhookProvider[] = ['slack', 'discord', 'generic'];
    expect(providers).toHaveLength(3);

    const unique = new Set(providers);
    expect(unique.size).toBe(3);
  });
});

// ── WEBHOOK_PROVIDERS constant ──────────────────────────────────────

describe('WEBHOOK_PROVIDERS', () => {
  it('contains exactly 3 providers', () => {
    expect(WEBHOOK_PROVIDERS).toHaveLength(3);
  });

  it('contains all expected values', () => {
    expect([...WEBHOOK_PROVIDERS]).toEqual(['slack', 'discord', 'generic']);
  });

  it('has no duplicates', () => {
    const unique = new Set(WEBHOOK_PROVIDERS);
    expect(unique.size).toBe(WEBHOOK_PROVIDERS.length);
  });
});

// ── WebhookEventType union ──────────────────────────────────────────

describe('WebhookEventType', () => {
  it('covers all eight event types', () => {
    const events: WebhookEventType[] = [
      'agent.started',
      'agent.stopped',
      'agent.error',
      'agent.cost_alert',
      'approval.pending',
      'deploy.success',
      'deploy.failure',
      'audit.high_severity',
    ];
    expect(events).toHaveLength(8);

    const unique = new Set(events);
    expect(unique.size).toBe(8);
  });
});

// ── WEBHOOK_EVENT_TYPES constant ────────────────────────────────────

describe('WEBHOOK_EVENT_TYPES', () => {
  it('contains exactly 8 event types', () => {
    expect(WEBHOOK_EVENT_TYPES).toHaveLength(8);
  });

  it('contains all expected values', () => {
    expect([...WEBHOOK_EVENT_TYPES]).toEqual([
      'agent.started',
      'agent.stopped',
      'agent.error',
      'agent.cost_alert',
      'approval.pending',
      'deploy.success',
      'deploy.failure',
      'audit.high_severity',
    ]);
  });

  it('has no duplicates', () => {
    const unique = new Set(WEBHOOK_EVENT_TYPES);
    expect(unique.size).toBe(WEBHOOK_EVENT_TYPES.length);
  });

  it('every element is a non-empty string', () => {
    for (const event of WEBHOOK_EVENT_TYPES) {
      expect(typeof event).toBe('string');
      expect(event.length).toBeGreaterThan(0);
    }
  });
});

// ── WebhookConfig shape ─────────────────────────────────────────────

describe('WebhookConfig', () => {
  it('has the correct shape with all required fields', () => {
    const config: WebhookConfig = {
      id: 'wh-001',
      provider: 'slack',
      url: 'https://hooks.slack.com/services/T00/B00/xxx',
      events: ['agent.started', 'agent.error'],
      enabled: true,
    };

    expect(config.id).toBe('wh-001');
    expect(config.provider).toBe('slack');
    expect(config.url).toContain('hooks.slack.com');
    expect(config.events).toHaveLength(2);
    expect(config.enabled).toBe(true);
    expect(config.secret).toBeUndefined();
  });

  it('accepts an optional secret for HMAC verification', () => {
    const config: WebhookConfig = {
      id: 'wh-002',
      provider: 'generic',
      url: 'https://example.com/webhook',
      events: ['deploy.success'],
      enabled: true,
      secret: 'my-secret-key',
    };

    expect(config.secret).toBe('my-secret-key');
  });

  it('accepts a disabled webhook', () => {
    const config: WebhookConfig = {
      id: 'wh-003',
      provider: 'discord',
      url: 'https://discord.com/api/webhooks/123/abc',
      events: ['audit.high_severity'],
      enabled: false,
    };

    expect(config.enabled).toBe(false);
  });

  it('accepts empty events array', () => {
    const config: WebhookConfig = {
      id: 'wh-004',
      provider: 'generic',
      url: 'https://example.com/webhook',
      events: [],
      enabled: true,
    };

    expect(config.events).toEqual([]);
  });
});

// ── WebhookPayload shape ────────────────────────────────────────────

describe('WebhookPayload', () => {
  it('has the correct shape with all required fields', () => {
    const payload: WebhookPayload = {
      event: 'agent.started',
      timestamp: '2026-03-02T10:00:00.000Z',
      data: { agentId: 'agent-001', machineId: 'mac-mini-01' },
    };

    expect(payload.event).toBe('agent.started');
    expect(payload.timestamp).toBe('2026-03-02T10:00:00.000Z');
    expect(payload.data.agentId).toBe('agent-001');
  });

  it('accepts empty data object', () => {
    const payload: WebhookPayload = {
      event: 'deploy.success',
      timestamp: new Date().toISOString(),
      data: {},
    };

    expect(payload.data).toEqual({});
  });

  it('accepts nested data', () => {
    const payload: WebhookPayload = {
      event: 'agent.error',
      timestamp: new Date().toISOString(),
      data: {
        error: {
          code: 'AGENT_TIMEOUT',
          message: 'Agent did not respond',
        },
        agentId: 'agent-002',
      },
    };

    expect(payload.data.error).toBeDefined();
  });
});
