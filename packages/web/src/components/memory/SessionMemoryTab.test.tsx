import type { MemoryFact } from '@agentctl/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockMemoryFactQuery, mockMemoryFactsQuery } = vi.hoisted(() => ({
  mockMemoryFactQuery: vi.fn(),
  mockMemoryFactsQuery: vi.fn(),
}));

vi.mock('@/lib/queries', () => ({
  memoryFactsQuery: (params: unknown) => mockMemoryFactsQuery(params),
  memoryFactQuery: (id: string) => mockMemoryFactQuery(id),
}));

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className }: { className: string }) => (
    <div className={className} data-testid="skeleton" />
  ),
}));

vi.mock('./ConfidenceBar', () => ({
  ConfidenceBar: ({ confidence }: { confidence: number }) => (
    <div data-testid="confidence-bar" data-confidence={confidence} />
  ),
}));

vi.mock('./EntityTypeBadge', () => ({
  EntityTypeBadge: ({ entityType }: { entityType: string }) => (
    <span data-testid="entity-type-badge">{entityType}</span>
  ),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// ---------------------------------------------------------------------------
// Component import — AFTER mocks
// ---------------------------------------------------------------------------

import { SessionMemoryTab } from './SessionMemoryTab';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createFact(overrides?: Partial<MemoryFact>): MemoryFact {
  return {
    id: 'fact-1',
    scope: 'project:agentctl',
    content: 'Test fact content',
    content_model: 'text-embedding-3-small',
    entity_type: 'decision',
    confidence: 0.85,
    strength: 0.9,
    source: {
      session_id: 'ses-1',
      agent_id: 'agent-1',
      machine_id: 'machine-1',
      turn_index: 1,
      extraction_method: 'manual',
    },
    valid_from: '2026-03-11T00:00:00.000Z',
    valid_until: null,
    created_at: '2026-03-11T00:00:00.000Z',
    accessed_at: '2026-03-11T00:00:00.000Z',
    ...overrides,
  };
}

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

function renderTab(sessionId = 'ses-123') {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <SessionMemoryTab sessionId={sessionId} />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionMemoryTab', () => {
  function mockDetailQueryResult() {
    mockMemoryFactQuery.mockImplementation((factId: string) => ({
      queryKey: ['memory', 'fact', factId],
      queryFn: () =>
        Promise.resolve({
          ok: true,
          fact: createFact({ id: factId || 'detail-fallback' }),
          edges: [],
          sourcePreviews: [],
        }),
      enabled: Boolean(factId),
    }));
  }

  it('shows loading skeletons while fetching', () => {
    mockDetailQueryResult();
    mockMemoryFactsQuery.mockReturnValue({
      queryKey: ['memory', 'facts', { sessionId: 'ses-123' }],
      queryFn: () => new Promise(() => {}),
    });

    renderTab();

    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
  });

  it('renders facts when data is loaded', async () => {
    mockDetailQueryResult();
    const facts = [
      createFact({ id: 'f1', content: 'First decision fact' }),
      createFact({ id: 'f2', content: 'Second principle fact', entity_type: 'principle' }),
    ];
    mockMemoryFactsQuery.mockReturnValue({
      queryKey: ['memory', 'facts', { sessionId: 'ses-123' }],
      queryFn: () => Promise.resolve({ ok: true, facts, total: 2 }),
    });

    renderTab();

    const { waitFor } = await import('@testing-library/react');
    await waitFor(() => {
      expect(screen.getByText('First decision fact')).toBeDefined();
    });

    expect(screen.getByText('Second principle fact')).toBeDefined();
  });

  it('shows empty state when no facts exist', async () => {
    mockDetailQueryResult();
    mockMemoryFactsQuery.mockReturnValue({
      queryKey: ['memory', 'facts', { sessionId: 'ses-123' }],
      queryFn: () => Promise.resolve({ ok: true, facts: [], total: 0 }),
    });

    renderTab();

    const { waitFor } = await import('@testing-library/react');
    await waitFor(() => {
      expect(screen.getByTestId('session-memory-empty')).toBeDefined();
    });
  });

  it('shows error message on fetch failure', async () => {
    mockDetailQueryResult();
    mockMemoryFactsQuery.mockReturnValue({
      queryKey: ['memory', 'facts', { sessionId: 'ses-123' }],
      queryFn: () => Promise.reject(new Error('Network error')),
    });

    renderTab();

    const { waitFor } = await import('@testing-library/react');
    await waitFor(() => {
      expect(screen.getByTestId('session-memory-error')).toBeDefined();
    });
  });

  it('passes sessionId to memoryFactsQuery', () => {
    mockDetailQueryResult();
    const sessionId = 'ses-xyz-999';
    mockMemoryFactsQuery.mockReturnValue({
      queryKey: ['memory', 'facts', { sessionId }],
      queryFn: () => Promise.resolve({ ok: true, facts: [], total: 0 }),
    });

    renderTab(sessionId);

    expect(mockMemoryFactsQuery).toHaveBeenCalledWith({ sessionId });
  });

  it('opens the fact detail sheet with drawer evidence when a fact is selected', async () => {
    const fact = createFact({ id: 'f1', content: 'First decision fact' });
    mockMemoryFactsQuery.mockReturnValue({
      queryKey: ['memory', 'facts', { sessionId: 'ses-123' }],
      queryFn: () => Promise.resolve({ ok: true, facts: [fact], total: 1 }),
    });
    mockMemoryFactQuery.mockImplementation((factId: string) => ({
      queryKey: ['memory', 'fact', factId],
      queryFn: () =>
        Promise.resolve({
          ok: true,
          fact,
          edges: [],
          sourcePreviews: [
            {
              drawer_id: 'drawer-1',
              drawer_scope: 'project:agentctl',
              drawer_topic: 'release-checklist',
              drawer_chunk_index: 0,
              drawer_source_type: 'session-jsonl',
              drawer_source_id: 'session-1',
              start_offset: 0,
              end_offset: 36,
              quote_preview: 'Keep the rollout note concise and source-linked.',
              status: 'available',
              created_at: '2026-03-11T00:00:00.000Z',
            },
          ],
        }),
      enabled: Boolean(factId),
    }));

    renderTab();

    const { waitFor } = await import('@testing-library/react');
    await waitFor(() => {
      expect(screen.getByText('First decision fact')).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: /First decision fact/ }));

    await waitFor(() => {
      expect(screen.getByText('Evidence (1)')).toBeDefined();
    });
    expect(screen.getByText('Keep the rollout note concise and source-linked.')).toBeDefined();
  });
});
