import { type MemoryOpsProgress, scopeNormalize } from '@agentctl/shared';
import type { Logger } from 'pino';

import type { SynthesisResult } from '../knowledge-synthesis.js';
import type { JobEventsRepository } from './job-events-repository.js';
import type { JobsRepository } from './jobs-repository.js';

export type SynthesisHandlerInput = {
  jobId: string;
  params?: Record<string, unknown>;
  logger: Logger;
  synthesis: { runSynthesis: (scope?: string) => Promise<SynthesisResult> };
  jobsRepository: Pick<JobsRepository, 'isCancelRequested' | 'transition'>;
  eventsRepository: Pick<JobEventsRepository, 'insert'>;
};

export async function synthesisHandler(input: SynthesisHandlerInput): Promise<void> {
  const scope = parseScope(input.params);

  if (await input.jobsRepository.isCancelRequested(input.jobId)) {
    await cancelJob(input, buildProgress(0, 0));
    return;
  }

  const result = await input.synthesis.runSynthesis(scope || undefined);
  const lintCount =
    result.lint.nearDuplicates.length +
    result.lint.staleFacts.length +
    result.lint.orphanFacts.length;
  const groupCount = result.synthesisGroups.length;
  const processed = lintCount + groupCount;
  const progress = buildProgress(processed, processed);
  const summary = {
    nearDuplicates: result.lint.nearDuplicates.length,
    staleFacts: result.lint.staleFacts.length,
    orphanFacts: result.lint.orphanFacts.length,
    synthesisGroups: groupCount,
  };

  await input.eventsRepository.insert({
    jobId: input.jobId,
    eventType: 'progress',
    level: 'info',
    message: `Synthesis scan found ${groupCount} group${groupCount === 1 ? '' : 's'}`,
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
    message: `Completed synthesis: ${groupCount} group${groupCount === 1 ? '' : 's'}`,
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
  input: Pick<SynthesisHandlerInput, 'jobId' | 'jobsRepository' | 'eventsRepository'>,
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
