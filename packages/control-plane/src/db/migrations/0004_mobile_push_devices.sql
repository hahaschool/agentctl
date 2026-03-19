-- Migration: 21.2 mobile push device registry
-- Adds Expo/iOS device registration support for approval.pending delivery

BEGIN;

CREATE TABLE IF NOT EXISTS mobile_push_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios')),
  provider TEXT NOT NULL CHECK (provider IN ('expo')),
  push_token TEXT NOT NULL,
  app_id TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mobile_push_devices_provider_token
  ON mobile_push_devices(provider, push_token);

CREATE INDEX IF NOT EXISTS idx_mobile_push_devices_user_id
  ON mobile_push_devices(user_id);

CREATE INDEX IF NOT EXISTS idx_mobile_push_devices_disabled_at
  ON mobile_push_devices(disabled_at);

COMMIT;
