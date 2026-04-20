import type { MemoryFact } from '@agentctl/shared';
import { fireEvent, render, screen } from '@testing-library/react';

const mockSearchParams = new URLSearchParams();
const mockUseSearchParams = vi.fn(() => mockSearchParams);

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockUseSearchParams(),
}));

const mockUseQuery = vi.fn();
const mockUseQueryClient = vi.fn(() => ({
  invalidateQueries: vi.fn(),
}));
const mockUseMutation = vi.fn(() => ({
  mutate: vi.fn(),
  isPending: false,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  useQueryClient: () => mockUseQueryClient(),
  useMutation: (...args: unknown[]) => mockUseMutation(...args),
  queryOptions: (opts: unknown) => opts,
}));

const mockDeleteMutate = vi.fn();
const mockDeleteMutation = { mutate: mockDeleteMutate, isPending: false };

vi.mock('@/lib/queries', () => ({
  memoryFactsQuery: (params?: unknown) => ({
    queryKey: ['memory', 'facts', params],
    queryFn: vi.fn(),
  }),
  memoryFactQuery: (id: string) => ({
    queryKey: ['memory', 'fact', id],
    queryFn: vi.fn(),
    enabled: !!id,
  }),
  queryKeys: {
    memory: {
      facts: () => ['memory', 'facts'],
      fact: (id: string) => ['memory', 'fact', id],
      stats: ['memory', 'stats'],
    },
  },
  useCreateMemoryFact: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateMemoryFact: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteMemoryFact: () => mockDeleteMutation,
  useSubmitFactFeedback: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { MemoryBrowserView } from './MemoryBrowserView';

function makeFact(overrides: Partial<MemoryFact> = {}): MemoryFact {
  return {
    id: 'fact-1',
    scope: 'project:agentctl',
    content: 'Test memory fact content',
    content_model: 'text-embedding-3-small',
    entity_type: 'decision',
    confidence: 0.9,
    strength: 0.8,
    source: {
      session_id: 'session-1',
      agent_id: 'agent-1',
      machine_id: 'machine-1',
      turn_index: 1,
      extraction_method: 'manual',
    },
    valid_from: '2026-03-11T10:00:00.000Z',
    valid_until: null,
    created_at: '2026-03-11T10:00:00.000Z',
    accessed_at: '2026-03-11T10:00:00.000Z',
    ...overrides,
  };
}

describe('MemoryBrowserView', () => {
  beforeEach(() => {
    // Mock window.history.replaceState
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});

    mockUseQuery.mockImplementation((opts: { queryKey: unknown[]; enabled?: boolean }) => {
      // Facts list query
      if (
        Array.isArray(opts.queryKey) &&
        opts.queryKey[0] === 'memory' &&
        opts.queryKey[1] === 'facts'
      ) {
        return {
          data: {
            facts: [
              makeFact({ id: 'fact-1', content: 'First fact' }),
              makeFact({ id: 'fact-2', content: 'Second fact', entity_type: 'pattern' }),
            ],
            total: 2,
          },
          isLoading: false,
        };
      }
      // Single fact detail query
      if (
        Array.isArray(opts.queryKey) &&
        opts.queryKey[0] === 'memory' &&
        opts.queryKey[1] === 'fact'
      ) {
        return {
          data: null,
          isLoading: false,
        };
      }
      return { data: null, isLoading: false };
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the filter sidebar, facts count, and facts list', () => {
    render(<MemoryBrowserView />);

    expect(screen.getByLabelText('Search facts')).toBeDefined();
    expect(screen.getByText('2 facts')).toBeDefined();
    expect(screen.getByText('First fact')).toBeDefined();
    expect(screen.getByText('Second fact')).toBeDefined();
  });

  it('shows loading state', () => {
    mockUseQuery.mockImplementation(() => ({
      data: null,
      isLoading: true,
    }));

    render(<MemoryBrowserView />);

    expect(screen.getByTestId('memory-browser-count-skeleton')).toBeDefined();
  });

  it('shows empty state when no facts match', () => {
    mockUseQuery.mockImplementation(() => ({
      data: { facts: [], total: 0 },
      isLoading: false,
    }));

    render(<MemoryBrowserView />);

    expect(screen.getByText(/0 fact/)).toBeDefined();
    expect(
      screen.getByText(
        'Memory stores facts about your projects. Import from claude-mem or create facts manually.',
      ),
    ).toBeDefined();
    expect(screen.getByRole('link', { name: 'Import from claude-mem' })).toBeDefined();
    expect(screen.getByText('No facts found matching your filters.')).toBeDefined();
  });

  it('updates URL when search changes', () => {
    render(<MemoryBrowserView />);

    fireEvent.change(screen.getByLabelText('Search facts'), { target: { value: 'test query' } });

    expect(window.history.replaceState).toHaveBeenCalled();
  });

  describe('delete confirmation dialog', () => {
    it('shows confirmation dialog when bulk delete is triggered', () => {
      render(<MemoryBrowserView />);

      // Select a fact via its checkbox
      const checkbox = screen.getByLabelText(/Select fact: First fact/);
      fireEvent.click(checkbox);

      // Click Delete button in the bulk action bar
      const deleteButton = screen.getByRole('button', { name: /Delete/ });
      fireEvent.click(deleteButton);

      // Dialog should appear
      expect(screen.getByTestId('memory-delete-confirm')).toBeDefined();
      expect(screen.getByText('Delete 1 facts?')).toBeDefined();
      expect(
        screen.getByText('This will permanently remove the selected facts from memory.'),
      ).toBeDefined();

      // mutate should NOT have been called yet
      expect(mockDeleteMutate).not.toHaveBeenCalled();
    });

    it('does not delete when cancel is clicked', () => {
      render(<MemoryBrowserView />);

      // Select and trigger delete
      const checkbox = screen.getByLabelText(/Select fact: First fact/);
      fireEvent.click(checkbox);
      const deleteButton = screen.getByRole('button', { name: /Delete/ });
      fireEvent.click(deleteButton);

      // Click Cancel
      fireEvent.click(screen.getByTestId('memory-delete-cancel'));

      // Dialog should be gone
      expect(screen.queryByTestId('memory-delete-confirm')).toBeNull();

      // mutate should NOT have been called
      expect(mockDeleteMutate).not.toHaveBeenCalled();
    });

    it('calls delete mutation when confirmed', () => {
      render(<MemoryBrowserView />);

      // Select and trigger delete
      const checkbox = screen.getByLabelText(/Select fact: First fact/);
      fireEvent.click(checkbox);
      const deleteButton = screen.getByRole('button', { name: /Delete/ });
      fireEvent.click(deleteButton);

      // Click the confirm Delete button
      fireEvent.click(screen.getByTestId('memory-delete-confirm-btn'));

      // mutate should have been called with the fact id
      expect(mockDeleteMutate).toHaveBeenCalledWith('fact-1');

      // Dialog should be gone
      expect(screen.queryByTestId('memory-delete-confirm')).toBeNull();
    });
  });

  describe('drawer results section', () => {
    it('does not render when drawerResults is absent', () => {
      render(<MemoryBrowserView />);

      expect(screen.queryByTestId('drawer-results-section')).toBeNull();
    });

    it('does not render when drawerResults is an empty array', () => {
      mockUseQuery.mockImplementation((opts: { queryKey: unknown[]; enabled?: boolean }) => {
        if (
          Array.isArray(opts.queryKey) &&
          opts.queryKey[0] === 'memory' &&
          opts.queryKey[1] === 'facts'
        ) {
          return {
            data: {
              facts: [makeFact({ id: 'fact-1', content: 'First fact' })],
              total: 1,
              drawerResults: [],
            },
            isLoading: false,
          };
        }
        return { data: null, isLoading: false };
      });

      render(<MemoryBrowserView />);

      expect(screen.queryByTestId('drawer-results-section')).toBeNull();
    });

    it('renders the drawer results section when drawerResults is non-empty', () => {
      mockUseQuery.mockImplementation((opts: { queryKey: unknown[]; enabled?: boolean }) => {
        if (
          Array.isArray(opts.queryKey) &&
          opts.queryKey[0] === 'memory' &&
          opts.queryKey[1] === 'facts'
        ) {
          return {
            data: {
              facts: [makeFact({ id: 'fact-1', content: 'First fact' })],
              total: 1,
              drawerResults: [
                {
                  id: 'drawer-1',
                  scope: 'project:agentctl',
                  topic: 'fusion-topic',
                  source_type: 'session',
                  source_id: 'session-1',
                  chunk_index: 0,
                  content_preview: 'fusion preview',
                  score: 0.42,
                  match_type: 'keyword',
                },
              ],
            },
            isLoading: false,
          };
        }
        return { data: null, isLoading: false };
      });

      render(<MemoryBrowserView />);

      expect(screen.getByTestId('drawer-results-section')).toBeDefined();
      expect(screen.getByText('Raw Drawers (1)')).toBeDefined();
      expect(screen.getByText('fusion-topic')).toBeDefined();
    });
  });
});
