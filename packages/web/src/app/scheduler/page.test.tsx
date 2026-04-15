import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockListJobs } = vi.hoisted(() => ({
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
      createSchedulerHeartbeatJob: vi.fn(),
      createSchedulerCronJob: vi.fn(),
      deleteSchedulerJob: vi.fn(),
    },
  };
});

// ---------------------------------------------------------------------------
// Component import — AFTER mocks
// ---------------------------------------------------------------------------

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
  });

  it('renders heading and empty state without crashing', async () => {
    renderPage();
    expect(screen.getByText('Scheduler')).toBeDefined();
    await waitFor(() => {
      expect(screen.getByTestId('scheduler-jobs-empty')).toBeDefined();
    });
  });
});
