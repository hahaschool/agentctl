import { describe, expect, it } from 'vitest';

import { summarizeNativeImportPreflightStatus } from './native-import-status.js';

describe('summarizeNativeImportPreflightStatus', () => {
  it('returns checking while preflight is refreshing', () => {
    expect(
      summarizeNativeImportPreflightStatus({
        isLoading: true,
      }),
    ).toEqual({
      kind: 'checking',
      badgeLabel: 'Checking native import',
      actionLabel: 'Checking handoff...',
      tone: 'neutral',
    });
  });

  it('returns ready when native import is available', () => {
    expect(
      summarizeNativeImportPreflightStatus({
        preflight: { nativeImportCapable: true },
      }),
    ).toEqual({
      kind: 'ready',
      badgeLabel: 'Native import ready',
      actionLabel: 'Start Native Import',
      tone: 'success',
    });
  });

  it('returns fallback when managed handoff must use snapshot mode', () => {
    expect(
      summarizeNativeImportPreflightStatus({
        preflight: { nativeImportCapable: false },
      }),
    ).toEqual({
      kind: 'fallback',
      badgeLabel: 'Snapshot fallback',
      actionLabel: 'Start Snapshot Handoff',
      tone: 'warning',
    });
  });

  it('returns idle before any preflight result exists', () => {
    expect(summarizeNativeImportPreflightStatus({})).toEqual({
      kind: 'idle',
      badgeLabel: 'Managed handoff',
      actionLabel: 'Start Handoff',
      tone: 'neutral',
    });
  });
});
