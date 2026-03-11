import type { ConsolidationItem, MemoryFact } from '@agentctl/shared';
import { fireEvent, render, screen } from '@testing-library/react';

import { ConsolidationCard } from './ConsolidationCard';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<ConsolidationItem> = {}): ConsolidationItem {
  return {
    id: 'item-1',
    type: 'contradiction',
    severity: 'high',
    factIds: ['fact-1', 'fact-2'],
    reason: 'Two facts assert conflicting values for the same property.',
    suggestion: 'Keep the more recent fact and delete the older one.',
    status: 'pending',
    createdAt: '2026-03-11T10:00:00.000Z',
    ...overrides,
  };
}

function makeFact(overrides: Partial<MemoryFact> = {}): MemoryFact {
  return {
    id: 'fact-1',
    scope: 'project:agentctl',
    content: 'BullMQ is preferred for MVP',
    content_model: 'text-embedding-3-small',
    entity_type: 'decision',
    confidence: 0.9,
    strength: 0.8,
    tags: [],
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConsolidationCard', () => {
  it('renders the issue type label', () => {
    const onAction = vi.fn();
    render(<ConsolidationCard item={makeItem()} facts={[]} onAction={onAction} />);

    expect(screen.getByText('Contradiction')).toBeDefined();
  });

  it('renders severity badge', () => {
    const onAction = vi.fn();
    render(
      <ConsolidationCard item={makeItem({ severity: 'medium' })} facts={[]} onAction={onAction} />,
    );

    expect(screen.getByText('medium')).toBeDefined();
  });

  it('renders reason and suggestion text', () => {
    const onAction = vi.fn();
    render(<ConsolidationCard item={makeItem()} facts={[]} onAction={onAction} />);

    expect(
      screen.getByText('Two facts assert conflicting values for the same property.'),
    ).toBeDefined();
    expect(screen.getByText('Keep the more recent fact and delete the older one.')).toBeDefined();
  });

  it('renders fact snippets when facts are provided', () => {
    const onAction = vi.fn();
    const facts = [
      makeFact({ id: 'fact-1', content: 'First conflicting fact' }),
      makeFact({ id: 'fact-2', content: 'Second conflicting fact' }),
    ];

    render(<ConsolidationCard item={makeItem()} facts={facts} onAction={onAction} />);

    expect(screen.getByText('First conflicting fact')).toBeDefined();
    expect(screen.getByText('Second conflicting fact')).toBeDefined();
  });

  it('renders loading skeletons when factsLoading is true', () => {
    const onAction = vi.fn();
    render(
      <ConsolidationCard item={makeItem()} facts={[]} factsLoading={true} onAction={onAction} />,
    );

    // No fact content when loading
    expect(screen.queryByText('BullMQ is preferred for MVP')).toBeNull();
  });

  it('renders all four action buttons', () => {
    const onAction = vi.fn();
    render(<ConsolidationCard item={makeItem()} facts={[]} onAction={onAction} />);

    expect(screen.getByRole('button', { name: 'Accept suggestion' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Edit suggestion' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDefined();
  });

  it('calls onAction with "accept" when Accept is clicked', () => {
    const onAction = vi.fn();
    render(<ConsolidationCard item={makeItem({ id: 'item-42' })} facts={[]} onAction={onAction} />);

    fireEvent.click(screen.getByRole('button', { name: 'Accept suggestion' }));

    expect(onAction).toHaveBeenCalledWith('item-42', 'accept');
  });

  it('calls onAction with "skip" when Skip is clicked', () => {
    const onAction = vi.fn();
    render(<ConsolidationCard item={makeItem({ id: 'item-42' })} facts={[]} onAction={onAction} />);

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));

    expect(onAction).toHaveBeenCalledWith('item-42', 'skip');
  });

  it('calls onAction with "delete" when Delete is clicked', () => {
    const onAction = vi.fn();
    render(<ConsolidationCard item={makeItem({ id: 'item-42' })} facts={[]} onAction={onAction} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onAction).toHaveBeenCalledWith('item-42', 'delete');
  });

  it('calls onAction with "edit" when Edit is clicked', () => {
    const onAction = vi.fn();
    render(<ConsolidationCard item={makeItem({ id: 'item-42' })} facts={[]} onAction={onAction} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit suggestion' }));

    expect(onAction).toHaveBeenCalledWith('item-42', 'edit');
  });

  it('disables action buttons when isPending is true', () => {
    const onAction = vi.fn();
    render(<ConsolidationCard item={makeItem()} facts={[]} isPending={true} onAction={onAction} />);

    const buttons = screen.getAllByRole('button');
    for (const btn of buttons) {
      expect(btn).toHaveProperty('disabled', true);
    }
  });

  it('renders near-duplicate issue type label', () => {
    const onAction = vi.fn();
    render(
      <ConsolidationCard
        item={makeItem({ type: 'near-duplicate' })}
        facts={[]}
        onAction={onAction}
      />,
    );

    expect(screen.getByText('Near-Duplicate')).toBeDefined();
  });

  it('renders stale issue type label', () => {
    const onAction = vi.fn();
    render(<ConsolidationCard item={makeItem({ type: 'stale' })} facts={[]} onAction={onAction} />);

    expect(screen.getByText('Stale Fact')).toBeDefined();
  });

  it('renders orphan issue type label', () => {
    const onAction = vi.fn();
    render(
      <ConsolidationCard item={makeItem({ type: 'orphan' })} facts={[]} onAction={onAction} />,
    );

    expect(screen.getByText('Orphan Node')).toBeDefined();
  });
});
