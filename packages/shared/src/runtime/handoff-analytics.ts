export type HandoffAnalyticsInput = {
  status: 'pending' | 'succeeded' | 'failed';
  nativeImportAttempt?: {
    ok: boolean;
  };
};

export type HandoffAnalyticsSummary = {
  total: number;
  succeeded: number;
  failed: number;
  pending: number;
  nativeImportSuccesses: number;
  nativeImportFallbacks: number;
};

export type HandoffAnalyticsRates = {
  nativeImportSuccessRate: number;
  fallbackRate: number;
};

export function summarizeHandoffAnalytics(
  handoffs: HandoffAnalyticsInput[],
): HandoffAnalyticsSummary {
  return handoffs.reduce<HandoffAnalyticsSummary>(
    (summary, handoff) => {
      summary.total += 1;

      if (handoff.status === 'succeeded') {
        summary.succeeded += 1;
      } else if (handoff.status === 'failed') {
        summary.failed += 1;
      } else {
        summary.pending += 1;
      }

      if (handoff.nativeImportAttempt?.ok === true) {
        summary.nativeImportSuccesses += 1;
      } else if (handoff.nativeImportAttempt) {
        summary.nativeImportFallbacks += 1;
      }

      return summary;
    },
    {
      total: 0,
      succeeded: 0,
      failed: 0,
      pending: 0,
      nativeImportSuccesses: 0,
      nativeImportFallbacks: 0,
    },
  );
}

export function calculateHandoffAnalyticsRates(
  summary: Pick<
    HandoffAnalyticsSummary,
    'total' | 'nativeImportSuccesses' | 'nativeImportFallbacks'
  >,
): HandoffAnalyticsRates {
  if (summary.total <= 0) {
    return {
      nativeImportSuccessRate: 0,
      fallbackRate: 0,
    };
  }

  return {
    nativeImportSuccessRate: Math.round((summary.nativeImportSuccesses / summary.total) * 100),
    fallbackRate: Math.round((summary.nativeImportFallbacks / summary.total) * 100),
  };
}
