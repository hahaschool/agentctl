import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';

import type { MaintenanceResult } from '../knowledge-maintenance.js';
import { consolidationHandler } from './consolidation.js';

const logger = {} as Logger;

function makeMaintenanceResult(overrides: Partial<MaintenanceResult> = {}): MaintenanceResult {
  return {
    staleEntries: [],
    deletedFileEntries: [],
    synthesisClusters: [],
    coverageReport: {
      covered: [],
      gaps: [],
      totalDirectories: 0,
      coveredCount: 0,
      gapCount: 0,
    },
    consolidationItems: [],
    report: null,
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

describe('consolidationHandler', () => {
  it('delegates to MemoryMaintenance.run and completes with a summary result', async () => {
    const maintenance = {
      run: vi.fn().mockResolvedValue(
        makeMaintenanceResult({
          staleEntries: [{ factId: 'fact-1', content: 'old', referencedPaths: [], reason: 'old' }],
          deletedFileEntries: [{ factId: 'fact-2', content: 'deleted', deletedFile: 'old.ts' }],
          synthesisClusters: [
            {
              seedFactId: 'fact-3',
              factIds: ['fact-3', 'fact-4', 'fact-5'],
              factContents: ['a', 'b', 'c'],
              proposedPrinciple: 'Keep related facts together',
            },
          ],
          coverageReport: {
            covered: [],
            gaps: [{ directory: 'packages/web', factCount: 0 }],
            totalDirectories: 4,
            coveredCount: 3,
            gapCount: 1,
          },
          consolidationItems: [
            {
              id: 'item-1',
              type: 'stale',
              severity: 'medium',
              factIds: ['fact-1'],
              suggestion: 'Review',
              reason: 'old',
              status: 'pending',
              createdAt: '2026-04-25T00:00:00.000Z',
            },
          ],
        }),
      ),
    };
    const { jobsRepository, eventsRepository } = makeRepos([false, false]);

    await consolidationHandler({
      jobId: 'job-1',
      params: { scope: ' Project:AgentCTL ' },
      logger,
      maintenance,
      jobsRepository,
      eventsRepository,
    });

    expect(maintenance.run).toHaveBeenCalledWith('project:agentctl');
    expect(jobsRepository.transition).toHaveBeenCalledWith(
      'job-1',
      'completed',
      expect.objectContaining({
        result: expect.objectContaining({
          staleEntries: 1,
          deletedFileEntries: 1,
          synthesisClusters: 1,
          coverageGaps: 1,
          consolidationItems: 1,
        }),
      }),
    );
    expect(eventsRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        eventType: 'completed',
        message: 'Completed consolidation: 1 review item',
      }),
    );
  });

  it('cancels before invoking maintenance when requested', async () => {
    const maintenance = { run: vi.fn() };
    const { jobsRepository, eventsRepository } = makeRepos([true]);

    await consolidationHandler({
      jobId: 'job-2',
      params: {},
      logger,
      maintenance,
      jobsRepository,
      eventsRepository,
    });

    expect(maintenance.run).not.toHaveBeenCalled();
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
