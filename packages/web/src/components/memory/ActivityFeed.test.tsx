import type { MemoryFact } from '@agentctl/shared';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('./EntityTypeBadge', () => ({
  EntityTypeBadge: ({ entityType }: { entityType: string }) => (
    <span data-testid={`entity-badge-${entityType}`}>{entityType}</span>
  ),
}));

vi.mock('./ScopeBadge', () => ({
  ScopeBadge: ({ scope }: { scope: string }) => (
    <span data-testid={`scope-badge-${scope}`}>{scope}</span>
  ),
}));

import { ActivityFeed } from './ActivityFeed';

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

describe('ActivityFeed', () => {
  it('renders empty state when items list is empty', () => {
    render(<ActivityFeed items={[]} />);

    expect(screen.getByTestId('activity-feed-empty')).toBeDefined();
    expect(screen.getByText('No recent memory activity.')).toBeDefined();
  });

  it('renders loading skeleton when isLoading is true', () => {
    render(<ActivityFeed items={[]} isLoading />);

    expect(screen.getByTestId('activity-feed-loading')).toBeDefined();
    expect(screen.queryByTestId('activity-feed-empty')).toBeNull();
  });

  it('renders a row for each item', () => {
    const items = [
      { fact: makeFact({ id: 'fact-1', content: 'First fact' }) },
      { fact: makeFact({ id: 'fact-2', content: 'Second fact' }) },
    ];

    render(<ActivityFeed items={items} />);

    expect(screen.getByTestId('activity-feed')).toBeDefined();
    expect(screen.getByTestId('activity-row-fact-1')).toBeDefined();
    expect(screen.getByTestId('activity-row-fact-2')).toBeDefined();
    expect(screen.getByText('First fact')).toBeDefined();
    expect(screen.getByText('Second fact')).toBeDefined();
  });

  it('renders entity type and scope badges for each row', () => {
    const fact = makeFact({ id: 'fact-1', entity_type: 'pattern', scope: 'global' });

    render(<ActivityFeed items={[{ fact }]} />);

    expect(screen.getByTestId('entity-badge-pattern')).toBeDefined();
    expect(screen.getByTestId('scope-badge-global')).toBeDefined();
  });

  it('renders fact content in each row', () => {
    const fact = makeFact({ id: 'fact-1', content: 'Important architectural decision' });

    render(<ActivityFeed items={[{ fact }]} />);

    expect(screen.getByText('Important architectural decision')).toBeDefined();
  });
});
