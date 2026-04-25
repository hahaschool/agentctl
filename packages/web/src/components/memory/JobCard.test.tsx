import type { MemoryOpsJob } from '@agentctl/shared';
import { fireEvent, render, screen } from '@testing-library/react';

import type { MemoryOpsCapabilities } from '@/lib/api/memory-ops';

import { JobCard } from './JobCard';

function makeCapabilities(overrides: Partial<MemoryOpsCapabilities> = {}): MemoryOpsCapabilities {
  return {
    enabled: true,
    enabledKinds: ['embedding-backfill', 'drawer-backfill'],
    machineId: 'local-machine',
    queueAvailable: true,
    activeProvider: {
      id: 'provider-1',
      provider: 'openai',
      model: 'text-embedding-3-small',
      credentialLast4: '1234',
      lastTestOk: true,
    },
    activeProviderLastTestOk: true,
    activeJobs: [],
    ...overrides,
  };
}

function makeJob(overrides: Partial<MemoryOpsJob> = {}): MemoryOpsJob {
  return {
    id: 'job-1',
    kind: 'embedding-backfill',
    status: 'running',
    params: {},
    progress: {
      processed: 40,
      embedded: 40,
      failed: 0,
      total: 100,
      costUsd: 0.0024,
      usageEstimated: false,
      etaSeconds: 90,
    },
    result: null,
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
    finishedAt: null,
    createdAt: '2026-04-25T00:00:00.000Z',
    egressConfirmedAt: '2026-04-25T00:00:00.000Z',
    egressConfirmedBy: 'web',
    egressSnapshot: null,
    ...overrides,
  };
}

describe('JobCard', () => {
  it('enables Run now when the job kind is enabled and the provider is healthy', () => {
    render(
      <JobCard
        kind="embedding-backfill"
        capabilities={makeCapabilities()}
        latestJob={null}
        onRun={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /run now/i })).toBeEnabled();
  });

  it('disables provider-backed jobs until the active provider has passed a test', () => {
    render(
      <JobCard
        kind="embedding-backfill"
        capabilities={makeCapabilities({ activeProviderLastTestOk: null })}
        latestJob={null}
        onRun={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /run now/i })).toBeDisabled();
    expect(screen.getByText(/must pass a provider test/i)).toBeDefined();
  });

  it('shows running progress and lets operators cancel the latest local job', () => {
    const onCancel = vi.fn();
    const job = makeJob();

    render(
      <JobCard
        kind="embedding-backfill"
        capabilities={makeCapabilities()}
        latestJob={job}
        onRun={vi.fn()}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText(/40\/100 processed/i)).toBeDefined();
    const cancelButton = screen.getByRole('button', { name: /cancel/i });
    expect(cancelButton).toBeEnabled();

    fireEvent.click(cancelButton);

    expect(onCancel).toHaveBeenCalledWith(job);
  });

  it('blocks a new run when the fleet already has an active job of the same kind', () => {
    render(
      <JobCard
        kind="drawer-backfill"
        capabilities={makeCapabilities({
          activeJobs: [
            { kind: 'drawer-backfill', scope: '', queued: 0, running: 1, cancelling: 0 },
          ],
        })}
        latestJob={null}
        onRun={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /run now/i })).toBeDisabled();
    expect(screen.getByText(/already active somewhere in the fleet/i)).toBeDefined();
  });
});
