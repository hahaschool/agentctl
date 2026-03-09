/**
 * Shared model option constants used across the web UI.
 *
 * Centralised here so that adding/removing a model only requires one file change.
 */

import { AGENT_RUNTIMES } from '@agentctl/shared';
export type { AgentRuntime } from '@agentctl/shared';
export { AGENT_RUNTIMES };

export type ModelOption = {
  readonly value: string;
  readonly label: string;
  readonly tier?: string;
};

/** All available Claude models — most capable first. */
export const ALL_MODELS: readonly ModelOption[] = [
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6', tier: 'flagship' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', tier: 'balanced' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', tier: 'fast' },
  { value: 'claude-sonnet-4-5-20250514', label: 'Claude Sonnet 4.5', tier: 'balanced' },
  { value: 'claude-opus-4-0-20250514', label: 'Claude Opus 4', tier: 'flagship' },
  { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', tier: 'balanced' },
] as const;

/** Latest-generation models only (no legacy versions). */
export const LATEST_MODELS: readonly ModelOption[] = ALL_MODELS.slice(0, 3);

/** Model selector with a "Default" empty-value option — for session/fork creation. */
export const MODEL_OPTIONS_WITH_DEFAULT: readonly ModelOption[] = [
  { value: '', label: 'Default' },
  ...LATEST_MODELS,
] as const;

/** Resume model selector — empty means "keep current". */
export const RESUME_MODEL_OPTIONS: readonly ModelOption[] = [
  { value: '', label: 'Keep current model' },
  ...LATEST_MODELS,
] as const;

// ---------------------------------------------------------------------------
// Agent types
// ---------------------------------------------------------------------------

export type AgentTypeOption = {
  readonly value: string;
  readonly label: string;
  readonly desc: string;
};

/** All agent types available for agent creation/editing. */
export const AGENT_TYPES: readonly AgentTypeOption[] = [
  { value: 'adhoc', label: 'Ad-hoc', desc: 'One-shot task, runs once then stops' },
  { value: 'manual', label: 'Manual', desc: 'Started/stopped manually, persistent config' },
  { value: 'loop', label: 'Loop', desc: 'Runs in a loop until stopped or goal met' },
  { value: 'heartbeat', label: 'Heartbeat', desc: 'Triggered periodically (e.g. every 30min)' },
  { value: 'cron', label: 'Cron', desc: 'Triggered on a cron schedule' },
] as const;

/** Subset of agent types for fork/convert (excludes heartbeat/cron). */
export const FORK_AGENT_TYPES: readonly AgentTypeOption[] = AGENT_TYPES.filter(
  (t) => t.value !== 'heartbeat' && t.value !== 'cron',
);

/** Default model for new agents. */
export const DEFAULT_MODEL = 'claude-sonnet-4-6';
