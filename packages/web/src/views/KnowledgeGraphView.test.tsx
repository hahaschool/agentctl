import type { MemoryEdge, MemoryFact } from '@agentctl/shared';
import { fireEvent, render, screen } from '@testing-library/react';

const mockUseQuery = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => mockUseQuery(...args),
  queryOptions: (opts: unknown) => opts,
}));

vi.mock('@/lib/queries', () => ({
  memoryGraphQuery: (params?: unknown) => ({
    queryKey: ['memory', 'graph', params],
    queryFn: vi.fn(),
  }),
  memoryFactQuery: (id: string) => ({
    queryKey: ['memory', 'fact', id],
    queryFn: vi.fn(),
    enabled: !!id,
  }),
}));

import { KnowledgeGraphView } from './KnowledgeGraphView';

function makeNode(overrides: Partial<MemoryFact> = {}): MemoryFact {
  return {
    id: 'node-1',
    scope: 'project:agentctl',
    content: 'BullMQ is preferred over Temporal for MVP',
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

function makeEdge(overrides: Partial<MemoryEdge> = {}): MemoryEdge {
  return {
    id: 'edge-1',
    source_fact_id: 'node-1',
    target_fact_id: 'node-2',
    relation: 'related_to',
    weight: 0.7,
    created_at: '2026-03-11T10:00:00.000Z',
    ...overrides,
  };
}

describe('KnowledgeGraphView', () => {
  beforeEach(() => {
    mockUseQuery.mockImplementation((opts: { queryKey: unknown[]; enabled?: boolean }) => {
      if (
        Array.isArray(opts.queryKey) &&
        opts.queryKey[0] === 'memory' &&
        opts.queryKey[1] === 'graph'
      ) {
        return {
          data: {
            nodes: [
              makeNode({ id: 'node-1', content: 'BullMQ decision' }),
              makeNode({ id: 'node-2', content: 'Redis pattern', entity_type: 'pattern' }),
            ],
            edges: [
              makeEdge({
                source_fact_id: 'node-1',
                target_fact_id: 'node-2',
                relation: 'depends_on',
              }),
            ],
          },
          isLoading: false,
        };
      }
      if (
        Array.isArray(opts.queryKey) &&
        opts.queryKey[0] === 'memory' &&
        opts.queryKey[1] === 'fact'
      ) {
        return { data: null, isLoading: false };
      }
      return { data: null, isLoading: false };
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders view switcher tabs', () => {
    render(<KnowledgeGraphView />);

    expect(screen.getByText('Table')).toBeDefined();
    expect(screen.getByText('Graph')).toBeDefined();
  });

  it('shows Table view by default', () => {
    render(<KnowledgeGraphView />);

    // Table renders edges — at least one "depends on" span cell should be visible
    // (select options also contain this text, so use getAllByText)
    expect(screen.getAllByText('depends on').length).toBeGreaterThanOrEqual(1);
    // The graph placeholder should NOT be visible
    expect(screen.queryByText('Interactive Graph View')).toBeNull();
  });

  it('shows node and edge counts from query data', () => {
    render(<KnowledgeGraphView />);

    expect(screen.getByText('2 nodes, 1 edge')).toBeDefined();
  });

  it('shows loading state in header when graph is loading', () => {
    mockUseQuery.mockImplementation(() => ({ data: null, isLoading: true }));

    render(<KnowledgeGraphView />);

    expect(screen.getByTestId('knowledge-graph-count-skeleton')).toBeDefined();
  });

  it('switches to Graph placeholder when Graph tab is clicked', () => {
    render(<KnowledgeGraphView />);

    fireEvent.click(screen.getByText('Graph'));

    expect(screen.getByText('Interactive Graph View')).toBeDefined();
  });

  it('switches back to Table view when Table tab is clicked', () => {
    render(<KnowledgeGraphView />);

    // Switch to Graph
    fireEvent.click(screen.getByRole('button', { name: 'Graph' }));
    expect(screen.getByText('Interactive Graph View')).toBeDefined();

    // Switch back to Table — use role-based query to avoid matching the <span>Table</span> in placeholder
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    expect(screen.getAllByText('depends on').length).toBeGreaterThanOrEqual(1);
  });

  it('renders global filter controls', () => {
    render(<KnowledgeGraphView />);

    // Both KnowledgeGraphView header and GraphTableView toolbar have scope/entity type filters;
    // we just verify at least one of each is present.
    expect(screen.getAllByLabelText('Scope filter').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByLabelText('Entity type filter').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText('Node limit')).toBeDefined();
  });

  it('shows node detail panel when a node is selected from the table', () => {
    const nodeWithDetail = makeNode({ id: 'node-1' });

    mockUseQuery.mockImplementation((opts: { queryKey: unknown[]; enabled?: boolean }) => {
      if (
        Array.isArray(opts.queryKey) &&
        opts.queryKey[0] === 'memory' &&
        opts.queryKey[1] === 'fact' &&
        opts.enabled
      ) {
        return {
          data: { fact: nodeWithDetail, edges: [] },
          isLoading: false,
        };
      }
      if (
        Array.isArray(opts.queryKey) &&
        opts.queryKey[0] === 'memory' &&
        opts.queryKey[1] === 'graph'
      ) {
        return {
          data: {
            nodes: [
              makeNode({ id: 'node-1', content: 'BullMQ decision' }),
              makeNode({ id: 'node-2', content: 'Redis pattern', entity_type: 'pattern' }),
            ],
            edges: [makeEdge({ source_fact_id: 'node-1', target_fact_id: 'node-2' })],
          },
          isLoading: false,
        };
      }
      return { data: null, isLoading: false };
    });

    render(<KnowledgeGraphView />);

    // Click a node in the table — aria-label uses first 8 chars of id
    fireEvent.click(screen.getByLabelText('Select source node node-1'));

    // GraphNodeDetail panel heading should appear
    expect(screen.getByText('Node Detail')).toBeDefined();
  });
});
