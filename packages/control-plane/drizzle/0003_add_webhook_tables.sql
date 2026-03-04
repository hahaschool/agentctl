-- AgentCTL Migration: Add webhook subscription and delivery tracking tables
-- Phase 6: Observability — webhook management

CREATE TABLE IF NOT EXISTS "webhook_subscriptions" (
  "id" text PRIMARY KEY,
  "url" text NOT NULL,
  "provider" text NOT NULL DEFAULT 'generic',
  "secret" text,
  "event_types" text[] NOT NULL,
  "agent_filter" text[],
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
  "id" text PRIMARY KEY,
  "subscription_id" text NOT NULL REFERENCES "webhook_subscriptions"("id"),
  "event_type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "status_code" integer,
  "response_body" text,
  "attempts" integer NOT NULL DEFAULT 0,
  "next_retry_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "delivered_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "idx_webhook_deliveries_subscription" ON "webhook_deliveries"("subscription_id");
CREATE INDEX IF NOT EXISTS "idx_webhook_deliveries_status" ON "webhook_deliveries"("status");
