import { fireEvent, render, screen } from '@testing-library/react';

import { FactCard } from './FactCard';

const FACT = {
  id: 'fact-1',
  scope: 'project:agentctl',
  content: 'Use the memory route shell as the landing page',
  content_model: 'text-embedding-3-small',
  entity_type: 'decision' as const,
  confidence: 0.84,
  strength: 0.9,
  source: {
    session_id: 'session-1',
    agent_id: 'agent-1',
    machine_id: 'machine-1',
    turn_index: 1,
    extraction_method: 'manual' as const,
  },
  valid_from: '2026-03-11T10:00:00.000Z',
  valid_until: null,
  created_at: '2026-03-11T10:00:00.000Z',
  accessed_at: '2026-03-11T10:00:00.000Z',
};

describe('FactCard', () => {
  it('renders core fact content and metadata', () => {
    render(<FactCard fact={FACT} />);

    expect(screen.getByText(FACT.content)).toBeDefined();
    expect(screen.getByText('decision')).toBeDefined();
    expect(screen.getByText('project:agentctl')).toBeDefined();
    expect(screen.getByText('Agent: agent-1')).toBeDefined();
  });

  it('calls onSelect with the fact when clicked', () => {
    const onSelect = vi.fn();
    render(<FactCard fact={FACT} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button'));

    expect(onSelect).toHaveBeenCalledWith(FACT);
  });
});
