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
  useRunMemorySynthesis: () => mockUseMutation(),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import type { MemorySynthesisResult } from '@/lib/api';
import { MemorySynthesisPage } from './MemorySynthesisPage';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleResult: MemorySynthesisResult = {
  lint: {
    nearDuplicates: [
      {
        factIdA: 'fact-aaaa-1111',
        factIdB: 'fact-bbbb-2222',
        similarity: 0.87,
        contentA: 'Claude prefers dark mode UI.',
        contentB: 'The user always uses dark mode in Claude.',
      },
    ],
    staleFacts: [
      {
        factId: 'fact-cccc-3333',
        content: 'Legacy port 3000 used for old web dev.',
        lastAccessedDaysAgo: 45,
      },
    ],
    orphanFacts: [
      {
        factId: 'fact-dddd-4444',
        content: 'Disconnected note about tailscale.',
        entityType: 'note',
        createdAt: '2026-01-02T00:00:00Z',
      },
    ],
  },
  synthesisGroups: [
    {
      entityType: 'preference',
      factIds: ['fact-eeee-5555', 'fact-ffff-6666', 'fact-gggg-7777'],
      factContents: ['Pref A', 'Pref B', 'Pref C'],
      proposalHint: 'Consider synthesising 3 preference facts into a higher-level principle',
    },
  ],
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

describe('MemorySynthesisPage', () => {
  beforeEach(() => {
    setupDefaultMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the page heading', () => {
    render(<MemorySynthesisPage />);
    expect(screen.getByText('Knowledge Synthesis')).toBeDefined();
  });

  it('renders the scope selector and run button', () => {
    render(<MemorySynthesisPage />);
    expect(screen.getByLabelText('Scope')).toBeDefined();
    expect(screen.getByRole('button', { name: /run knowledge synthesis/i })).toBeDefined();
  });

  it('shows the empty placeholder before any run', () => {
    render(<MemorySynthesisPage />);
    expect(screen.getByText(/no synthesis results yet/i)).toBeDefined();
  });

  it('calls mutate when the run button is clicked', () => {
    render(<MemorySynthesisPage />);
    fireEvent.click(screen.getByRole('button', { name: /run knowledge synthesis/i }));
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ scope: undefined }),
      expect.any(Object),
    );
  });

  it('passes a scope filter when the user selects a non-all scope', () => {
    render(<MemorySynthesisPage />);
    const select = screen.getByLabelText('Scope') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'global' } });
    fireEvent.click(screen.getByRole('button', { name: /run knowledge synthesis/i }));
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'global' }),
      expect.any(Object),
    );
  });

  it('shows an error banner when mutation reports an error', () => {
    setupDefaultMocks({ isError: true });
    render(<MemorySynthesisPage />);
    expect(screen.getByRole('alert')).toBeDefined();
  });

  it('renders all result sections after a successful run', async () => {
    let capturedOnSuccess:
      | ((data: { ok: boolean; result: MemorySynthesisResult }) => void)
      | undefined;
    mockMutate.mockImplementation(
      (
        _body: unknown,
        opts: { onSuccess: (data: { ok: boolean; result: MemorySynthesisResult }) => void },
      ) => {
        capturedOnSuccess = opts.onSuccess;
      },
    );

    render(<MemorySynthesisPage />);
    fireEvent.click(screen.getByRole('button', { name: /run knowledge synthesis/i }));
    capturedOnSuccess?.({ ok: true, result: sampleResult });

    await waitFor(() => {
      expect(screen.getByText('Near-duplicates')).toBeDefined();
      expect(screen.getByText('Stale facts')).toBeDefined();
      expect(screen.getByText('Orphan facts')).toBeDefined();
      expect(screen.getByText('Principle candidates')).toBeDefined();
    });
  });

  it('links each fact id back to the memory browser', async () => {
    let capturedOnSuccess:
      | ((data: { ok: boolean; result: MemorySynthesisResult }) => void)
      | undefined;
    mockMutate.mockImplementation(
      (
        _body: unknown,
        opts: { onSuccess: (data: { ok: boolean; result: MemorySynthesisResult }) => void },
      ) => {
        capturedOnSuccess = opts.onSuccess;
      },
    );

    render(<MemorySynthesisPage />);
    fireEvent.click(screen.getByRole('button', { name: /run knowledge synthesis/i }));
    capturedOnSuccess?.({ ok: true, result: sampleResult });

    await waitFor(() => {
      const links = screen.getAllByRole('link');
      expect(links.length).toBeGreaterThan(0);
      const hrefs = links.map((link) => link.getAttribute('href') ?? '');
      expect(hrefs.some((href) => href.startsWith('/memory/browser?q=fact-aaaa-1111'))).toBe(true);
    });
  });

  it('renders principle candidates with readable fact previews instead of raw id streams', async () => {
    let capturedOnSuccess:
      | ((data: { ok: boolean; result: MemorySynthesisResult }) => void)
      | undefined;
    mockMutate.mockImplementation(
      (
        _body: unknown,
        opts: { onSuccess: (data: { ok: boolean; result: MemorySynthesisResult }) => void },
      ) => {
        capturedOnSuccess = opts.onSuccess;
      },
    );

    render(<MemorySynthesisPage />);
    fireEvent.click(screen.getByRole('button', { name: /run knowledge synthesis/i }));
    capturedOnSuccess?.({ ok: true, result: sampleResult });

    await waitFor(() => {
      expect(screen.getByText('Pref A')).toBeDefined();
      expect(screen.getByText('Pref B')).toBeDefined();
      expect(screen.queryByText(/fact-eeee/i)).toBeNull();
    });
  });

  it('shows the clean-graph state when the result has no issues', async () => {
    let capturedOnSuccess:
      | ((data: { ok: boolean; result: MemorySynthesisResult }) => void)
      | undefined;
    mockMutate.mockImplementation(
      (
        _body: unknown,
        opts: { onSuccess: (data: { ok: boolean; result: MemorySynthesisResult }) => void },
      ) => {
        capturedOnSuccess = opts.onSuccess;
      },
    );

    render(<MemorySynthesisPage />);
    fireEvent.click(screen.getByRole('button', { name: /run knowledge synthesis/i }));
    capturedOnSuccess?.({
      ok: true,
      result: {
        lint: { nearDuplicates: [], staleFacts: [], orphanFacts: [] },
        synthesisGroups: [],
      },
    });

    await waitFor(() => {
      expect(screen.getByText(/knowledge graph looks clean/i)).toBeDefined();
    });
  });

  it('shows a pending state while the mutation is running', () => {
    setupDefaultMocks({ isPending: true });
    render(<MemorySynthesisPage />);
    expect(screen.getByText(/running synthesis/i)).toBeDefined();
  });
});
