export const EXECUTION_SUMMARY_STATUSES = ['success', 'partial', 'failure'] as const;

export type ExecutionSummaryStatus = (typeof EXECUTION_SUMMARY_STATUSES)[number];

export const EXECUTION_SUMMARY_FILE_ACTIONS = ['created', 'modified', 'deleted'] as const;

export type ExecutionSummaryFileAction = (typeof EXECUTION_SUMMARY_FILE_ACTIONS)[number];

export type ExecutionSummaryFileChange = {
  path: string;
  action: ExecutionSummaryFileAction;
};

export type ExecutionSummary = {
  status: ExecutionSummaryStatus;
  workCompleted: string;
  executiveSummary: string;
  keyFindings: string[];
  filesChanged: ExecutionSummaryFileChange[];
  commandsRun: number;
  toolUsageBreakdown: Record<string, number>;
  followUps: string[];
  branchName: string | null;
  prUrl: string | null;
  tokensUsed: {
    input: number;
    output: number;
  };
  costUsd: number;
  durationMs: number;
};

export type ExecutionSummaryContext = {
  status?: string | null;
  startedAt?: Date | string | null;
  finishedAt?: Date | string | null;
  costUsd?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
};

export function isExecutionSummary(value: unknown): value is ExecutionSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<ExecutionSummary>;

  return (
    typeof candidate.status === 'string' &&
    EXECUTION_SUMMARY_STATUSES.includes(candidate.status as ExecutionSummaryStatus) &&
    typeof candidate.workCompleted === 'string' &&
    typeof candidate.executiveSummary === 'string' &&
    Array.isArray(candidate.keyFindings) &&
    Array.isArray(candidate.filesChanged) &&
    typeof candidate.commandsRun === 'number' &&
    typeof candidate.toolUsageBreakdown === 'object' &&
    candidate.toolUsageBreakdown !== null &&
    !Array.isArray(candidate.toolUsageBreakdown) &&
    Array.isArray(candidate.followUps) &&
    typeof candidate.tokensUsed === 'object' &&
    candidate.tokensUsed !== null &&
    !Array.isArray(candidate.tokensUsed) &&
    typeof candidate.tokensUsed.input === 'number' &&
    typeof candidate.tokensUsed.output === 'number' &&
    typeof candidate.costUsd === 'number' &&
    typeof candidate.durationMs === 'number'
  );
}

export function toExecutionSummary(
  value: ExecutionSummary | string | null | undefined,
  context: ExecutionSummaryContext = {},
): ExecutionSummary | null {
  if (value == null) {
    return null;
  }

  if (isExecutionSummary(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const workCompleted = value.trim();
  if (!workCompleted) {
    return null;
  }

  return {
    status: mapStatus(context.status),
    workCompleted,
    executiveSummary: workCompleted,
    keyFindings: [],
    filesChanged: [],
    commandsRun: 0,
    toolUsageBreakdown: {},
    followUps: [],
    branchName: null,
    prUrl: null,
    tokensUsed: {
      input: context.tokensIn ?? 0,
      output: context.tokensOut ?? 0,
    },
    costUsd: context.costUsd ?? 0,
    durationMs: computeDurationMs(context.startedAt, context.finishedAt),
  };
}

function mapStatus(status: string | null | undefined): ExecutionSummaryStatus {
  switch (status) {
    case 'success':
      return 'success';
    case 'failure':
    case 'timeout':
    case 'cancelled':
    case 'error':
      return 'failure';
    default:
      return 'partial';
  }
}

function computeDurationMs(
  startedAt: Date | string | null | undefined,
  finishedAt: Date | string | null | undefined,
): number {
  const start = toTimestamp(startedAt);
  if (start === null) {
    return 0;
  }

  const end = toTimestamp(finishedAt) ?? start;
  return end > start ? end - start : 0;
}

function toTimestamp(value: Date | string | null | undefined): number | null {
  if (value == null) {
    return null;
  }

  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}
