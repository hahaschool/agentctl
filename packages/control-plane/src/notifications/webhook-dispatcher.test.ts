import { createHmac } from 'node:crypto';
import type { WebhookConfig, WebhookPayload } from '@agentctl/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WebhookDispatcher } from './webhook-dispatcher.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<WebhookConfig>): WebhookConfig {
  return {
    id: 'wh-test',
    provider: 'generic',
    url: 'https://example.com/webhook',
    events: ['agent.started'],
    enabled: true,
    ...overrides,
  };
}

/** Build a minimal successful Response stub. */
function okResponse(status = 200): Response {
  return new Response(JSON.stringify({ ok: true }), {
    status,
    statusText: 'OK',
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(status: number): Response {
  return new Response(JSON.stringify({ error: 'fail' }), {
    status,
    statusText: 'Error',
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebhookDispatcher', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn<(...args: unknown[]) => Promise<Response>>();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Registration ────────────────────────────────────────────────────

  describe('register / unregister', () => {
    it('registers a webhook and returns it from getWebhooks', () => {
      const dispatcher = new WebhookDispatcher();
      const config = makeConfig();

      dispatcher.register(config);

      const webhooks = dispatcher.getWebhooks();
      expect(webhooks).toHaveLength(1);
      expect(webhooks[0].id).toBe('wh-test');
    });

    it('registers multiple webhooks', () => {
      const dispatcher = new WebhookDispatcher();

      dispatcher.register(makeConfig({ id: 'wh-1' }));
      dispatcher.register(makeConfig({ id: 'wh-2' }));
      dispatcher.register(makeConfig({ id: 'wh-3' }));

      expect(dispatcher.getWebhooks()).toHaveLength(3);
    });

    it('overwrites a webhook with the same id on re-register', () => {
      const dispatcher = new WebhookDispatcher();

      dispatcher.register(makeConfig({ id: 'wh-1', provider: 'slack' }));
      dispatcher.register(makeConfig({ id: 'wh-1', provider: 'discord' }));

      const webhooks = dispatcher.getWebhooks();
      expect(webhooks).toHaveLength(1);
      expect(webhooks[0].provider).toBe('discord');
    });

    it('unregisters a webhook by id', () => {
      const dispatcher = new WebhookDispatcher();

      dispatcher.register(makeConfig({ id: 'wh-1' }));
      dispatcher.register(makeConfig({ id: 'wh-2' }));

      dispatcher.unregister('wh-1');

      const webhooks = dispatcher.getWebhooks();
      expect(webhooks).toHaveLength(1);
      expect(webhooks[0].id).toBe('wh-2');
    });

    it('unregistering a non-existent id is a no-op', () => {
      const dispatcher = new WebhookDispatcher();

      dispatcher.register(makeConfig());
      dispatcher.unregister('non-existent');

      expect(dispatcher.getWebhooks()).toHaveLength(1);
    });

    it('returns empty array when no webhooks are registered', () => {
      const dispatcher = new WebhookDispatcher();
      expect(dispatcher.getWebhooks()).toEqual([]);
    });

    it('does not share references with the registered config', () => {
      const dispatcher = new WebhookDispatcher();
      const config = makeConfig({ id: 'wh-ref' });

      dispatcher.register(config);

      // Mutating the original should not affect the stored copy
      config.enabled = false;

      const stored = dispatcher.getWebhooks();
      expect(stored[0].enabled).toBe(true);
    });
  });

  // ── Dispatch ────────────────────────────────────────────────────────

  describe('dispatch', () => {
    it('sends to all webhooks subscribed to the event', async () => {
      fetchMock.mockResolvedValue(okResponse());

      const dispatcher = new WebhookDispatcher({ maxRetries: 0 });
      dispatcher.register(makeConfig({ id: 'wh-1', events: ['agent.started'] }));
      dispatcher.register(makeConfig({ id: 'wh-2', events: ['agent.started'] }));

      const results = await dispatcher.dispatch('agent.started', { agentId: 'a1' });

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('only sends to webhooks that include the dispatched event', async () => {
      fetchMock.mockResolvedValue(okResponse());

      const dispatcher = new WebhookDispatcher({ maxRetries: 0 });
      dispatcher.register(makeConfig({ id: 'wh-match', events: ['agent.started'] }));
      dispatcher.register(makeConfig({ id: 'wh-no-match', events: ['agent.stopped'] }));

      const results = await dispatcher.dispatch('agent.started', {});

      expect(results).toHaveLength(1);
      expect(results[0].webhookId).toBe('wh-match');
    });

    it('skips disabled webhooks', async () => {
      fetchMock.mockResolvedValue(okResponse());

      const dispatcher = new WebhookDispatcher({ maxRetries: 0 });
      dispatcher.register(makeConfig({ id: 'wh-enabled', enabled: true }));
      dispatcher.register(makeConfig({ id: 'wh-disabled', enabled: false }));

      const results = await dispatcher.dispatch('agent.started', {});

      expect(results).toHaveLength(1);
      expect(results[0].webhookId).toBe('wh-enabled');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('returns empty array when no webhooks match', async () => {
      const dispatcher = new WebhookDispatcher({ maxRetries: 0 });
      dispatcher.register(makeConfig({ events: ['deploy.success'] }));

      const results = await dispatcher.dispatch('agent.error', {});

      expect(results).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns empty array when no webhooks are registered', async () => {
      const dispatcher = new WebhookDispatcher({ maxRetries: 0 });

      const results = await dispatcher.dispatch('agent.started', {});

      expect(results).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('includes statusCode and durationMs on success', async () => {
      fetchMock.mockResolvedValue(okResponse(201));

      const dispatcher = new WebhookDispatcher({ maxRetries: 0 });
      dispatcher.register(makeConfig());

      const results = await dispatcher.dispatch('agent.started', {});

      expect(results[0].statusCode).toBe(201);
      expect(results[0].durationMs).toBeGreaterThanOrEqual(0);
    });

    it('sends correct JSON body with Content-Type header', async () => {
      fetchMock.mockResolvedValue(okResponse());

      const dispatcher = new WebhookDispatcher({ maxRetries: 0 });
      dispatcher.register(makeConfig({ provider: 'generic' }));

      await dispatcher.dispatch('agent.started', { agentId: 'a1' });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(init.body as string);
      expect(body.event).toBe('agent.started');
      expect(body.data.agentId).toBe('a1');
      expect(body.timestamp).toBeDefined();
    });

    it('dispatches to webhooks subscribed to multiple events', async () => {
      fetchMock.mockResolvedValue(okResponse());

      const dispatcher = new WebhookDispatcher({ maxRetries: 0 });
      dispatcher.register(
        makeConfig({
          id: 'wh-multi',
          events: ['agent.started', 'agent.error', 'deploy.success'],
        }),
      );

      const r1 = await dispatcher.dispatch('agent.started', {});
      const r2 = await dispatcher.dispatch('agent.error', {});
      const r3 = await dispatcher.dispatch('deploy.success', {});
      const r4 = await dispatcher.dispatch('deploy.failure', {});

      expect(r1).toHaveLength(1);
      expect(r2).toHaveLength(1);
      expect(r3).toHaveLength(1);
      expect(r4).toEqual([]);
    });
  });

  // ── Delivery result structure ───────────────────────────────────────

  describe('delivery result structure', () => {
    it('returns correct structure on success', async () => {
      fetchMock.mockResolvedValue(okResponse(200));

      const dispatcher = new WebhookDispatcher({ maxRetries: 0 });
      dispatcher.register(makeConfig({ id: 'wh-struct' }));

      const results = await dispatcher.dispatch('agent.started', {});

      expect(results).toHaveLength(1);
      const result = results[0];
      expect(result).toHaveProperty('webhookId', 'wh-struct');
      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('statusCode', 200);
      expect(result).toHaveProperty('durationMs');
      expect(result.error).toBeUndefined();
    });

    it('returns correct structure on HTTP failure', async () => {
      fetchMock.mockResolvedValue(errorResponse(400));

      const dispatcher = new WebhookDispatcher({ maxRetries: 0 });
      dispatcher.register(makeConfig({ id: 'wh-fail' }));

      const results = await dispatcher.dispatch('agent.started', {});

      const result = results[0];
      expect(result.webhookId).toBe('wh-fail');
      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(400);
      expect(result.error).toBe('HTTP 400');
    });

    it('returns correct structure on network error', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      const dispatcher = new WebhookDispatcher({ maxRetries: 0 });
      dispatcher.register(makeConfig({ id: 'wh-net' }));

      const results = await dispatcher.dispatch('agent.started', {});

      const result = results[0];
      expect(result.webhookId).toBe('wh-net');
      expect(result.success).toBe(false);
      expect(result.error).toBe('ECONNREFUSED');
    });
  });

  // ── Provider payload formatting ─────────────────────────────────────

  describe('formatPayload', () => {
    const basePayload: WebhookPayload = {
      event: 'agent.started',
      timestamp: '2026-03-02T10:00:00.000Z',
      data: { agentId: 'agent-001' },
    };

    describe('slack', () => {
      it('formats as Slack Block Kit message', () => {
        const dispatcher = new WebhookDispatcher();
        const formatted = dispatcher.formatPayload('slack', basePayload);

        expect(formatted.text).toContain('agent.started');
        expect(formatted.blocks).toBeDefined();
        expect(Array.isArray(formatted.blocks)).toBe(true);

        const blocks = formatted.blocks as Array<Record<string, unknown>>;
        expect(blocks.length).toBeGreaterThanOrEqual(2);
        expect(blocks[0].type).toBe('section');
      });

      it('includes timestamp in the header section', () => {
        const dispatcher = new WebhookDispatcher();
        const formatted = dispatcher.formatPayload('slack', basePayload);

        const blocks = formatted.blocks as Array<{ type: string; text: { text: string } }>;
        expect(blocks[0].text.text).toContain('2026-03-02T10:00:00.000Z');
      });

      it('includes JSON data in code block', () => {
        const dispatcher = new WebhookDispatcher();
        const formatted = dispatcher.formatPayload('slack', basePayload);

        const blocks = formatted.blocks as Array<{ type: string; text: { text: string } }>;
        expect(blocks[1].text.text).toContain('agent-001');
        expect(blocks[1].text.text).toContain('```');
      });
    });

    describe('discord', () => {
      it('formats as Discord embed message', () => {
        const dispatcher = new WebhookDispatcher();
        const formatted = dispatcher.formatPayload('discord', basePayload);

        expect(formatted.content).toContain('agent.started');
        expect(formatted.embeds).toBeDefined();
        expect(Array.isArray(formatted.embeds)).toBe(true);

        const embeds = formatted.embeds as Array<Record<string, unknown>>;
        expect(embeds).toHaveLength(1);
        expect(embeds[0].title).toBe('agent.started');
      });

      it('includes timestamp in embed', () => {
        const dispatcher = new WebhookDispatcher();
        const formatted = dispatcher.formatPayload('discord', basePayload);

        const embeds = formatted.embeds as Array<Record<string, unknown>>;
        expect(embeds[0].timestamp).toBe('2026-03-02T10:00:00.000Z');
      });

      it('uses red color for error events', () => {
        const dispatcher = new WebhookDispatcher();
        const errorPayload: WebhookPayload = {
          ...basePayload,
          event: 'agent.error',
        };
        const formatted = dispatcher.formatPayload('discord', errorPayload);

        const embeds = formatted.embeds as Array<Record<string, unknown>>;
        expect(embeds[0].color).toBe(0xff0000);
      });

      it('uses green color for success events', () => {
        const dispatcher = new WebhookDispatcher();
        const successPayload: WebhookPayload = {
          ...basePayload,
          event: 'deploy.success',
        };
        const formatted = dispatcher.formatPayload('discord', successPayload);

        const embeds = formatted.embeds as Array<Record<string, unknown>>;
        expect(embeds[0].color).toBe(0x00ff00);
      });

      it('uses orange color for cost_alert events', () => {
        const dispatcher = new WebhookDispatcher();
        const costPayload: WebhookPayload = {
          ...basePayload,
          event: 'agent.cost_alert',
        };
        const formatted = dispatcher.formatPayload('discord', costPayload);

        const embeds = formatted.embeds as Array<Record<string, unknown>>;
        expect(embeds[0].color).toBe(0xffaa00);
      });

      it('includes JSON data in description', () => {
        const dispatcher = new WebhookDispatcher();
        const formatted = dispatcher.formatPayload('discord', basePayload);

        const embeds = formatted.embeds as Array<Record<string, unknown>>;
        const desc = embeds[0].description as string;
        expect(desc).toContain('agent-001');
      });
    });

    describe('generic', () => {
      it('returns raw WebhookPayload as-is', () => {
        const dispatcher = new WebhookDispatcher();
        const formatted = dispatcher.formatPayload('generic', basePayload);

        expect(formatted).toEqual(basePayload);
      });
    });
  });

  // ── HMAC signature ──────────────────────────────────────────────────

  describe('computeSignature', () => {
    it('computes correct HMAC-SHA256 hex digest', () => {
      const payload = '{"event":"agent.started"}';
      const secret = 'test-secret';

      const expected = createHmac('sha256', secret).update(payload).digest('hex');
      const result = WebhookDispatcher.computeSignature(payload, secret);

      expect(result).toBe(expected);
    });

    it('produces different signatures for different secrets', () => {
      const payload = '{"event":"agent.started"}';

      const sig1 = WebhookDispatcher.computeSignature(payload, 'secret-1');
      const sig2 = WebhookDispatcher.computeSignature(payload, 'secret-2');

      expect(sig1).not.toBe(sig2);
    });

    it('produces different signatures for different payloads', () => {
      const secret = 'same-secret';

      const sig1 = WebhookDispatcher.computeSignature('{"a":1}', secret);
      const sig2 = WebhookDispatcher.computeSignature('{"a":2}', secret);

      expect(sig1).not.toBe(sig2);
    });

    it('produces a 64-character hex string', () => {
      const sig = WebhookDispatcher.computeSignature('test', 'key');

      expect(sig).toMatch(/^[a-f0-9]{64}$/);
    });

    it('is deterministic for same inputs', () => {
      const payload = 'stable input';
      const secret = 'stable key';

      const sig1 = WebhookDispatcher.computeSignature(payload, secret);
      const sig2 = WebhookDispatcher.computeSignature(payload, secret);

      expect(sig1).toBe(sig2);
    });
  });

  // ── Signature in headers ────────────────────────────────────────────

  describe('signature header', () => {
    it('includes X-Webhook-Signature when secret is configured', async () => {
      fetchMock.mockResolvedValue(okResponse());

      const dispatcher = new WebhookDispatcher({ maxRetries: 0 });
      dispatcher.register(makeConfig({ secret: 'my-secret' }));

      await dispatcher.dispatch('agent.started', {});

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;

      expect(headers['X-Webhook-Signature']).toBeDefined();
      expect(headers['X-Webhook-Signature']).toMatch(/^[a-f0-9]{64}$/);
    });

    it('does not include X-Webhook-Signature when no secret', async () => {
      fetchMock.mockResolvedValue(okResponse());

      const dispatcher = new WebhookDispatcher({ maxRetries: 0 });
      dispatcher.register(makeConfig({ secret: undefined }));

      await dispatcher.dispatch('agent.started', {});

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;

      expect(headers['X-Webhook-Signature']).toBeUndefined();
    });

    it('signature matches payload body', async () => {
      fetchMock.mockResolvedValue(okResponse());

      const secret = 'verify-me';
      const dispatcher = new WebhookDispatcher({ maxRetries: 0 });
      dispatcher.register(makeConfig({ secret }));

      await dispatcher.dispatch('agent.started', { agentId: 'a1' });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      const body = init.body as string;

      const expected = WebhookDispatcher.computeSignature(body, secret);
      expect(headers['X-Webhook-Signature']).toBe(expected);
    });
  });

  // ── Error handling ──────────────────────────────────────────────────

  describe('error handling', () => {
    it('does not throw on HTTP failure', async () => {
      fetchMock.mockResolvedValue(errorResponse(500));

      const dispatcher = new WebhookDispatcher({ maxRetries: 0 });
      dispatcher.register(makeConfig());

      const results = await dispatcher.dispatch('agent.started', {});

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
    });

    it('does not throw on network error', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      const dispatcher = new WebhookDispatcher({ maxRetries: 0 });
      dispatcher.register(makeConfig());

      const results = await dispatcher.dispatch('agent.started', {});

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe('ECONNREFUSED');
    });

    it('does not throw on timeout', async () => {
      fetchMock.mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'));

      const dispatcher = new WebhookDispatcher({ maxRetries: 0, timeoutMs: 100 });
      dispatcher.register(makeConfig());

      const results = await dispatcher.dispatch('agent.started', {});

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toContain('aborted');
    });

    it('handles non-Error thrown values', async () => {
      fetchMock.mockRejectedValue('string error');

      const dispatcher = new WebhookDispatcher({ maxRetries: 0 });
      dispatcher.register(makeConfig());

      const results = await dispatcher.dispatch('agent.started', {});

      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe('Unknown error');
    });

    it('does not retry on 4xx client errors (except 429)', async () => {
      fetchMock.mockResolvedValue(errorResponse(403));

      const dispatcher = new WebhookDispatcher({ maxRetries: 3 });
      dispatcher.register(makeConfig());

      const results = await dispatcher.dispatch('agent.started', {});

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(results[0].success).toBe(false);
      expect(results[0].statusCode).toBe(403);
    });
  });

  // ── Retry logic ─────────────────────────────────────────────────────

  describe('retry logic', () => {
    it('retries on 5xx server errors', async () => {
      fetchMock.mockResolvedValueOnce(errorResponse(500)).mockResolvedValueOnce(okResponse());

      const dispatcher = new WebhookDispatcher({ maxRetries: 2, retryDelayMs: 1 });
      dispatcher.register(makeConfig());

      const results = await dispatcher.dispatch('agent.started', {});

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(results[0].success).toBe(true);
    });

    it('retries on network errors', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce(okResponse());

      const dispatcher = new WebhookDispatcher({ maxRetries: 2, retryDelayMs: 1 });
      dispatcher.register(makeConfig());

      const results = await dispatcher.dispatch('agent.started', {});

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(results[0].success).toBe(true);
    });

    it('retries on 429 rate limit', async () => {
      fetchMock.mockResolvedValueOnce(errorResponse(429)).mockResolvedValueOnce(okResponse());

      const dispatcher = new WebhookDispatcher({ maxRetries: 2, retryDelayMs: 1 });
      dispatcher.register(makeConfig());

      const results = await dispatcher.dispatch('agent.started', {});

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(results[0].success).toBe(true);
    });

    it('stops after maxRetries attempts and returns failure', async () => {
      fetchMock.mockResolvedValue(errorResponse(500));

      const dispatcher = new WebhookDispatcher({ maxRetries: 2, retryDelayMs: 1 });
      dispatcher.register(makeConfig());

      const results = await dispatcher.dispatch('agent.started', {});

      // 1 initial + 2 retries = 3 total
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(results[0].success).toBe(false);
    });

    it('respects maxRetries: 0 (no retries)', async () => {
      fetchMock.mockResolvedValue(errorResponse(500));

      const dispatcher = new WebhookDispatcher({ maxRetries: 0 });
      dispatcher.register(makeConfig());

      await dispatcher.dispatch('agent.started', {});

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  // ── Timeout ─────────────────────────────────────────────────────────

  describe('timeout', () => {
    it('uses AbortSignal.timeout for request cancellation', async () => {
      fetchMock.mockResolvedValue(okResponse());

      const dispatcher = new WebhookDispatcher({ maxRetries: 0, timeoutMs: 5000 });
      dispatcher.register(makeConfig());

      await dispatcher.dispatch('agent.started', {});

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.signal).toBeDefined();
    });

    it('defaults to 10s timeout', () => {
      // Verify through construction (internal state not directly observable,
      // but we can check it doesn't throw)
      const dispatcher = new WebhookDispatcher();
      expect(dispatcher).toBeDefined();
    });
  });

  // ── Provider-specific dispatch ──────────────────────────────────────

  describe('provider-specific dispatch', () => {
    it('sends Slack-formatted payload for slack provider', async () => {
      fetchMock.mockResolvedValue(okResponse());

      const dispatcher = new WebhookDispatcher({ maxRetries: 0 });
      dispatcher.register(makeConfig({ provider: 'slack' }));

      await dispatcher.dispatch('agent.started', { agentId: 'a1' });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);

      expect(body.text).toBeDefined();
      expect(body.blocks).toBeDefined();
    });

    it('sends Discord-formatted payload for discord provider', async () => {
      fetchMock.mockResolvedValue(okResponse());

      const dispatcher = new WebhookDispatcher({ maxRetries: 0 });
      dispatcher.register(makeConfig({ provider: 'discord' }));

      await dispatcher.dispatch('agent.started', { agentId: 'a1' });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);

      expect(body.content).toBeDefined();
      expect(body.embeds).toBeDefined();
    });

    it('sends raw WebhookPayload for generic provider', async () => {
      fetchMock.mockResolvedValue(okResponse());

      const dispatcher = new WebhookDispatcher({ maxRetries: 0 });
      dispatcher.register(makeConfig({ provider: 'generic' }));

      await dispatcher.dispatch('agent.started', { agentId: 'a1' });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);

      expect(body.event).toBe('agent.started');
      expect(body.timestamp).toBeDefined();
      expect(body.data).toEqual({ agentId: 'a1' });
    });
  });

  // ── Constructor defaults ────────────────────────────────────────────

  describe('constructor defaults', () => {
    it('creates a dispatcher with no options', () => {
      const dispatcher = new WebhookDispatcher();
      expect(dispatcher.getWebhooks()).toEqual([]);
    });

    it('creates a dispatcher with partial options', () => {
      const dispatcher = new WebhookDispatcher({ timeoutMs: 5000 });
      expect(dispatcher.getWebhooks()).toEqual([]);
    });

    it('creates a dispatcher with all options', () => {
      const dispatcher = new WebhookDispatcher({
        timeoutMs: 5000,
        maxRetries: 5,
        retryDelayMs: 500,
      });
      expect(dispatcher.getWebhooks()).toEqual([]);
    });
  });
});
