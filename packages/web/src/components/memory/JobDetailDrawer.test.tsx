import type { MemoryOpsJob } from '@agentctl/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { mockGetJob, mockStreamUrl } = vi.hoisted(() => ({
  mockGetJob: vi.fn(),
  mockStreamUrl: vi.fn((id: string) => `/api/memory/ops/jobs/${id}/stream`),
}));

vi.mock('@/lib/api/memory-ops', () => ({
  memoryOpsApi: {
    getJob: (...args: unknown[]) => mockGetJob(...args),
    streamUrl: (...args: unknown[]) => mockStreamUrl(...args),
  },
}));

vi.mock('@/components/ui/sheet', () => {
  const Root = ({ open, children }: { open?: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="sheet-root">{children}</div> : null;
  const Pass = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  return {
    Sheet: Root,
    SheetContent: Pass,
    SheetHeader: Pass,
    SheetFooter: Pass,
    SheetTitle: Pass,
    SheetDescription: Pass,
  };
});

import { JobDetailDrawer } from './JobDetailDrawer';

function makeJob(overrides: Partial<MemoryOpsJob> = {}): MemoryOpsJob {
  return {
    id: 'job-1',
    kind: 'embedding-backfill',
    status: 'running',
    params: {},
    progress: {
      processed: 10,
      embedded: 10,
      failed: 0,
      total: 100,
      costUsd: 0.001,
      usageEstimated: false,
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

type EventHandler = (event: { data: string }) => void;

const eventSources: MockEventSource[] = [];

class MockEventSource {
  public readonly url: string;
  public readonly close = vi.fn();
  private readonly listeners = new Map<string, EventHandler[]>();

  constructor(url: string) {
    this.url = url;
    eventSources.push(this);
  }

  addEventListener(type: string, handler: EventHandler) {
    const existing = this.listeners.get(type) ?? [];
    existing.push(handler);
    this.listeners.set(type, existing);
  }

  emit(type: string, payload: unknown) {
    for (const handler of this.listeners.get(type) ?? []) {
      handler({ data: JSON.stringify(payload) });
    }
  }
}

describe('JobDetailDrawer', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', MockEventSource);
    mockGetJob.mockResolvedValue({ job: makeJob() });
    eventSources.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    eventSources.length = 0;
  });

  it('loads the selected job, streams live events, and supports cancellation', async () => {
    const onCancel = vi.fn();
    const onOpenChange = vi.fn();
    const job = makeJob();
    const { unmount } = render(
      <JobDetailDrawer
        open
        jobId={job.id}
        machineId="local-machine"
        initialJob={job}
        onCancel={onCancel}
        onOpenChange={onOpenChange}
      />,
    );

    await waitFor(() => expect(mockGetJob).toHaveBeenCalledWith('job-1'));
    expect(mockStreamUrl).toHaveBeenCalledWith('job-1');
    expect(eventSources).toHaveLength(1);

    await act(async () => {
      eventSources[0]?.emit('log', {
        eventId: '1',
        jobId: 'job-1',
        eventType: 'log',
        level: 'info',
        message: 'batch 1 complete',
        progress: null,
        payload: null,
        createdAt: '2026-04-25T00:01:00.000Z',
      });
      eventSources[0]?.emit('progress', {
        eventId: '2',
        jobId: 'job-1',
        eventType: 'progress',
        level: 'info',
        message: null,
        progress: {
          processed: 50,
          embedded: 50,
          failed: 0,
          total: 100,
          costUsd: 0.002,
          usageEstimated: false,
        },
        payload: null,
        createdAt: '2026-04-25T00:02:00.000Z',
      });
    });

    expect(await screen.findByText(/batch 1 complete/i)).toBeDefined();
    expect(screen.getByText(/50\/100 processed/i)).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /cancel job/i }));
    expect(onCancel).toHaveBeenCalledWith('job-1');

    unmount();
    expect(eventSources[0]?.close).toHaveBeenCalled();
  });

  it('shows a passive note instead of streaming when the job belongs to another executor peer', async () => {
    mockGetJob.mockResolvedValue({
      job: makeJob({ executorMachineId: 'peer-2', originMachineId: 'peer-2' }),
    });

    render(
      <JobDetailDrawer
        open
        jobId="job-1"
        machineId="local-machine"
        initialJob={makeJob({ executorMachineId: 'peer-2', originMachineId: 'peer-2' })}
        onCancel={vi.fn()}
        onOpenChange={vi.fn()}
      />,
    );

    expect(
      await screen.findByText(/live log streaming is only available on the executor peer/i),
    ).toBeDefined();
    expect(eventSources).toHaveLength(0);
  });
});
