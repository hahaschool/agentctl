import { createHmac } from 'node:crypto';

import type {
  WebhookConfig,
  WebhookEventType,
  WebhookPayload,
  WebhookProvider,
} from '@agentctl/shared';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 1_000;

export type WebhookDispatcherOptions = {
  /** Timeout per HTTP request in milliseconds. Defaults to 10 000. */
  timeoutMs?: number;
  /** Maximum number of retry attempts on failure. Defaults to 3. */
  maxRetries?: number;
  /** Base delay between retries in milliseconds (exponential backoff). Defaults to 1 000. */
  retryDelayMs?: number;
};

export type WebhookDeliveryResult = {
  webhookId: string;
  success: boolean;
  statusCode?: number;
  error?: string;
  durationMs: number;
};

export class WebhookDispatcher {
  private readonly webhooks = new Map<string, WebhookConfig>();
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(options?: WebhookDispatcherOptions) {
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = options?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  /** Register a webhook configuration. */
  register(config: WebhookConfig): void {
    this.webhooks.set(config.id, { ...config });
  }

  /** Remove a webhook by ID. */
  unregister(webhookId: string): void {
    this.webhooks.delete(webhookId);
  }

  /** Get all registered webhooks. */
  getWebhooks(): WebhookConfig[] {
    return [...this.webhooks.values()];
  }

  /**
   * Dispatch an event to all matching webhooks.
   *
   * A webhook matches when it is enabled and its `events` array includes the
   * given event type. Delivery failures are captured in the result array and
   * never thrown.
   */
  async dispatch(
    event: WebhookEventType,
    data: Record<string, unknown>,
  ): Promise<WebhookDeliveryResult[]> {
    const matching = [...this.webhooks.values()].filter(
      (w) => w.enabled && w.events.includes(event),
    );

    if (matching.length === 0) {
      return [];
    }

    const payload: WebhookPayload = {
      event,
      timestamp: new Date().toISOString(),
      data,
    };

    const results = await Promise.all(
      matching.map((webhook) => this.deliverWithRetry(webhook, payload)),
    );

    return results;
  }

  /**
   * Format a {@link WebhookPayload} for a specific provider.
   *
   * - **slack**: Slack Block Kit message with a header section and JSON data.
   * - **discord**: Discord embed with title, description, and timestamp.
   * - **generic**: Raw {@link WebhookPayload} JSON.
   */
  formatPayload(provider: WebhookProvider, payload: WebhookPayload): Record<string, unknown> {
    switch (provider) {
      case 'slack':
        return this.formatSlackPayload(payload);
      case 'discord':
        return this.formatDiscordPayload(payload);
      case 'generic':
        return payload as unknown as Record<string, unknown>;
    }
  }

  /**
   * Compute an HMAC-SHA256 signature for webhook verification.
   *
   * The signature is a hex-encoded digest of the payload string signed with
   * the given secret.
   */
  static computeSignature(payload: string, secret: string): string {
    return createHmac('sha256', secret).update(payload).digest('hex');
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private formatSlackPayload(payload: WebhookPayload): Record<string, unknown> {
    const emoji = this.eventEmoji(payload.event);
    const summary = `${emoji} ${payload.event}`;

    return {
      text: summary,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${summary}*\n_${payload.timestamp}_`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `\`\`\`${JSON.stringify(payload.data, null, 2)}\`\`\``,
          },
        },
      ],
    };
  }

  private formatDiscordPayload(payload: WebhookPayload): Record<string, unknown> {
    const emoji = this.eventEmoji(payload.event);

    return {
      content: `${emoji} **${payload.event}**`,
      embeds: [
        {
          title: payload.event,
          description: `\`\`\`json\n${JSON.stringify(payload.data, null, 2)}\n\`\`\``,
          timestamp: payload.timestamp,
          color: this.eventColor(payload.event),
        },
      ],
    };
  }

  private eventEmoji(event: WebhookEventType): string {
    const map: Record<WebhookEventType, string> = {
      'agent.started': '[STARTED]',
      'agent.stopped': '[STOPPED]',
      'agent.error': '[ERROR]',
      'agent.cost_alert': '[COST]',
      'deploy.success': '[DEPLOY OK]',
      'deploy.failure': '[DEPLOY FAIL]',
      'audit.high_severity': '[AUDIT]',
    };
    return map[event];
  }

  private eventColor(event: WebhookEventType): number {
    if (event.includes('error') || event.includes('failure') || event.includes('high_severity')) {
      return 0xff0000; // red
    }
    if (event.includes('success') || event.includes('started')) {
      return 0x00ff00; // green
    }
    if (event.includes('cost_alert')) {
      return 0xffaa00; // orange
    }
    return 0x0099ff; // blue
  }

  private async deliverWithRetry(
    webhook: WebhookConfig,
    payload: WebhookPayload,
  ): Promise<WebhookDeliveryResult> {
    const formattedBody = this.formatPayload(webhook.provider, payload);
    const bodyStr = JSON.stringify(formattedBody);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (webhook.secret) {
      headers['X-Webhook-Signature'] = WebhookDispatcher.computeSignature(bodyStr, webhook.secret);
    }

    let lastError: string | undefined;
    let lastStatusCode: number | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = this.retryDelayMs * 2 ** (attempt - 1);
        await this.sleep(delay);
      }

      const start = Date.now();

      try {
        const response = await fetch(webhook.url, {
          method: 'POST',
          headers,
          body: bodyStr,
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        const durationMs = Date.now() - start;

        if (response.ok) {
          return {
            webhookId: webhook.id,
            success: true,
            statusCode: response.status,
            durationMs,
          };
        }

        lastStatusCode = response.status;
        lastError = `HTTP ${response.status}`;

        // Don't retry on 4xx client errors (except 429 rate limit)
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          return {
            webhookId: webhook.id,
            success: false,
            statusCode: response.status,
            error: lastError,
            durationMs,
          };
        }
      } catch (err: unknown) {
        const durationMs = Date.now() - start;
        lastError = err instanceof Error ? err.message : 'Unknown error';

        // If this was the last attempt, return the failure
        if (attempt === this.maxRetries) {
          return {
            webhookId: webhook.id,
            success: false,
            statusCode: lastStatusCode,
            error: lastError,
            durationMs,
          };
        }
      }
    }

    // Fallback (should not be reached due to loop logic above)
    return {
      webhookId: webhook.id,
      success: false,
      statusCode: lastStatusCode,
      error: lastError ?? 'Max retries exceeded',
      durationMs: 0,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
