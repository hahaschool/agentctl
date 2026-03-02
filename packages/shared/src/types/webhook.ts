export type WebhookProvider = 'slack' | 'discord' | 'generic';

export type WebhookEventType =
  | 'agent.started'
  | 'agent.stopped'
  | 'agent.error'
  | 'agent.cost_alert'
  | 'deploy.success'
  | 'deploy.failure'
  | 'audit.high_severity';

export const WEBHOOK_EVENT_TYPES = [
  'agent.started',
  'agent.stopped',
  'agent.error',
  'agent.cost_alert',
  'deploy.success',
  'deploy.failure',
  'audit.high_severity',
] as const;

export const WEBHOOK_PROVIDERS = ['slack', 'discord', 'generic'] as const;

export type WebhookConfig = {
  /** Unique identifier for this webhook. */
  id: string;
  /** The provider type determines payload formatting. */
  provider: WebhookProvider;
  /** The URL to deliver webhook payloads to. */
  url: string;
  /** Events this webhook subscribes to. */
  events: WebhookEventType[];
  /** Whether this webhook is active. */
  enabled: boolean;
  /** Optional secret for HMAC-SHA256 signature verification. */
  secret?: string;
};

export type WebhookPayload = {
  /** The event type that triggered this webhook delivery. */
  event: WebhookEventType;
  /** ISO 8601 timestamp of when the event occurred. */
  timestamp: string;
  /** Event-specific data. */
  data: Record<string, unknown>;
};
