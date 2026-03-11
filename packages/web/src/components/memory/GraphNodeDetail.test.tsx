import type { MemoryEdge, MemoryFact } from '@agentctl/shared';
import { fireEvent, render, screen } from '@testing-library/react';

import { GraphNodeDetail } from './GraphNodeDetail';

function makeNode(overrides: Partial<MemoryFact> = {}): MemoryFact {
  return {
    id: 'node-1',
    scope: 'project:agentctl',
    content: 'Use immutable data patterns throughout the codebase',
    content_model: 'text-embedding-3-small',
    entity_type: 'pattern',
    confidence: 0.9,
    strength: 0.85,
    source: {
      session_id: 'session-1',
      agent_id: 'agent-1',
      machine_id: 'machine-1',
      turn_index: 2,
      extraction_method: 'llm',
    },
    valid_from: '2026-03-11T10:00:00.000Z',
    valid_until: null,
    created_at: '2026-03-11T10:00:00.000Z',
    accessed_at: '2026-03-11T11:00:00.000Z',
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

describe('GraphNodeDetail', () => {
  const defaultProps = {
    node: null as MemoryFact | null,
    edges: [] as MemoryEdge[],
    isLoading: false,
    onClose: vi.fn(),
    onSelectNode: vi.fn(),
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows placeholder when no node is selected', () => {
    render(<GraphNodeDetail {...defaultProps} />);

    expect(screen.getByText(/Click a row to inspect/)).toBeDefined();
  });

  it('renders node content and badges when node is selected', () => {
    const node = makeNode();
    render(<GraphNodeDetail {...defaultProps} node={node} />);

    expect(screen.getByText('Use immutable data patterns throughout the codebase')).toBeDefined();
    expect(screen.getByText('pattern')).toBeDefined();
    expect(screen.getByText('project:agentctl')).toBeDefined();
  });

  it('shows loading indicator when isLoading is true', () => {
    const node = makeNode();
    render(<GraphNodeDetail {...defaultProps} node={node} isLoading={true} />);

    expect(screen.getByText('Loading…')).toBeDefined();
  });

  it('renders outgoing edges correctly', () => {
    const node = makeNode();
    const outgoingEdge = makeEdge({
      id: 'edge-out',
      source_fact_id: 'node-1',
      target_fact_id: 'node-2',
      relation: 'depends_on',
    });
    render(<GraphNodeDetail {...defaultProps} node={node} edges={[outgoingEdge]} />);

    expect(screen.getByText('Outgoing (1)')).toBeDefined();
    expect(screen.getByText('depends on')).toBeDefined();
  });

  it('renders incoming edges correctly', () => {
    const node = makeNode();
    const incomingEdge = makeEdge({
      id: 'edge-in',
      source_fact_id: 'node-99',
      target_fact_id: 'node-1',
      relation: 'resolves',
    });
    render(<GraphNodeDetail {...defaultProps} node={node} edges={[incomingEdge]} />);

    expect(screen.getByText('Incoming (1)')).toBeDefined();
    expect(screen.getByText('resolves')).toBeDefined();
  });

  it('shows no outgoing/incoming edges messages when empty', () => {
    const node = makeNode();
    render(<GraphNodeDetail {...defaultProps} node={node} edges={[]} />);

    expect(screen.getByText('No outgoing edges.')).toBeDefined();
    expect(screen.getByText('No incoming edges.')).toBeDefined();
  });

  it('calls onClose when close button is clicked', () => {
    const node = makeNode();
    render(<GraphNodeDetail {...defaultProps} node={node} />);

    fireEvent.click(screen.getByLabelText('Close node detail'));

    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('calls onSelectNode when an outgoing edge target button is clicked', () => {
    const node = makeNode();
    const outgoingEdge = makeEdge({
      source_fact_id: 'node-1',
      target_fact_id: 'abcdef1234567890',
    });
    render(<GraphNodeDetail {...defaultProps} node={node} edges={[outgoingEdge]} />);

    fireEvent.click(
      screen.getByLabelText(`Navigate to target node ${outgoingEdge.target_fact_id.slice(0, 8)}`),
    );

    expect(defaultProps.onSelectNode).toHaveBeenCalledWith('abcdef1234567890');
  });

  it('calls onSelectNode when an incoming edge source button is clicked', () => {
    const node = makeNode();
    const incomingEdge = makeEdge({
      source_fact_id: 'abcdef9876543210',
      target_fact_id: 'node-1',
    });
    render(<GraphNodeDetail {...defaultProps} node={node} edges={[incomingEdge]} />);

    fireEvent.click(
      screen.getByLabelText(`Navigate to source node ${incomingEdge.source_fact_id.slice(0, 8)}`),
    );

    expect(defaultProps.onSelectNode).toHaveBeenCalledWith('abcdef9876543210');
  });

  it('displays source metadata', () => {
    const node = makeNode();
    render(<GraphNodeDetail {...defaultProps} node={node} />);

    expect(screen.getByText('agent-1')).toBeDefined();
    expect(screen.getByText('llm')).toBeDefined();
  });
});
