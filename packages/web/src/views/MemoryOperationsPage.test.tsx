import type { MemoryOpsJob } from '@agentctl/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ApiError } from '@/lib/api/core';

const { mockUseQuery, mockInvalidateQueries, mockPreview, mockCreateJob, mockCancelJob } =
  vi.hoisted(() => ({
    mockUseQuery: vi.fn(),
    mockInvalidateQueries: vi.fn(),
    mockPreview: vi.fn(),
    mockCreateJob: vi.fn(),
    mockCancelJob: vi.fn(),
  }));

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

vi.mock('@/lib/queries', () => ({
  memoryOpsCapabilitiesQuery: () => ({ queryKey: ['memory', 'ops', 'capabilities'] }),
  memoryOpsJobsQuery: (filters?: unknown) => ({ queryKey: ['memory', 'ops', 'jobs', filters] }),
  queryKeys: {
    memory: {
      ops: {
        capabilities: ['memory', 'ops', 'capabilities'],
        jobs: (filters?: unknown) => ['memory', 'ops', 'jobs', filters],
      },
    },
  },
}));

vi.mock('@/lib/api/memory-ops', () => ({
  memoryOpsApi: {
    preview: (...args: unknown[]) => mockPreview(...args),
    createJob: (...args: unknown[]) => mockCreateJob(...args),
    cancelJob: (...args: unknown[]) => mockCancelJob(...args),
  },
}));

vi.mock('@/components/memory/JobCard', () => ({
  JobCard: ({
    kind,
    onRun,
    latestJob,
    onCancel,
  }: {
    kind: string;
    latestJob: MemoryOpsJob | null;
    onRun: (kind: string) => void;
    onCancel: (job: MemoryOpsJob) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onRun(kind)}>
        run-{kind}
      </button>
      {latestJob ? (
        <button type="button" onClick={() => onCancel(latestJob)}>
          cancel-{kind}
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock('@/components/memory/MissingEmbeddingAlert', () => ({
  MissingEmbeddingAlert: () => <div data-testid="missing-embedding-alert" />,
}));

vi.mock('@/components/memory/RecentJobsTable', () => ({
  RecentJobsTable: ({
    jobs,
    onSelect,
  }: {
    jobs: MemoryOpsJob[];
    onSelect: (job: MemoryOpsJob) => void;
  }) => (
    <div>
      {jobs.map((job) => (
        <button key={job.id} type="button" onClick={() => onSelect(job)}>
          open-{job.id}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('@/components/memory/EgressConfirmationDialog', () => ({
  EgressConfirmationDialog: ({
    open,
    previewToken,
    onConfirm,
  }: {
    open: boolean;
    previewToken: string;
    onConfirm: (previewToken: string) => void;
  }) =>
    open ? (
      <button type="button" onClick={() => onConfirm(previewToken)}>
        confirm-egress
      </button>
    ) : null,
}));

vi.mock('@/components/memory/JobDetailDrawer', () => ({
  JobDetailDrawer: ({ open, jobId }: { open: boolean; jobId: string | null }) =>
    open ? <div data-testid="job-detail-drawer">{jobId}</div> : null,
}));

vi.mock('@/components/memory/MixedModelsBanner', () => ({
  MixedModelsBanner: ({
    activeModel,
    models,
  }: {
    activeModel: string;
    models: Array<{ table: string; model: string; count: number }>;
  }) => (
    <div data-testid="mixed-models-banner">
      {activeModel}:{models.length}
    </div>
  ),
}));

import { MemoryOperationsPage } from './MemoryOperationsPage';

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

describe('MemoryOperationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseQuery.mockImplementation((options: { queryKey: unknown[] }) => {
      if (Array.isArray(options.queryKey) && options.queryKey[2] === 'capabilities') {
        return {
          data: {
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
          },
          isPending: false,
          isError: false,
        };
      }
      return {
        data: { jobs: [makeJob()], limit: 20, offset: 0 },
        isPending: false,
        isError: false,
      };
    });
  });

  it('renders the operations view with all four job cards', () => {
    render(<MemoryOperationsPage />);

    expect(screen.getByText(/memory operations/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /run-embedding-backfill/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /run-drawer-backfill/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /run-consolidation/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /run-synthesis/i })).toBeDefined();
  });

  it('runs the preview -> confirm -> create flow for provider-backed jobs', async () => {
    mockPreview.mockResolvedValue({
      ok: true,
      snapshot: {
        kind: 'embedding-backfill',
        providerKind: 'openai',
        providerModel: 'text-embedding-3-small',
        providerHost: 'https://api.openai.com',
        priceUsdPerMtoken: 0.02,
        rowCount: 100,
        tokenEstimate: 5000,
        costEstimate: 0.0001,
        contentClass: 'memory-facts',
        computedAt: '2026-04-25T00:00:00.000Z',
      },
      egressToken: 'signed-token',
    });
    mockCreateJob.mockResolvedValue({ ok: true, job: makeJob({ status: 'queued' }) });

    render(<MemoryOperationsPage />);

    fireEvent.click(screen.getByRole('button', { name: /run-embedding-backfill/i }));

    await waitFor(() =>
      expect(mockPreview).toHaveBeenCalledWith({ kind: 'embedding-backfill', params: {} }),
    );

    fireEvent.click(await screen.findByRole('button', { name: /confirm-egress/i }));

    await waitFor(() =>
      expect(mockCreateJob).toHaveBeenCalledWith({
        kind: 'embedding-backfill',
        params: {},
        egressToken: 'signed-token',
        egressConfirmedBy: 'web',
      }),
    );
    expect(mockInvalidateQueries).toHaveBeenCalled();
  });

  it('surfaces a mixed-model banner when preview returns MODEL_MISMATCH details', async () => {
    mockPreview.mockRejectedValue(
      new ApiError(409, 'MODEL_MISMATCH', 'Existing embeddings use a different model', undefined, {
        incomingModel: 'text-embedding-3-small',
        existingModels: [
          { table: 'memory_facts', model: 'text-embedding-3-small', count: 100 },
          { table: 'memory_drawers', model: 'gemini-embedding-001', count: 20 },
        ],
      }),
    );

    render(<MemoryOperationsPage />);

    fireEvent.click(screen.getByRole('button', { name: /run-embedding-backfill/i }));

    expect(await screen.findByTestId('mixed-models-banner')).toHaveTextContent(
      /text-embedding-3-small:2/i,
    );
  });

  it('opens the detail drawer for a selected job and can cancel the latest job from a card', async () => {
    mockCancelJob.mockResolvedValue({ ok: true, job: makeJob({ status: 'cancelling' }) });

    render(<MemoryOperationsPage />);

    fireEvent.click(screen.getByRole('button', { name: /open-job-1/i }));
    expect(await screen.findByTestId('job-detail-drawer')).toHaveTextContent('job-1');

    fireEvent.click(screen.getByRole('button', { name: /cancel-embedding-backfill/i }));
    await waitFor(() => expect(mockCancelJob).toHaveBeenCalledWith('job-1'));
  });
});
