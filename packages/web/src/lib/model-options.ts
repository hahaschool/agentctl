/**
 * Shared model option constants used across the web UI.
 *
 * Centralised here so that adding/removing a model only requires one file change.
 */

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
