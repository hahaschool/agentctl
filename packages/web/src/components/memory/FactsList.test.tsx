import type { MemoryFact } from '@agentctl/shared';
import { fireEvent, render, screen } from '@testing-library/react';

import { FactsList } from './FactsList';

function makeFact(overrides: Partial<MemoryFact> = {}): MemoryFact {
  return {
    id: 'fact-1',
    scope: 'project:agentctl',
    content: 'Use the memory route shell as the landing page',
    content_model: 'text-embedding-3-small',
    entity_type: 'decision',
    confidence: 0.84,
    strength: 0.9,
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

const FACTS = [
  makeFact({ id: 'fact-1', content: 'First fact' }),
  makeFact({ id: 'fact-2', content: 'Second fact', entity_type: 'pattern' }),
  makeFact({ id: 'fact-3', content: 'Third fact', entity_type: 'error' }),
];

describe('FactsList', () => {
  const defaultProps = {
    facts: FACTS,
    isLoading: false,
    selectedFactId: null,
    selectedIds: new Set<string>(),
    onSelectFact: vi.fn(),
    onToggleSelection: vi.fn(),
    onDeleteSelected: vi.fn(),
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders fact content', () => {
    render(<FactsList {...defaultProps} />);

    expect(screen.getByText('First fact')).toBeDefined();
    expect(screen.getByText('Second fact')).toBeDefined();
    expect(screen.getByText('Third fact')).toBeDefined();
  });

  it('renders skeletons when loading', () => {
    const { container } = render(<FactsList {...defaultProps} isLoading={true} facts={[]} />);

    // Skeletons are rendered as divs with data-slot="skeleton"
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBe(6);
  });

  it('shows empty message when no facts', () => {
    render(<FactsList {...defaultProps} facts={[]} />);

    expect(screen.getByText('No facts found matching your filters.')).toBeDefined();
  });

  it('calls onSelectFact when a row is clicked', () => {
    render(<FactsList {...defaultProps} />);

    fireEvent.click(screen.getByText('First fact'));

    expect(defaultProps.onSelectFact).toHaveBeenCalledWith(FACTS[0]);
  });

  it('shows bulk action bar when items are selected', () => {
    const selectedIds = new Set(['fact-1', 'fact-2']);
    render(<FactsList {...defaultProps} selectedIds={selectedIds} />);

    expect(screen.getByText('2 selected')).toBeDefined();
    expect(screen.getByText('Delete')).toBeDefined();
  });

  it('calls onDeleteSelected when bulk delete is clicked', () => {
    const selectedIds = new Set(['fact-1']);
    render(<FactsList {...defaultProps} selectedIds={selectedIds} />);

    fireEvent.click(screen.getByText('Delete'));

    expect(defaultProps.onDeleteSelected).toHaveBeenCalled();
  });

  it('applies selected styling to active fact', () => {
    const { container } = render(<FactsList {...defaultProps} selectedFactId="fact-1" />);

    const selectedRow = container.querySelector('[data-selected]');
    expect(selectedRow).not.toBeNull();
    expect(selectedRow?.textContent).toContain('First fact');
  });
});
