import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { SynthesisResult } from '../knowledge-synthesis.js';
import { synthesisHandler } from './synthesis.js';

const logger = {} as Logger;

function makeSynthesisResult(overrides: Partial<SynthesisResult> = {}): SynthesisResult {
  return {
    lint: {
      nearDuplicates: [],
      staleFacts: [],
      orphanFacts: [],
    },
    synthesisGroups: [],
    ...overrides,
  };
}

function makeRepos(cancelResponses: boolean[] = [false]) {
  const jobsRepository = {
    isCancelRequested: vi.fn(async () => cancelResponses.shift() ?? false),
    transition: vi.fn(),
  };
  const eventsRepository = {
    insert: vi.fn(),
  };
  return { jobsRepository, eventsRepository };
}

describe('synthesisHandler', () => {
  it('delegates to MemorySynthesis.runSynthesis and completes with a summary result', async () => {
    const synthesis = {
      runSynthesis: vi.fn().mockResolvedValue(
        makeSynthesisResult({
          lint: {
            nearDuplicates: [
              {
                factIdA: 'fact-1',
                factIdB: 'fact-2',
                similarity: 0.87,
                contentA: 'first',
                contentB: 'second',
              },
            ],
            staleFacts: [{ factId: 'fact-3', content: 'old', lastAccessedDaysAgo: 45 }],
            orphanFacts: [
              {
                factId: 'fact-4',
                content: 'lonely',
                entityType: 'concept',
                createdAt: '2026-04-25T00:00:00.000Z',
              },
            ],
          },
          synthesisGroups: [
            {
              entityType: 'preference',
              factIds: ['fact-5', 'fact-6', 'fact-7'],
              factContents: ['a', 'b', 'c'],
              proposalHint: 'Consider a principle',
            },
          ],
        }),
      ),
    };
    const { jobsRepository, eventsRepository } = makeRepos([false, false]);

    await synthesisHandler({
      jobId: 'job-1',
      params: { scope: ' Project:AgentCTL ' },
      logger,
      synthesis,
      jobsRepository,
      eventsRepository,
    });

    expect(synthesis.runSynthesis).toHaveBeenCalledWith('project:agentctl');
    expect(jobsRepository.transition).toHaveBeenCalledWith(
      'job-1',
      'completed',
      expect.objectContaining({
        result: {
          nearDuplicates: 1,
          staleFacts: 1,
          orphanFacts: 1,
          synthesisGroups: 1,
        },
      }),
    );
    expect(eventsRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        eventType: 'completed',
        message: 'Completed synthesis: 1 group',
      }),
    );
  });

  it('cancels before invoking synthesis when requested', async () => {
    const synthesis = { runSynthesis: vi.fn() };
    const { jobsRepository, eventsRepository } = makeRepos([true]);

    await synthesisHandler({
      jobId: 'job-2',
      params: {},
      logger,
      synthesis,
      jobsRepository,
      eventsRepository,
    });

    expect(synthesis.runSynthesis).not.toHaveBeenCalled();
    expect(jobsRepository.transition).toHaveBeenCalledWith(
      'job-2',
      'cancelled',
      expect.objectContaining({ progress: expect.objectContaining({ processed: 0 }) }),
    );
    expect(eventsRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'cancelled', message: 'Cancelled by request' }),
    );
  });
});
