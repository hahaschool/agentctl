import type { MemoryFact } from '@agentctl/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type React from 'react';

import { api } from '@/lib/api';

import { FactsList } from './FactsList';

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

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
    renderWithClient(<FactsList {...defaultProps} />);

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
    renderWithClient(<FactsList {...defaultProps} facts={[]} />);

    expect(screen.getByText('No facts found matching your filters.')).toBeDefined();
  });

  it('calls onSelectFact when a row is clicked', () => {
    renderWithClient(<FactsList {...defaultProps} />);

    fireEvent.click(screen.getByText('First fact'));

    expect(defaultProps.onSelectFact).toHaveBeenCalledWith(FACTS[0]);
  });

  it('shows bulk action bar when items are selected', () => {
    const selectedIds = new Set(['fact-1', 'fact-2']);
    renderWithClient(<FactsList {...defaultProps} selectedIds={selectedIds} />);

    expect(screen.getByText('2 selected')).toBeDefined();
    expect(screen.getByText('Delete')).toBeDefined();
  });

  it('calls onDeleteSelected when bulk delete is clicked', () => {
    const selectedIds = new Set(['fact-1']);
    renderWithClient(<FactsList {...defaultProps} selectedIds={selectedIds} />);

    fireEvent.click(screen.getByText('Delete'));

    expect(defaultProps.onDeleteSelected).toHaveBeenCalled();
  });

  it('applies selected styling to active fact', () => {
    const { container } = renderWithClient(<FactsList {...defaultProps} selectedFactId="fact-1" />);

    const selectedRow = container.querySelector('[data-selected]');
    expect(selectedRow).not.toBeNull();
    expect(selectedRow?.textContent).toContain('First fact');
  });

  it('renders feedback buttons for each fact', () => {
    renderWithClient(<FactsList {...defaultProps} />);

    // Each fact gets three feedback buttons (Useful / Not relevant / Outdated)
    expect(screen.getAllByLabelText(/Useful: used/).length).toBe(FACTS.length);
    expect(screen.getAllByLabelText(/Not relevant: irrelevant/).length).toBe(FACTS.length);
    expect(screen.getAllByLabelText(/Outdated: outdated/).length).toBe(FACTS.length);
  });

  it('submits a feedback signal when a thumbs-up button is clicked', async () => {
    const spy = vi.spyOn(api, 'submitFactFeedback').mockResolvedValue({
      ok: true,
      fact: FACTS[0],
    });

    renderWithClient(<FactsList {...defaultProps} />);

    const usefulButtons = screen.getAllByLabelText(/Useful: used/);
    fireEvent.click(usefulButtons[0]);

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith('fact-1', 'used');
    });
    // Clicking feedback must not open the detail pane
    expect(defaultProps.onSelectFact).not.toHaveBeenCalled();
  });

  it('submits an outdated signal when the outdated button is clicked', async () => {
    const spy = vi.spyOn(api, 'submitFactFeedback').mockResolvedValue({ ok: true, fact: FACTS[1] });

    renderWithClient(<FactsList {...defaultProps} />);

    const outdatedButtons = screen.getAllByLabelText(/Outdated: outdated/);
    fireEvent.click(outdatedButtons[1]);

    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith('fact-2', 'outdated');
    });
  });

  it('renders match-source badges only for facts present in sourcePathByFactId', () => {
    // Only two of the three facts have enrichment — the third must render
    // exactly as before (no badge).
    const sourcePathByFactId = new Map<string, 'vector' | 'bm25' | 'graph'>([
      ['fact-1', 'vector'],
      ['fact-2', 'bm25'],
    ]);

    renderWithClient(<FactsList {...defaultProps} sourcePathByFactId={sourcePathByFactId} />);

    const badges = screen.getAllByTestId('fact-match-source-badge');
    expect(badges).toHaveLength(2);

    const labels = badges.map((b) => b.getAttribute('data-source-path'));
    expect(labels).toEqual(['vector', 'bm25']);
  });

  it('renders no match-source badges when sourcePathByFactId is omitted', () => {
    renderWithClient(<FactsList {...defaultProps} />);

    expect(screen.queryAllByTestId('fact-match-source-badge')).toHaveLength(0);
  });
});
