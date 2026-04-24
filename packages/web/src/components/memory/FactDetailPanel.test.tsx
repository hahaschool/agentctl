import { fireEvent, render, screen } from '@testing-library/react';

import { FactDetailPanel } from './FactDetailPanel';

const FACT = {
  id: 'fact-1',
  scope: 'project:agentctl',
  content: 'Memory detail content',
  content_model: 'text-embedding-3-small',
  entity_type: 'concept' as const,
  confidence: 0.7,
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

describe('FactDetailPanel', () => {
  it('renders fact details and related edges', () => {
    render(
      <FactDetailPanel
        fact={FACT}
        edges={[
          {
            id: 'edge-1',
            source_fact_id: 'fact-1',
            target_fact_id: 'fact-2',
            relation: 'related_to',
            weight: 0.5,
            created_at: '2026-03-11T10:00:00.000Z',
          },
        ]}
        sourcePreviews={[
          {
            drawer_id: 'drawer-1',
            drawer_scope: 'project:agentctl',
            drawer_topic: 'release-checklist',
            drawer_chunk_index: 0,
            drawer_source_type: 'session-jsonl',
            drawer_source_id: 'session-1',
            start_offset: 10,
            end_offset: 42,
            quote_preview: 'Keep the rollout note concise and source-linked.',
            status: 'available',
            created_at: '2026-03-11T10:00:00.000Z',
          },
        ]}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Memory detail content')).toBeDefined();
    expect(screen.getByText('Evidence (1)')).toBeDefined();
    expect(screen.getByText('Relationships')).toBeDefined();
    expect(screen.getByText('related to')).toBeDefined();
  });

  it('truncates long evidence previews until expanded', () => {
    const longPreview =
      'This supporting snippet is intentionally long so the mobile detail sheet has to clamp it before rendering the full text on demand for review and provenance checks.';

    render(
      <FactDetailPanel
        fact={FACT}
        edges={[]}
        sourcePreviews={[
          {
            drawer_id: 'drawer-1',
            drawer_scope: 'project:agentctl',
            drawer_topic: 'release-checklist',
            drawer_chunk_index: 0,
            drawer_source_type: 'session-jsonl',
            drawer_source_id: 'session-1',
            start_offset: 0,
            end_offset: longPreview.length,
            quote_preview: longPreview,
            status: 'available',
            created_at: '2026-03-11T10:00:00.000Z',
          },
        ]}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/This supporting snippet is intentionally long/).textContent).not.toBe(
      longPreview,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show full snippet' }));

    expect(screen.getByText(longPreview)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
    expect(screen.getByText(/This supporting snippet is intentionally long/).textContent).not.toBe(
      longPreview,
    );
  });
});
