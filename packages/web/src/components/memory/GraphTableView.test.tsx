import type { MemoryEdge, MemoryFact } from '@agentctl/shared';
import { fireEvent, render, screen } from '@testing-library/react';

import { GraphTableView } from './GraphTableView';

function makeNode(overrides: Partial<MemoryFact> = {}): MemoryFact {
  return {
    id: 'node-1',
    scope: 'project:agentctl',
    content: 'Use BullMQ before Temporal for MVP',
    content_model: 'text-embedding-3-small',
    entity_type: 'decision',
    confidence: 0.88,
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
    weight: 0.6,
    created_at: '2026-03-11T10:00:00.000Z',
    ...overrides,
  };
}

describe('GraphTableView', () => {
  const defaultProps = {
    nodes: [] as MemoryFact[],
    edges: [] as MemoryEdge[],
    isLoading: false,
    selectedNodeId: null as string | null,
    onSelectNode: vi.fn(),
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state', () => {
    render(<GraphTableView {...defaultProps} isLoading={true} />);

    expect(screen.getByText('Loading graph data…')).toBeDefined();
  });

  it('shows empty state when no edges exist', () => {
    render(<GraphTableView {...defaultProps} />);

    expect(screen.getByText('No edges match the current filters.')).toBeDefined();
  });

  it('renders edges in the table', () => {
    const node1 = makeNode({ id: 'node-1', content: 'Source node content' });
    const node2 = makeNode({
      id: 'node-2',
      content: 'Target node content',
      entity_type: 'pattern',
    });
    const edge = makeEdge({ source_fact_id: 'node-1', target_fact_id: 'node-2' });

    render(<GraphTableView {...defaultProps} nodes={[node1, node2]} edges={[edge]} />);

    expect(screen.getByText('Source node content')).toBeDefined();
    expect(screen.getByText('Target node content')).toBeDefined();
    // There are two "related to" matches: the select option and the table cell span.
    expect(screen.getAllByText('related to').length).toBeGreaterThanOrEqual(1);
  });

  it('shows edge count in toolbar', () => {
    const node1 = makeNode({ id: 'node-1' });
    const node2 = makeNode({ id: 'node-2' });
    const edges = [
      makeEdge({ id: 'edge-1', source_fact_id: 'node-1', target_fact_id: 'node-2' }),
      makeEdge({ id: 'edge-2', source_fact_id: 'node-2', target_fact_id: 'node-1' }),
    ];

    render(<GraphTableView {...defaultProps} nodes={[node1, node2]} edges={edges} />);

    expect(screen.getByText('2 edges')).toBeDefined();
  });

  it('calls onSelectNode with source node id when source cell is clicked', () => {
    const node1 = makeNode({ id: 'node-source-id' });
    const node2 = makeNode({ id: 'node-target-id', content: 'Target content' });
    const edge = makeEdge({ source_fact_id: 'node-source-id', target_fact_id: 'node-target-id' });

    render(
      <GraphTableView
        {...defaultProps}
        nodes={[node1, node2]}
        edges={[edge]}
        onSelectNode={defaultProps.onSelectNode}
      />,
    );

    fireEvent.click(screen.getByLabelText(`Select source node ${edge.source_fact_id.slice(0, 8)}`));

    expect(defaultProps.onSelectNode).toHaveBeenCalledWith('node-source-id');
  });

  it('calls onSelectNode with null when same node is clicked again (deselect)', () => {
    const node1 = makeNode({ id: 'node-source-id' });
    const node2 = makeNode({ id: 'node-target-id', content: 'Target content' });
    const edge = makeEdge({ source_fact_id: 'node-source-id', target_fact_id: 'node-target-id' });

    render(
      <GraphTableView
        {...defaultProps}
        nodes={[node1, node2]}
        edges={[edge]}
        selectedNodeId="node-source-id"
        onSelectNode={defaultProps.onSelectNode}
      />,
    );

    fireEvent.click(screen.getByLabelText(`Select source node ${edge.source_fact_id.slice(0, 8)}`));

    expect(defaultProps.onSelectNode).toHaveBeenCalledWith(null);
  });

  it('filters edges by relation type', () => {
    const node1 = makeNode({ id: 'node-1' });
    const node2 = makeNode({ id: 'node-2', content: 'Node 2 content' });
    const node3 = makeNode({ id: 'node-3', content: 'Node 3 content', entity_type: 'concept' });
    const edges = [
      makeEdge({
        id: 'edge-1',
        relation: 'related_to',
        source_fact_id: 'node-1',
        target_fact_id: 'node-2',
      }),
      makeEdge({
        id: 'edge-2',
        relation: 'depends_on',
        source_fact_id: 'node-1',
        target_fact_id: 'node-3',
      }),
    ];

    render(<GraphTableView {...defaultProps} nodes={[node1, node2, node3]} edges={edges} />);

    // Change relation filter
    fireEvent.change(screen.getByLabelText('Relation type filter'), {
      target: { value: 'depends_on' },
    });

    expect(screen.getByText('1 edge')).toBeDefined();
    // The "related to" span cell should be gone (only the option element remains)
    const relatedToItems = screen.getAllByText('related to');
    // Only the option in the select dropdown should remain — no table cell span
    expect(relatedToItems.every((el) => el.tagName.toLowerCase() === 'option')).toBe(true);
    expect(screen.getAllByText('depends on').length).toBeGreaterThanOrEqual(1);
  });

  it('filters edges by text search', () => {
    const node1 = makeNode({ id: 'node-1', content: 'BullMQ scheduling decision' });
    const node2 = makeNode({
      id: 'node-2',
      content: 'Redis cache strategy',
      entity_type: 'pattern',
    });
    const node3 = makeNode({
      id: 'node-3',
      content: 'Temporal workflow engine',
      entity_type: 'concept',
    });
    const edges = [
      makeEdge({ id: 'edge-1', source_fact_id: 'node-1', target_fact_id: 'node-2' }),
      makeEdge({ id: 'edge-2', source_fact_id: 'node-1', target_fact_id: 'node-3' }),
    ];

    render(<GraphTableView {...defaultProps} nodes={[node1, node2, node3]} edges={edges} />);

    fireEvent.change(screen.getByLabelText('Filter graph nodes'), {
      target: { value: 'temporal' },
    });

    expect(screen.getByText('1 edge')).toBeDefined();
    expect(screen.getByText('Temporal workflow engine')).toBeDefined();
    expect(screen.queryByText('Redis cache strategy')).toBeNull();
  });

  it('shows clear filters button when filters are active', () => {
    render(<GraphTableView {...defaultProps} />);

    expect(screen.queryByText('Clear filters')).toBeNull();

    fireEvent.change(screen.getByLabelText('Relation type filter'), {
      target: { value: 'depends_on' },
    });

    expect(screen.getByText('Clear')).toBeDefined();
  });

  it('clears all filters when clear button is clicked', () => {
    const node1 = makeNode({ id: 'node-1' });
    const node2 = makeNode({ id: 'node-2', content: 'Node 2' });
    const edges = [
      makeEdge({ relation: 'depends_on', source_fact_id: 'node-1', target_fact_id: 'node-2' }),
    ];

    render(<GraphTableView {...defaultProps} nodes={[node1, node2]} edges={edges} />);

    // Apply a filter that hides the edge
    fireEvent.change(screen.getByLabelText('Relation type filter'), {
      target: { value: 'modifies' },
    });
    expect(screen.getByText('0 edges')).toBeDefined();

    // Clear filters
    fireEvent.click(screen.getByText('Clear'));
    expect(screen.getByText('1 edge')).toBeDefined();
  });

  it('highlights row when source node is selected', () => {
    const node1 = makeNode({ id: 'sel-source' });
    const node2 = makeNode({ id: 'sel-target', content: 'Target content' });
    const edge = makeEdge({ source_fact_id: 'sel-source', target_fact_id: 'sel-target' });

    const { container } = render(
      <GraphTableView
        {...defaultProps}
        nodes={[node1, node2]}
        edges={[edge]}
        selectedNodeId="sel-source"
      />,
    );

    const row = container.querySelector('tr.bg-accent\\/10');
    expect(row).not.toBeNull();
  });
});
