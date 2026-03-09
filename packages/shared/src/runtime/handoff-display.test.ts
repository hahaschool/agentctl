import { describe, expect, it } from 'vitest';

import {
  describeHandoffCompletion,
  describeHandoffExecution,
  formatHandoffStrategyLabel,
  formatRuntimeLabel,
} from './handoff-display.js';

describe('handoff display helpers', () => {
  it('formats managed runtime labels', () => {
    expect(formatRuntimeLabel('claude-code')).toBe('Claude Code');
    expect(formatRuntimeLabel('codex')).toBe('Codex');
  });

  it('formats handoff strategy labels', () => {
    expect(formatHandoffStrategyLabel('native-import')).toBe('Native Import');
    expect(formatHandoffStrategyLabel('snapshot-handoff')).toBe('Snapshot Handoff');
  });

  it('describes native-import execution', () => {
    expect(describeHandoffExecution({ strategy: 'native-import' })).toBe(
      'Completed via native import',
    );
  });

  it('describes snapshot execution after fallback', () => {
    expect(
      describeHandoffExecution({
        strategy: 'snapshot-handoff',
        nativeImportAttempt: { ok: false },
      }),
    ).toBe('Completed via snapshot handoff after native import fallback');
  });

  it('describes plain snapshot execution', () => {
    expect(describeHandoffExecution({ strategy: 'snapshot-handoff' })).toBe(
      'Completed via snapshot handoff',
    );
  });

  it('describes handoff completion messages', () => {
    expect(
      describeHandoffCompletion({
        targetRuntime: 'claude-code',
        strategy: 'native-import',
      }),
    ).toBe('Handed off to Claude Code via native import');
    expect(
      describeHandoffCompletion({
        targetRuntime: 'codex',
        strategy: 'snapshot-handoff',
        nativeImportAttempt: { ok: false },
      }),
    ).toBe('Handed off to Codex via snapshot handoff after native import fallback');
  });
});
