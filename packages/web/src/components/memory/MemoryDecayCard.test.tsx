import { render, screen } from '@testing-library/react';

import type { MemoryDecayStats } from '@/lib/api';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockUseQuery, mockUseRunMemoryDecay, mockToast } = vi.hoisted(() => ({
  mockUseQuery: vi.fn(),
  mockUseRunMemoryDecay: vi.fn(),
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), toast: vi.fn() },
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  queryOptions: (opts: unknown) => opts,
}));

vi.mock('@/lib/queries', () => ({
  memoryDecayStatsQuery: () => ({
    queryKey: ['memory', 'decay', 'stats'],
    queryFn: vi.fn(),
  }),
  useRunMemoryDecay: () => mockUseRunMemoryDecay(),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => mockToast,
}));

vi.mock('@/lib/format-utils', () => ({
  formatNumber: (n: number | null | undefined) => String(n ?? 0),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@/components/ui/card', () => ({
  Card: ({ children, ...props }: React.ComponentProps<'div'>) => <div {...props}>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/alert-dialog', () => {
  const Wrap = ({ children, open }: { children: React.ReactNode; open?: boolean }) =>
    open ? <div data-testid="alert-dialog">{children}</div> : null;
  const Pass = ({ children, ...props }: React.ComponentProps<'div'>) => (
    <div {...props}>{children}</div>
  );
  const ActionBtn = ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button type="button" {...props}>
      {children}
    </button>
  );
  return {
    AlertDialog: Wrap,
    AlertDialogContent: Pass,
    AlertDialogHeader: Pass,
    AlertDialogFooter: Pass,
    AlertDialogTitle: Pass,
    AlertDialogDescription: Pass,
    AlertDialogAction: ActionBtn,
    AlertDialogCancel: ActionBtn,
  };
});

// ---------------------------------------------------------------------------
// Component import — AFTER mocks
// ---------------------------------------------------------------------------

import { MemoryDecayCard } from './MemoryDecayCard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDecayStats(overrides: Partial<MemoryDecayStats> = {}): MemoryDecayStats {
  return {
    strengthDistribution: {
      low: 12,
      mediumLow: 20,
      mediumHigh: 30,
      high: 80,
    },
    pinnedCount: 5,
    archivedCount: 42,
    ...overrides,
  };
}

function makeRunDecayMock(
  overrides: Partial<{
    isPending: boolean;
    data: { ok: boolean; result: { decayed: number; archived: number; skipped: number } } | null;
    mutate: ReturnType<typeof vi.fn>;
  }> = {},
) {
  return {
    isPending: overrides.isPending ?? false,
    data: overrides.data ?? null,
    mutate: overrides.mutate ?? vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MemoryDecayCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRunMemoryDecay.mockReturnValue(makeRunDecayMock());
  });

  it('renders loading skeleton while stats are loading', () => {
    mockUseQuery.mockReturnValue({ data: null, isLoading: true, error: null });

    render(<MemoryDecayCard />);

    expect(screen.getByTestId('memory-decay-loading')).toBeDefined();
    expect(screen.queryByTestId('memory-decay-eligible')).toBeNull();
  });

  it('renders stat rows with values from the API', () => {
    mockUseQuery.mockReturnValue({
      data: { ok: true, stats: makeDecayStats() },
      isLoading: false,
      error: null,
    });

    render(<MemoryDecayCard />);

    expect(screen.getByTestId('memory-decay-eligible').textContent).toBe('12');
    expect(screen.getByTestId('memory-decay-pinned').textContent).toBe('5');
    expect(screen.getByTestId('memory-decay-archived').textContent).toBe('42');
  });

  it('disables the trigger button while stats are loading', () => {
    mockUseQuery.mockReturnValue({ data: null, isLoading: true, error: null });

    render(<MemoryDecayCard />);

    const button = screen.getByTestId('memory-decay-trigger-button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('disables the trigger button and shows running state while a decay is in-flight', () => {
    mockUseQuery.mockReturnValue({
      data: { ok: true, stats: makeDecayStats() },
      isLoading: false,
      error: null,
    });
    mockUseRunMemoryDecay.mockReturnValue(makeRunDecayMock({ isPending: true }));

    render(<MemoryDecayCard />);

    const button = screen.getByTestId('memory-decay-trigger-button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent ?? '').toMatch(/Running/);
  });

  it('renders an error message when the stats query fails', () => {
    mockUseQuery.mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error('Network down'),
    });

    render(<MemoryDecayCard />);

    expect(screen.getByTestId('memory-decay-error').textContent).toMatch(/Network down/);
  });
});
