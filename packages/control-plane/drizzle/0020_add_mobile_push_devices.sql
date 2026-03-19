-- AgentCTL Migration: mobile push device registry for approval push notifications

CREATE TABLE IF NOT EXISTS "mobile_push_devices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" text NOT NULL,
  "platform" text NOT NULL,
  "provider" text NOT NULL,
  "push_token" text NOT NULL,
  "app_id" text NOT NULL,
  "last_seen_at" timestamptz NOT NULL DEFAULT now(),
  "disabled_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "mobile_push_devices"
  ADD CONSTRAINT "uq_mobile_push_devices_provider_token" UNIQUE ("provider", "push_token");

CREATE INDEX IF NOT EXISTS "idx_mobile_push_devices_user_id"
  ON "mobile_push_devices"("user_id");

CREATE INDEX IF NOT EXISTS "idx_mobile_push_devices_updated_at"
  ON "mobile_push_devices"("updated_at");

CREATE INDEX IF NOT EXISTS "idx_mobile_push_devices_disabled_at"
  ON "mobile_push_devices"("disabled_at");
