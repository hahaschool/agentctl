-- AgentCTL Migration: Add schedule_config to agents table
-- Phase 8.1: Scheduled Sessions with prompt templates

ALTER TABLE "agents" ADD COLUMN "schedule_config" jsonb DEFAULT NULL;
