// ---------------------------------------------------------------------------
// Webhooks — subscriptions + delivery history + test fire.
// ---------------------------------------------------------------------------

import { request } from './core';

export type WebhookProvider = 'slack' | 'discord' | 'generic';

export type WebhookEventType =
  | 'agent.started'
  | 'agent.stopped'
  | 'agent.error'
  | 'agent.cost_alert'
  | 'approval.pending'
  | 'deploy.success'
  | 'deploy.failure'
  | 'audit.high_severity';

export const WEBHOOK_PROVIDERS: readonly WebhookProvider[] = [
  'slack',
  'discord',
  'generic',
] as const;

export const WEBHOOK_EVENT_TYPES: readonly WebhookEventType[] = [
  'agent.started',
  'agent.stopped',
  'agent.error',
  'agent.cost_alert',
  'approval.pending',
  'deploy.success',
  'deploy.failure',
  'audit.high_severity',
] as const;

export type Webhook = {
  id: string;
  url: string;
  provider: WebhookProvider;
  /** Masked to `****` or null — the real secret is never returned by the API. */
  secret: string | null;
  eventTypes: WebhookEventType[];
  agentFilter: string[] | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WebhooksResponse = {
  subscriptions: Webhook[];
  limit: number;
  offset: number;
};

export type CreateWebhookInput = {
  url: string;
  provider?: WebhookProvider;
  secret?: string;
  eventTypes: WebhookEventType[];
  agentFilter?: string[];
};

export type UpdateWebhookInput = {
  url?: string;
  provider?: WebhookProvider;
  secret?: string | null;
  eventTypes?: WebhookEventType[];
  agentFilter?: string[] | null;
  active?: boolean;
};

export type WebhookDeliveryStatus = 'pending' | 'delivered' | 'failed';

export type WebhookDelivery = {
  id: string;
  subscriptionId: string;
  eventType: string;
  status: WebhookDeliveryStatus | string;
  statusCode: number | null;
  responseBody: string | null;
  payload?: Record<string, unknown> | null;
  attempts?: number | null;
  nextRetryAt?: string | null;
  createdAt: string;
  deliveredAt: string | null;
};

export type WebhookDeliveriesResponse = {
  deliveries: WebhookDelivery[];
};

export type TestWebhookResponse = {
  ok: boolean;
  delivery: WebhookDelivery;
};

export const webhooksApi = {
  listWebhooks: () => request<WebhooksResponse>('/api/webhooks'),

  createWebhook: (input: CreateWebhookInput) =>
    request<{ ok: boolean; subscription: Webhook }>('/api/webhooks', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateWebhook: (id: string, input: UpdateWebhookInput) =>
    request<{ ok: boolean; subscription: Webhook }>(`/api/webhooks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  deleteWebhook: (id: string) =>
    request<{ ok: boolean; deletedId: string }>(`/api/webhooks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  testWebhook: (id: string) =>
    request<TestWebhookResponse>(`/api/webhooks/${encodeURIComponent(id)}/test`, {
      method: 'POST',
    }),

  listWebhookDeliveries: (id: string) =>
    request<WebhookDeliveriesResponse>(`/api/webhooks/${encodeURIComponent(id)}/deliveries`),
};
