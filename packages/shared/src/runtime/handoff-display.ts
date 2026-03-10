import type { NativeImportAttempt } from '../protocol/handoff.js';
import type { HandoffStrategy, ManagedRuntime } from '../types/runtime-management.js';

export function formatRuntimeLabel(runtime: ManagedRuntime): string {
  return runtime === 'claude-code' ? 'Claude Code' : 'Codex';
}

export function formatHandoffStrategyLabel(strategy: HandoffStrategy): string {
  return strategy === 'native-import' ? 'Native Import' : 'Snapshot Handoff';
}

export function describeHandoffExecution(input: {
  strategy: HandoffStrategy;
  nativeImportAttempt?: Pick<NativeImportAttempt, 'ok'>;
}): string {
  if (input.strategy === 'native-import') {
    return 'Completed via native import';
  }

  if (input.nativeImportAttempt && !input.nativeImportAttempt.ok) {
    return 'Completed via snapshot handoff after native import fallback';
  }

  return 'Completed via snapshot handoff';
}

export function describeHandoffCompletion(input: {
  targetRuntime: ManagedRuntime;
  strategy: HandoffStrategy;
  nativeImportAttempt?: Pick<NativeImportAttempt, 'ok'>;
}): string {
  return `Handed off to ${formatRuntimeLabel(input.targetRuntime)} via ${describeHandoffExecution(
    input,
  )
    .replace(/^Completed via /, '')
    .toLowerCase()}`;
}
