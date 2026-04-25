import type { MemoryFact } from '@agentctl/shared';
import { fireEvent, render, screen } from '@testing-library/react';

import { MergePreviewPanel } from './MergePreviewPanel';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeFact(overrides: Partial<MemoryFact> = {}): MemoryFact {
  return {
    id: 'fact-1',
    scope: 'project:agentctl',
    content: 'BullMQ is preferred for MVP',
    content_model: 'text-embedding-3-small',
    entity_type: 'decision',
    confidence: 0.9,
    strength: 0.8,
    tags: ['scheduling', 'mvp'],
    source: {
      session_id: 'session-1',
      agent_id: 'agent-1',
      machine_id: 'machine-1',
      turn_index: 1,
      extraction_method: 'manual',
    },
    valid_from: '2026-03-01T00:00:00.000Z',
    valid_until: null,
    created_at: '2026-03-01T00:00:00.000Z',
    accessed_at: '2026-03-11T10:00:00.000Z',
    ...overrides,
  };
}

const FACT_A = makeFact({ id: 'fact-a', content: 'BullMQ is preferred for MVP' });
const FACT_B = makeFact({
  id: 'fact-b',
  content: 'Redis streams are used for task queuing',
  tags: ['redis', 'queuing'],
});

// ---------------------------------------------------------------------------
// Tests — near-duplicate mode
// ---------------------------------------------------------------------------

describe('MergePreviewPanel (near-duplicate)', () => {
  it('renders both facts side-by-side when open', () => {
    render(
      <MergePreviewPanel
        open={true}
        mode="near-duplicate"
        facts={[FACT_A, FACT_B]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const sideBySide = screen.getByTestId('side-by-side-facts');
    expect(sideBySide).toBeDefined();
    expect(screen.getByText('BullMQ is preferred for MVP')).toBeDefined();
    expect(screen.getByText('Redis streams are used for task queuing')).toBeDefined();
  });

  it('labels columns "Fact A" and "Fact B"', () => {
    render(
      <MergePreviewPanel
        open={true}
        mode="near-duplicate"
        facts={[FACT_A, FACT_B]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText('Fact A')).toBeDefined();
    expect(screen.getByText('Fact B')).toBeDefined();
  });

  it('Confirm merge button is disabled until a fact is selected', () => {
    render(
      <MergePreviewPanel
        open={true}
        mode="near-duplicate"
        facts={[FACT_A, FACT_B]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const confirmBtn = screen.getByRole('button', { name: 'Confirm merge' });
    expect(confirmBtn).toHaveProperty('disabled', true);
  });

  it('enables Confirm merge after selecting a fact column', () => {
    render(
      <MergePreviewPanel
        open={true}
        mode="near-duplicate"
        facts={[FACT_A, FACT_B]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // Select Fact A column
    fireEvent.click(screen.getByText('Fact A').closest('button') as HTMLElement);

    const confirmBtn = screen.getByRole('button', { name: 'Confirm merge' });
    expect(confirmBtn).toHaveProperty('disabled', false);
  });

  it('calls onConfirm with the correct survivor ID when Confirm merge is clicked', () => {
    const onConfirm = vi.fn();

    render(
      <MergePreviewPanel
        open={true}
        mode="near-duplicate"
        facts={[FACT_A, FACT_B]}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    // Select Fact B
    fireEvent.click(screen.getByText('Fact B').closest('button') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm merge' }));

    expect(onConfirm).toHaveBeenCalledWith('fact-b');
  });

  it('shows merge preview with winning content after selection', () => {
    render(
      <MergePreviewPanel
        open={true}
        mode="near-duplicate"
        facts={[FACT_A, FACT_B]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // Select Fact A to see merge preview
    fireEvent.click(screen.getByText('Fact A').closest('button') as HTMLElement);

    expect(screen.getByText('Merge preview')).toBeDefined();
    expect(screen.getByText('Winning content:')).toBeDefined();
  });

  it('shows combined tags in merge preview', () => {
    render(
      <MergePreviewPanel
        open={true}
        mode="near-duplicate"
        facts={[FACT_A, FACT_B]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Fact A').closest('button') as HTMLElement);

    // Tags from both facts should appear in the preview
    expect(screen.getByText('Combined tags:')).toBeDefined();
  });

  it('calls onCancel when Cancel is clicked', () => {
    const onCancel = vi.fn();

    render(
      <MergePreviewPanel
        open={true}
        mode="near-duplicate"
        facts={[FACT_A, FACT_B]}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel merge' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Tests — contradiction mode
// ---------------------------------------------------------------------------

describe('MergePreviewPanel (contradiction)', () => {
  it('renders both conflicting facts side-by-side', () => {
    render(
      <MergePreviewPanel
        open={true}
        mode="contradiction"
        facts={[FACT_A, FACT_B]}
        onConfirm={vi.fn()}
        onKeepBoth={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const sideBySide = screen.getByTestId('side-by-side-facts');
    expect(sideBySide).toBeDefined();
    expect(screen.getByText('BullMQ is preferred for MVP')).toBeDefined();
    expect(screen.getByText('Redis streams are used for task queuing')).toBeDefined();
  });

  it('shows Keep A, Keep B, and Keep both buttons for contradictions', () => {
    render(
      <MergePreviewPanel
        open={true}
        mode="contradiction"
        facts={[FACT_A, FACT_B]}
        onConfirm={vi.fn()}
        onKeepBoth={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Keep Fact A' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Keep Fact B' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Keep both facts' })).toBeDefined();
  });

  it('does not render Confirm merge button in contradiction mode', () => {
    render(
      <MergePreviewPanel
        open={true}
        mode="contradiction"
        facts={[FACT_A, FACT_B]}
        onConfirm={vi.fn()}
        onKeepBoth={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Confirm merge' })).toBeNull();
  });

  it('calls onConfirm with fact-a ID when Keep A is clicked after selecting Fact A', () => {
    const onConfirm = vi.fn();

    render(
      <MergePreviewPanel
        open={true}
        mode="contradiction"
        facts={[FACT_A, FACT_B]}
        onConfirm={onConfirm}
        onKeepBoth={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // Select Fact A to enable Keep A button
    fireEvent.click(screen.getByText('Fact A').closest('button') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'Keep Fact A' }));

    expect(onConfirm).toHaveBeenCalledWith('fact-a');
  });

  it('calls onKeepBoth when Keep both is clicked', () => {
    const onKeepBoth = vi.fn();

    render(
      <MergePreviewPanel
        open={true}
        mode="contradiction"
        facts={[FACT_A, FACT_B]}
        onConfirm={vi.fn()}
        onKeepBoth={onKeepBoth}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Keep both facts' }));
    expect(onKeepBoth).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when Cancel contradiction resolution is clicked', () => {
    const onCancel = vi.fn();

    render(
      <MergePreviewPanel
        open={true}
        mode="contradiction"
        facts={[FACT_A, FACT_B]}
        onConfirm={vi.fn()}
        onKeepBoth={vi.fn()}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel contradiction resolution' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not render when closed', () => {
    render(
      <MergePreviewPanel
        open={false}
        mode="contradiction"
        facts={[FACT_A, FACT_B]}
        onConfirm={vi.fn()}
        onKeepBoth={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('side-by-side-facts')).toBeNull();
  });
});
