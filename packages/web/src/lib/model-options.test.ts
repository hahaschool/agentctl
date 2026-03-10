import { describe, expect, it } from 'vitest';

import {
  AGENT_TYPES,
  ALL_MODELS,
  CODEX_MODELS,
  DEFAULT_MODEL,
  DEFAULT_RUNTIME_MODELS,
  FORK_AGENT_TYPES,
  LATEST_MODELS,
  MODEL_OPTIONS_WITH_DEFAULT,
  RESUME_MODEL_OPTIONS,
  RUNTIME_MODEL_OPTIONS,
} from './model-options';

// ---------------------------------------------------------------------------
// ALL_MODELS
// ---------------------------------------------------------------------------

describe('ALL_MODELS', () => {
  it('is a non-empty array', () => {
    expect(ALL_MODELS.length).toBeGreaterThan(0);
  });

  it('each option has label and value properties', () => {
    for (const opt of ALL_MODELS) {
      expect(typeof opt.value).toBe('string');
      expect(typeof opt.label).toBe('string');
      expect(opt.value.length).toBeGreaterThan(0);
      expect(opt.label.length).toBeGreaterThan(0);
    }
  });

  it('all values are unique', () => {
    const values = ALL_MODELS.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it('contains known models', () => {
    const values = ALL_MODELS.map((o) => o.value);
    expect(values).toContain('claude-opus-4-6');
    expect(values).toContain('claude-sonnet-4-6');
    expect(values).toContain('claude-haiku-4-5');
    expect(values).toContain('claude-sonnet-4-5-20250514');
    expect(values).toContain('claude-opus-4-0-20250514');
    expect(values).toContain('claude-sonnet-4-20250514');
  });

  it('each option has a tier', () => {
    for (const opt of ALL_MODELS) {
      expect(['flagship', 'balanced', 'fast']).toContain(opt.tier);
    }
  });
});

// ---------------------------------------------------------------------------
// LATEST_MODELS
// ---------------------------------------------------------------------------

describe('LATEST_MODELS', () => {
  it('contains only the first 3 models from ALL_MODELS', () => {
    expect(LATEST_MODELS).toHaveLength(3);
    expect(LATEST_MODELS[0]).toBe(ALL_MODELS[0]);
    expect(LATEST_MODELS[1]).toBe(ALL_MODELS[1]);
    expect(LATEST_MODELS[2]).toBe(ALL_MODELS[2]);
  });
});

// ---------------------------------------------------------------------------
// MODEL_OPTIONS_WITH_DEFAULT
// ---------------------------------------------------------------------------

describe('MODEL_OPTIONS_WITH_DEFAULT', () => {
  it('has a default option at index 0 with empty value', () => {
    expect(MODEL_OPTIONS_WITH_DEFAULT[0]?.value).toBe('');
    expect(MODEL_OPTIONS_WITH_DEFAULT[0]?.label).toBe('Default');
  });

  it('includes LATEST_MODELS after the default option', () => {
    const withoutDefault = MODEL_OPTIONS_WITH_DEFAULT.slice(1);
    expect(withoutDefault).toHaveLength(LATEST_MODELS.length);
    for (let i = 0; i < LATEST_MODELS.length; i++) {
      expect(withoutDefault[i]?.value).toBe(LATEST_MODELS[i]?.value);
      expect(withoutDefault[i]?.label).toBe(LATEST_MODELS[i]?.label);
    }
  });

  it('has length = LATEST_MODELS.length + 1', () => {
    expect(MODEL_OPTIONS_WITH_DEFAULT).toHaveLength(LATEST_MODELS.length + 1);
  });
});

// ---------------------------------------------------------------------------
// RESUME_MODEL_OPTIONS
// ---------------------------------------------------------------------------

describe('RESUME_MODEL_OPTIONS', () => {
  it('has a "Keep current model" option at index 0 with empty value', () => {
    expect(RESUME_MODEL_OPTIONS[0]?.value).toBe('');
    expect(RESUME_MODEL_OPTIONS[0]?.label).toBe('Keep current model');
  });

  it('includes LATEST_MODELS after the placeholder option', () => {
    const withoutPlaceholder = RESUME_MODEL_OPTIONS.slice(1);
    expect(withoutPlaceholder).toHaveLength(LATEST_MODELS.length);
    for (let i = 0; i < LATEST_MODELS.length; i++) {
      expect(withoutPlaceholder[i]?.value).toBe(LATEST_MODELS[i]?.value);
    }
  });
});

// ---------------------------------------------------------------------------
// AGENT_TYPES
// ---------------------------------------------------------------------------

describe('AGENT_TYPES', () => {
  it('is a non-empty array', () => {
    expect(AGENT_TYPES.length).toBeGreaterThan(0);
  });

  it('each option has value, label, and desc', () => {
    for (const opt of AGENT_TYPES) {
      expect(typeof opt.value).toBe('string');
      expect(typeof opt.label).toBe('string');
      expect(typeof opt.desc).toBe('string');
      expect(opt.value.length).toBeGreaterThan(0);
      expect(opt.label.length).toBeGreaterThan(0);
      expect(opt.desc.length).toBeGreaterThan(0);
    }
  });

  it('all values are unique', () => {
    const values = AGENT_TYPES.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it('contains known agent types', () => {
    const values = AGENT_TYPES.map((o) => o.value);
    expect(values).toContain('adhoc');
    expect(values).toContain('manual');
    expect(values).toContain('loop');
    expect(values).toContain('heartbeat');
    expect(values).toContain('cron');
  });
});

// ---------------------------------------------------------------------------
// FORK_AGENT_TYPES
// ---------------------------------------------------------------------------

describe('FORK_AGENT_TYPES', () => {
  it('excludes heartbeat and cron', () => {
    const values = FORK_AGENT_TYPES.map((o) => o.value);
    expect(values).not.toContain('heartbeat');
    expect(values).not.toContain('cron');
  });

  it('includes adhoc, manual, and loop', () => {
    const values = FORK_AGENT_TYPES.map((o) => o.value);
    expect(values).toContain('adhoc');
    expect(values).toContain('manual');
    expect(values).toContain('loop');
  });

  it('is a strict subset of AGENT_TYPES', () => {
    const allValues = new Set(AGENT_TYPES.map((o) => o.value));
    for (const opt of FORK_AGENT_TYPES) {
      expect(allValues.has(opt.value)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_MODEL
// ---------------------------------------------------------------------------

describe('DEFAULT_MODEL', () => {
  it('is a string present in ALL_MODELS', () => {
    expect(typeof DEFAULT_MODEL).toBe('string');
    const values = ALL_MODELS.map((o) => o.value);
    expect(values).toContain(DEFAULT_MODEL);
  });

  it('equals claude-sonnet-4-6', () => {
    expect(DEFAULT_MODEL).toBe('claude-sonnet-4-6');
  });
});

// ---------------------------------------------------------------------------
// Runtime-specific models
// ---------------------------------------------------------------------------

describe('RUNTIME_MODEL_OPTIONS', () => {
  it('includes runtime-specific groups for claude-code and codex', () => {
    expect(RUNTIME_MODEL_OPTIONS['claude-code']).toBeDefined();
    expect(RUNTIME_MODEL_OPTIONS.codex).toBeDefined();
  });

  it('includes GPT-5 Codex in the codex runtime group', () => {
    const values = RUNTIME_MODEL_OPTIONS.codex.map((o) => o.value);
    expect(values).toContain('gpt-5-codex');
  });
});

describe('CODEX_MODELS', () => {
  it('is non-empty and contains GPT-5 Codex', () => {
    expect(CODEX_MODELS.length).toBeGreaterThan(0);
    expect(CODEX_MODELS.map((o) => o.value)).toContain('gpt-5-codex');
  });
});

describe('DEFAULT_RUNTIME_MODELS', () => {
  it('uses claude-sonnet-4-6 for claude-code', () => {
    expect(DEFAULT_RUNTIME_MODELS['claude-code']).toBe('claude-sonnet-4-6');
  });

  it('uses gpt-5-codex for codex', () => {
    expect(DEFAULT_RUNTIME_MODELS.codex).toBe('gpt-5-codex');
  });
});
