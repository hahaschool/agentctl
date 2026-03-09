import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DiscoverPage } from './DiscoverPage';

const mockDiscoverQuery = vi.fn();

vi.mock('@/hooks/use-hotkeys', () => ({
  useHotkeys: vi.fn(),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/FetchingBar', () => ({
  FetchingBar: ({ isFetching }: { isFetching: boolean }) => (
    <div data-testid="fetching-bar">{isFetching ? 'fetching' : 'idle'}</div>
  ),
}));

vi.mock('@/components/LastUpdated', () => ({
  LastUpdated: ({ dataUpdatedAt }: { dataUpdatedAt: number }) => (
    <div data-testid="last-updated">{dataUpdatedAt}</div>
  ),
}));

vi.mock('@/components/LiveTimeAgo', () => ({
  LiveTimeAgo: ({ date }: { date: string }) => <span data-testid="time-ago">{date}</span>,
}));

vi.mock('@/components/SessionPreview', () => ({
  SessionPreview: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="session-preview">{sessionId}</div>
  ),
}));

vi.mock('@/lib/queries', () => ({
  discoverQuery: () => mockDiscoverQuery(),
  queryKeys: {
    sessions: () => ['sessions'],
    discover: ['discover'],
  },
}));

function renderDiscoverPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <DiscoverPage />
    </QueryClientProvider>,
  );
}

describe('DiscoverPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
      writable: true,
    });

    mockDiscoverQuery.mockReturnValue({
      queryKey: ['discover'],
      queryFn: vi.fn().mockResolvedValue({
        sessions: [
          {
            sessionId: 'session-1',
            projectPath: '/Users/hahaschool/project-alpha',
            summary: 'Investigate nested button hydration issue',
            messageCount: 12,
            lastActivity: '2026-03-09T09:00:00.000Z',
            branch: 'fix/discover-semantic-structure',
            machineId: 'machine-1',
            hostname: 'mac-mini',
          },
        ],
        count: 1,
        machinesQueried: 1,
        machinesFailed: 0,
      }),
      dataUpdatedAt: Date.now(),
      isLoading: false,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not render nested buttons in grouped session rows', async () => {
    const { container } = renderDiscoverPage();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Discover Sessions' })).toBeDefined();
      expect(screen.getByText('project-alpha')).toBeDefined();
    });

    expect(container.querySelector('button button')).toBeNull();
  });
});
