import type { HandoffStrategy, ManagedSessionStatus } from '../types/runtime-management.js';

export const HANDOFF_HISTORY_FILTERS = ['all', 'native-import', 'fallback', 'failed'] as const;

export type HandoffHistoryFilter = (typeof HANDOFF_HISTORY_FILTERS)[number];

export type HandoffHistoryFilterInput = {
  status: 'pending' | 'succeeded' | 'failed' | ManagedSessionStatus;
  strategy: HandoffStrategy;
  nativeImportAttempt?: {
    ok: boolean;
  };
};

export function formatHandoffHistoryFilterLabel(filter: HandoffHistoryFilter): string {
  switch (filter) {
    case 'native-import':
      return 'Native Import';
    case 'fallback':
      return 'Fallback';
    case 'failed':
      return 'Failed';
    default:
      return 'All';
  }
}

export function matchesHandoffHistoryFilter(
  handoff: HandoffHistoryFilterInput,
  filter: HandoffHistoryFilter,
): boolean {
  switch (filter) {
    case 'native-import':
      return handoff.strategy === 'native-import';
    case 'fallback':
      return handoff.status === 'succeeded' && handoff.nativeImportAttempt?.ok === false;
    case 'failed':
      return handoff.status === 'failed';
    default:
      return true;
  }
}
