import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockCreateCronJob, mockCreateHeartbeatJob, mockDeleteSchedulerJob, mockListJobs } =
  vi.hoisted(() => ({
    mockCreateCronJob: vi.fn(),
    mockCreateHeartbeatJob: vi.fn(),
    mockDeleteSchedulerJob: vi.fn(),
    mockListJobs: vi.fn(),
  }));

// ---------------------------------------------------------------------------
// Module boundary mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ErrorBanner', () => ({
  ErrorBanner: ({ message }: { message: string }) => (
    <div data-testid="error-banner">{message}</div>
  ),
}));

vi.mock('@/components/FetchingBar', () => ({
  FetchingBar: () => <div data-testid="fetching-bar" />,
}));

vi.mock('@/components/RefreshButton', () => ({
  RefreshButton: ({ onClick }: { onClick: () => void }) => (
    <button type="button" data-testid="refresh-button" onClick={onClick}>
      Refresh
    </button>
  ),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/lib/api/scheduler', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/scheduler')>('@/lib/api/scheduler');
  return {
    ...actual,
    schedulerApi: {
      listSchedulerJobs: mockListJobs,
      createSchedulerHeartbeatJob: mockCreateHeartbeatJob,
      createSchedulerCronJob: mockCreateCronJob,
      deleteSchedulerJob: mockDeleteSchedulerJob,
    },
  };
});

// ---------------------------------------------------------------------------
// Component import — AFTER mocks
// ---------------------------------------------------------------------------

import { ApiError } from '@/lib/api/core';
import Page from './page';

function renderPage(): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Page />
    </QueryClientProvider>,
  );
}

describe('SchedulerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListJobs.mockResolvedValue([]);
    mockCreateHeartbeatJob.mockResolvedValue({ ok: true });
    mockCreateCronJob.mockResolvedValue({ ok: true });
    mockDeleteSchedulerJob.mockResolvedValue({ ok: true, key: 'agent-1', removedCount: 1 });
  });

  it('renders heading and empty state without crashing', async () => {
    renderPage();
    expect(screen.getByText('Scheduler')).toBeDefined();
    await waitFor(() => {
      expect(screen.getByTestId('scheduler-jobs-empty')).toBeDefined();
    });
  });

  it('renders the not-configured state for scheduler 501 responses', async () => {
    mockListJobs.mockRejectedValue(
      new ApiError(501, 'SCHEDULER_NOT_CONFIGURED', 'Repeatable job scheduler is not configured'),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('scheduler-not-configured')).toBeDefined();
    });
    expect(screen.queryByTestId('error-banner')).toBeNull();
    expect(screen.getByTestId('new-scheduler-job')).toHaveProperty('disabled', true);
  });

  it('creates heartbeat jobs with seconds converted to milliseconds', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('scheduler-jobs-empty')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('new-scheduler-job'));
    fireEvent.change(screen.getByLabelText('Agent ID'), { target: { value: ' agent-1 ' } });
    fireEvent.change(screen.getByLabelText('Machine ID'), { target: { value: ' machine-1 ' } });
    fireEvent.change(screen.getByLabelText('Interval (seconds)'), { target: { value: '15' } });
    fireEvent.click(screen.getByTestId('scheduler-submit'));

    await waitFor(() => {
      expect(mockCreateHeartbeatJob).toHaveBeenCalledWith({
        agentId: 'agent-1',
        machineId: 'machine-1',
        intervalMs: 15_000,
      });
    });
  });

  it('removes jobs by the agent id derived from the repeatable key', async () => {
    mockListJobs.mockResolvedValue([
      {
        key: 'heartbeat:agent-1',
        name: 'agentctl-heartbeat',
        pattern: null,
        every: '60000',
        next: 1_765_000_000_000,
      },
    ]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('heartbeat:agent-1')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('delete-heartbeat:agent-1'));
    fireEvent.click(screen.getByTestId('confirm-delete-scheduler-job'));

    await waitFor(() => {
      expect(mockDeleteSchedulerJob).toHaveBeenCalledWith('agent-1');
    });
  });
});
