import type { NativeImportPreflightResponse } from '../protocol/handoff.js';

export type NativeImportPreflightStatus = {
  kind: 'idle' | 'checking' | 'ready' | 'fallback';
  badgeLabel: string;
  actionLabel: string;
  tone: 'neutral' | 'success' | 'warning';
};

export function summarizeNativeImportPreflightStatus(input: {
  preflight?: Pick<NativeImportPreflightResponse, 'nativeImportCapable'> | null;
  isLoading?: boolean;
}): NativeImportPreflightStatus {
  if (input.isLoading) {
    return {
      kind: 'checking',
      badgeLabel: 'Checking native import',
      actionLabel: 'Checking handoff...',
      tone: 'neutral',
    };
  }

  if (input.preflight?.nativeImportCapable) {
    return {
      kind: 'ready',
      badgeLabel: 'Native import ready',
      actionLabel: 'Start Native Import',
      tone: 'success',
    };
  }

  if (input.preflight) {
    return {
      kind: 'fallback',
      badgeLabel: 'Snapshot fallback',
      actionLabel: 'Start Snapshot Handoff',
      tone: 'warning',
    };
  }

  return {
    kind: 'idle',
    badgeLabel: 'Managed handoff',
    actionLabel: 'Start Handoff',
    tone: 'neutral',
  };
}
