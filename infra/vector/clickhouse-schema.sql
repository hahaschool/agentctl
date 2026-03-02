-- =============================================================================
-- AgentCTL — ClickHouse Schema for the Vector Logging Pipeline
-- Run once against the ClickHouse instance to bootstrap tables.
-- =============================================================================

CREATE DATABASE IF NOT EXISTS agentctl;

-- -----------------------------------------------------------------------------
-- audit_logs — tamper-evident chain of every tool invocation by every agent.
-- Partitioned monthly, ordered by (agent_id, timestamp) for fast per-agent
-- queries, retained for 90 days.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agentctl.audit_logs (
  timestamp      DateTime64(3),
  agent_id       String,
  machine_id     String,
  task_id        String,
  tool           String,
  action         String,
  status         String,
  duration_ms    Float64,
  hash           String,
  previous_hash  String,
  metadata       String
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (agent_id, timestamp)
TTL timestamp + INTERVAL 90 DAY;

-- -----------------------------------------------------------------------------
-- app_logs — general application / service logs (control-plane, workers, etc.)
-- Partitioned monthly, ordered by (service, timestamp), retained for 30 days.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS agentctl.app_logs (
  timestamp    DateTime64(3),
  level        String,
  service      String,
  hostname     String,
  environment  String,
  message      String,
  metadata     String
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (service, timestamp)
TTL timestamp + INTERVAL 30 DAY;
