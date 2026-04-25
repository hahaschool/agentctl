import { type MemoryOpsProgress, scopeNormalize } from '@agentctl/shared';
import type { Logger } from 'pino';

import type { MaintenanceResult } from '../knowledge-maintenance.js';
import type { JobEventsRepository } from './job-events-repository.js';
import type { JobsRepository } from './jobs-repository.js';

export type ConsolidationHandlerInput = {
  jobId: string;
  params?: Record<string, unknown>;
  logger: Logger;
  maintenance: { run: (scope?: string) => Promise<MaintenanceResult> };
  jobsRepository: Pick<JobsRepository, 'isCancelRequested' | 'transition'>;
  eventsRepository: Pick<JobEventsRepository, 'insert'>;
};

export async function consolidationHandler(input: ConsolidationHandlerInput): Promise<void> {
  const scope = parseScope(input.params);

  if (await input.jobsRepository.isCancelRequested(input.jobId)) {
    await cancelJob(input, buildProgress(0, 0));
    return;
  }

  const result = await input.maintenance.run(scope || undefined);
  const processed =
    result.staleEntries.length +
    result.deletedFileEntries.length +
    result.synthesisClusters.length +
    result.coverageReport.totalDirectories;
  const consolidated = result.consolidationItems.length;
  const progress = buildProgress(processed, processed);
  const summary = {
    staleEntries: result.staleEntries.length,
    deletedFileEntries: result.deletedFileEntries.length,
    synthesisClusters: result.synthesisClusters.length,
    coverageGaps: result.coverageReport.gapCount,
    consolidationItems: consolidated,
    reportId: result.report?.id ?? null,
  };

  await input.eventsRepository.insert({
    jobId: input.jobId,
    eventType: 'progress',
    level: 'info',
    message: `Consolidation scan found ${consolidated} review item${consolidated === 1 ? '' : 's'}`,
    progress,
    payload: summary,
  });

  if (await input.jobsRepository.isCancelRequested(input.jobId)) {
    await cancelJob(input, progress, summary);
    return;
  }

  await input.jobsRepository.transition(input.jobId, 'completed', {
    progress,
    result: summary,
  });
  await input.eventsRepository.insert({
    jobId: input.jobId,
    eventType: 'completed',
    level: 'info',
    message: `Completed consolidation: ${consolidated} review item${consolidated === 1 ? '' : 's'}`,
    progress,
    payload: summary,
  });
}

function parseScope(params: Record<string, unknown> | undefined): string {
  return scopeNormalize(typeof params?.scope === 'string' ? params.scope : '');
}

function buildProgress(processed: number, total: number): MemoryOpsProgress {
  return {
    processed,
    embedded: 0,
    failed: 0,
    total,
    costUsd: 0,
    usageEstimated: false,
  };
}

async function cancelJob(
  input: Pick<ConsolidationHandlerInput, 'jobId' | 'jobsRepository' | 'eventsRepository'>,
  progress: MemoryOpsProgress,
  result?: Record<string, unknown>,
): Promise<void> {
  await input.jobsRepository.transition(input.jobId, 'cancelled', { progress, result });
  await input.eventsRepository.insert({
    jobId: input.jobId,
    eventType: 'cancelled',
    level: 'info',
    message: 'Cancelled by request',
    progress,
    payload: result,
  });
}
