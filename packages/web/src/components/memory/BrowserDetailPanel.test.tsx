import type { MemoryEdge, MemoryFact } from '@agentctl/shared';
import { fireEvent, render, screen } from '@testing-library/react';

import { BrowserDetailPanel } from './BrowserDetailPanel';

function makeFact(overrides: Partial<MemoryFact> = {}): MemoryFact {
  return {
    id: 'fact-1',
    scope: 'project:agentctl',
    content: 'Always use immutable patterns',
    content_model: 'text-embedding-3-small',
    entity_type: 'decision',
    confidence: 0.9,
    strength: 0.85,
    source: {
      session_id: 'session-1',
      agent_id: 'agent-1',
      machine_id: 'machine-1',
      turn_index: 4,
      extraction_method: 'manual',
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
    source_fact_id: 'fact-1',
    target_fact_id: 'fact-2',
    relation: 'related_to',
    weight: 0.6,
    created_at: '2026-03-11T10:00:00.000Z',
    ...overrides,
  };
}

describe('BrowserDetailPanel', () => {
  const defaultProps = {
    fact: null as MemoryFact | null,
    edges: [] as MemoryEdge[],
    isLoading: false,
    onClose: vi.fn(),
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows placeholder when no fact is selected', () => {
    render(<BrowserDetailPanel {...defaultProps} />);

    expect(screen.getByText('Select a fact to view details.')).toBeDefined();
  });

  it('renders fact content, badges, and source info', () => {
    const fact = makeFact();
    render(<BrowserDetailPanel {...defaultProps} fact={fact} />);

    expect(screen.getByText('Always use immutable patterns')).toBeDefined();
    expect(screen.getByText('decision')).toBeDefined();
    expect(screen.getByText('project:agentctl')).toBeDefined();
    expect(screen.getByText('agent-1')).toBeDefined();
    expect(screen.getByText('manual')).toBeDefined();
  });

  it('renders edges when present', () => {
    const fact = makeFact();
    const edges = [makeEdge()];
    render(<BrowserDetailPanel {...defaultProps} fact={fact} edges={edges} />);

    expect(screen.getByText('related to')).toBeDefined();
    expect(screen.getByText('Relationships (1)')).toBeDefined();
  });

  it('shows no relationships message when edges is empty', () => {
    const fact = makeFact();
    render(<BrowserDetailPanel {...defaultProps} fact={fact} />);

    expect(screen.getByText('No relationships.')).toBeDefined();
  });

  it('calls onClose when close button is clicked', () => {
    const fact = makeFact();
    render(<BrowserDetailPanel {...defaultProps} fact={fact} />);

    fireEvent.click(screen.getByLabelText('Close detail panel'));

    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('calls onDelete when delete button is clicked', () => {
    const fact = makeFact();
    render(<BrowserDetailPanel {...defaultProps} fact={fact} />);

    fireEvent.click(screen.getByLabelText('Delete fact'));

    expect(defaultProps.onDelete).toHaveBeenCalledWith('fact-1');
  });

  it('enters edit mode and saves content changes', () => {
    const fact = makeFact();
    render(<BrowserDetailPanel {...defaultProps} fact={fact} />);

    // Click edit button
    fireEvent.click(screen.getByLabelText('Edit fact'));

    // Textarea should appear
    const textarea = screen.getByLabelText('Edit fact content');
    expect(textarea).toBeDefined();

    // Change content and save
    fireEvent.change(textarea, { target: { value: 'Updated content' } });
    fireEvent.click(screen.getByText('Save'));

    expect(defaultProps.onUpdate).toHaveBeenCalledWith('fact-1', { content: 'Updated content' });
  });

  it('cancels edit mode without saving', () => {
    const fact = makeFact();
    render(<BrowserDetailPanel {...defaultProps} fact={fact} />);

    fireEvent.click(screen.getByLabelText('Edit fact'));
    fireEvent.change(screen.getByLabelText('Edit fact content'), {
      target: { value: 'Changed but not saved' },
    });
    fireEvent.click(screen.getByText('Cancel'));

    expect(defaultProps.onUpdate).not.toHaveBeenCalled();
    // Original content should be shown
    expect(screen.getByText('Always use immutable patterns')).toBeDefined();
  });
});
