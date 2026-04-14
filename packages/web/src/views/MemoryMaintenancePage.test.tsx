import { fireEvent, render, screen, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockMutate = vi.fn();
const mockUseMutation = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useMutation: (...args: unknown[]) => mockUseMutation(...args),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  queryOptions: (opts: unknown) => opts,
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/queries', () => ({
  useRunMemoryMaintenance: () => mockUseMutation(),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import type { MemoryMaintenanceResponse, MemoryMaintenanceResult } from '@/lib/api';
import { MemoryMaintenancePage } from './MemoryMaintenancePage';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleResult: MemoryMaintenanceResult = {
  staleEntries: [
    {
      factId: 'fact-stale-0001',
      content: 'Reference to packages/old/gone.ts for the Foo pattern.',
      referencedPaths: ['packages/old/gone.ts'],
      reason: 'referenced path no longer exists',
    },
  ],
  deletedFileEntries: [
    {
      factId: 'fact-del-0002',
      content: 'Notes about legacy-worker.ts',
      deletedFile: 'packages/agent-worker/src/legacy-worker.ts',
    },
  ],
  synthesisClusters: [
    {
      seedFactId: 'fact-seed-0003',
      factIds: ['fact-seed-0003', 'fact-cluster-0004', 'fact-cluster-0005'],
      factContents: ['A', 'B', 'C'],
      proposedPrinciple: 'Propose higher-level principle linking 3 facts about caching.',
    },
  ],
  coverageReport: {
    covered: [{ directory: 'packages/shared', factCount: 12 }],
    gaps: [
      { directory: 'packages/control-plane/src/scheduler', factCount: 0 },
      { directory: 'packages/agent-worker/src/hooks', factCount: 0 },
    ],
    totalDirectories: 3,
    coveredCount: 1,
    gapCount: 2,
  },
  consolidationItems: [],
  report: {
    id: 'report-aaaa-bbbb',
    type: 'knowledge-health',
    scope: 'all',
    periodStart: '2026-04-01T00:00:00Z',
    periodEnd: '2026-04-14T00:00:00Z',
    content: '## summary',
    metadata: { factCount: 2, newFacts: 1, topEntities: [] },
    generatedAt: '2026-04-14T00:00:00Z',
  },
};

const sampleResponse: MemoryMaintenanceResponse = {
  ok: true,
  summary: {
    staleEntries: 1,
    deletedFileEntries: 1,
    synthesisClusters: 1,
    consolidationItems: 0,
    coverageReport: { totalDirectories: 3, covered: 1, gaps: 2 },
    reportId: 'report-aaaa-bbbb',
  },
  result: sampleResult,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupDefaultMocks(overrides?: {
  isPending?: boolean;
  isError?: boolean;
  mutate?: typeof mockMutate;
}) {
  mockUseMutation.mockReturnValue({
    mutate: overrides?.mutate ?? mockMutate,
    isPending: overrides?.isPending ?? false,
    isError: overrides?.isError ?? false,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MemoryMaintenancePage', () => {
  beforeEach(() => {
    setupDefaultMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the page heading, scope selector, and run button', () => {
    render(<MemoryMaintenancePage />);
    expect(screen.getByText('Knowledge Maintenance')).toBeDefined();
    expect(screen.getByLabelText('Scope')).toBeDefined();
    expect(screen.getByRole('button', { name: /run memory maintenance/i })).toBeDefined();
  });

  it('shows the empty placeholder before any run', () => {
    render(<MemoryMaintenancePage />);
    expect(screen.getByText(/no maintenance results yet/i)).toBeDefined();
  });

  it('shows a pending state while the mutation is running', () => {
    setupDefaultMocks({ isPending: true });
    render(<MemoryMaintenancePage />);
    expect(screen.getByText(/running maintenance/i)).toBeDefined();
  });

  it('shows an error banner when mutation reports an error', () => {
    setupDefaultMocks({ isError: true });
    render(<MemoryMaintenancePage />);
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('passes a scope filter when the user selects a non-all scope', () => {
    render(<MemoryMaintenancePage />);
    const select = screen.getByLabelText('Scope') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'global' } });
    fireEvent.click(screen.getByRole('button', { name: /run memory maintenance/i }));
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'global' }),
      expect.any(Object),
    );
  });

  it('renders all result sections and fact links after a successful run', async () => {
    let capturedOnSuccess: ((data: MemoryMaintenanceResponse) => void) | undefined;
    mockMutate.mockImplementation(
      (_body: unknown, opts: { onSuccess: (data: MemoryMaintenanceResponse) => void }) => {
        capturedOnSuccess = opts.onSuccess;
      },
    );

    render(<MemoryMaintenancePage />);
    fireEvent.click(screen.getByRole('button', { name: /run memory maintenance/i }));
    capturedOnSuccess?.(sampleResponse);

    await waitFor(() => {
      expect(screen.getByText('Stale path references')).toBeDefined();
      expect(screen.getByText('Deleted-file references')).toBeDefined();
      expect(screen.getByText('Synthesis clusters')).toBeDefined();
      expect(screen.getByText('Coverage gaps')).toBeDefined();
    });

    const links = screen.getAllByRole('link');
    const hrefs = links.map((link) => link.getAttribute('href') ?? '');
    expect(hrefs.some((href) => href.startsWith('/memory/browser?q=fact-stale-0001'))).toBe(true);
    expect(hrefs.some((href) => href.startsWith('/memory/reports?reportId=report-aaaa-bbbb'))).toBe(
      true,
    );
  });

  it('shows the clean-memory state when the result has no findings', async () => {
    let capturedOnSuccess: ((data: MemoryMaintenanceResponse) => void) | undefined;
    mockMutate.mockImplementation(
      (_body: unknown, opts: { onSuccess: (data: MemoryMaintenanceResponse) => void }) => {
        capturedOnSuccess = opts.onSuccess;
      },
    );

    render(<MemoryMaintenancePage />);
    fireEvent.click(screen.getByRole('button', { name: /run memory maintenance/i }));
    capturedOnSuccess?.({
      ok: true,
      summary: {
        staleEntries: 0,
        deletedFileEntries: 0,
        synthesisClusters: 0,
        consolidationItems: 0,
        coverageReport: { totalDirectories: 5, covered: 5, gaps: 0 },
        reportId: null,
      },
      result: {
        staleEntries: [],
        deletedFileEntries: [],
        synthesisClusters: [],
        coverageReport: {
          covered: [],
          gaps: [],
          totalDirectories: 5,
          coveredCount: 5,
          gapCount: 0,
        },
        consolidationItems: [],
        report: null,
      },
    });

    await waitFor(() => {
      expect(screen.getByText(/memory is clean/i)).toBeDefined();
    });
  });
});
