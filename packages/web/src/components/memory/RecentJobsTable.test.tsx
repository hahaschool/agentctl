import type { MemoryOpsJob } from '@agentctl/shared';
import { fireEvent, render, screen } from '@testing-library/react';

import { RecentJobsTable } from './RecentJobsTable';

function makeJob(overrides: Partial<MemoryOpsJob> = {}): MemoryOpsJob {
  return {
    id: 'job-1',
    kind: 'embedding-backfill',
    status: 'completed',
    params: {},
    progress: {
      processed: 100,
      embedded: 100,
      failed: 0,
      total: 100,
      costUsd: 0.0123,
      usageEstimated: false,
    },
    result: { rowsEmbedded: 100 },
    error: null,
    errorCode: null,
    credentialId: 'provider-1',
    providerKind: 'openai',
    providerModel: 'text-embedding-3-small',
    providerHost: 'https://api.openai.com',
    priceUsdPerMtoken: '0.02',
    originMachineId: 'local-machine',
    executorMachineId: 'local-machine',
    cancelRequestedAt: null,
    startedAt: '2026-04-25T00:00:00.000Z',
    finishedAt: '2026-04-25T00:05:00.000Z',
    createdAt: '2026-04-25T00:00:00.000Z',
    egressConfirmedAt: '2026-04-25T00:00:00.000Z',
    egressConfirmedBy: 'web',
    egressSnapshot: null,
    ...overrides,
  };
}

describe('RecentJobsTable', () => {
  it('renders an empty state when there are no jobs', () => {
    render(
      <RecentJobsTable
        jobs={[]}
        machineId="local-machine"
        selectedJobId={null}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText(/no memory operation jobs yet/i)).toBeDefined();
  });

  it('renders jobs and calls onSelect when a row action is clicked', () => {
    const onSelect = vi.fn();
    const localJob = makeJob();
    const remoteJob = makeJob({
      id: 'job-2',
      kind: 'drawer-backfill',
      status: 'running',
      executorMachineId: 'peer-2',
      originMachineId: 'peer-2',
      finishedAt: null,
      progress: {
        processed: 12,
        embedded: 12,
        failed: 0,
        total: 30,
        costUsd: 0.001,
        usageEstimated: true,
      },
    });

    render(
      <RecentJobsTable
        jobs={[localJob, remoteJob]}
        machineId="local-machine"
        selectedJobId={null}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText(/embedding backfill/i)).toBeDefined();
    expect(screen.getByText(/drawer backfill/i)).toBeDefined();
    expect(screen.getByText(/remote/i)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /open job job-2/i }));

    expect(onSelect).toHaveBeenCalledWith(remoteJob);
  });
});
