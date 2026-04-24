import type { MemoryFact } from '@agentctl/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
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

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// ---------------------------------------------------------------------------
// Component import — AFTER mocks
// ---------------------------------------------------------------------------

import { AgentMemorySection } from './AgentMemorySection';

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

function renderSection(agentId = 'agent-1') {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <AgentMemorySection agentId={agentId} />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentMemorySection', () => {
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
      queryKey: ['memory', 'facts', { agentId: 'agent-1' }],
      queryFn: () => new Promise(() => {}),
    });

    renderSection();

    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
  });

  it('renders fact count in header when data is loaded', async () => {
    mockDetailQueryResult();
    const facts = [
      createFact({ id: 'f1', scope: 'global', strength: 0.9 }),
      createFact({ id: 'f2', scope: 'project:agentctl', strength: 0.7 }),
    ];
    mockMemoryFactsQuery.mockReturnValue({
      queryKey: ['memory', 'facts', { agentId: 'agent-1' }],
      queryFn: () => Promise.resolve({ ok: true, facts, total: 2 }),
    });

    renderSection();

    const { waitFor } = await import('@testing-library/react');
    await waitFor(() => {
      expect(screen.getByTestId('agent-memory-section')).toBeDefined();
    });

    expect(screen.getByText(/2 fact/)).toBeDefined();
  });

  it('renders scope distribution when multiple scopes are present', async () => {
    mockDetailQueryResult();
    const facts = [
      createFact({ id: 'f1', scope: 'global' }),
      createFact({ id: 'f2', scope: 'global' }),
      createFact({ id: 'f3', scope: 'project:agentctl' }),
    ];
    mockMemoryFactsQuery.mockReturnValue({
      queryKey: ['memory', 'facts', { agentId: 'agent-1' }],
      queryFn: () => Promise.resolve({ ok: true, facts, total: 3 }),
    });

    renderSection();

    const { waitFor } = await import('@testing-library/react');
    await waitFor(() => {
      expect(screen.getByTestId('agent-memory-scope-distribution')).toBeDefined();
    });
  });

  it('renders top facts section', async () => {
    mockDetailQueryResult();
    const facts = [
      createFact({ id: 'f1', strength: 0.95 }),
      createFact({ id: 'f2', strength: 0.6 }),
    ];
    mockMemoryFactsQuery.mockReturnValue({
      queryKey: ['memory', 'facts', { agentId: 'agent-1' }],
      queryFn: () => Promise.resolve({ ok: true, facts, total: 2 }),
    });

    renderSection();

    const { waitFor } = await import('@testing-library/react');
    await waitFor(() => {
      expect(screen.getByTestId('agent-memory-top-facts')).toBeDefined();
    });
  });

  it('shows no-facts message when empty', async () => {
    mockDetailQueryResult();
    mockMemoryFactsQuery.mockReturnValue({
      queryKey: ['memory', 'facts', { agentId: 'agent-1' }],
      queryFn: () => Promise.resolve({ ok: true, facts: [], total: 0 }),
    });

    renderSection();

    const { waitFor } = await import('@testing-library/react');
    await waitFor(() => {
      expect(screen.getByText(/No facts recorded for this agent/)).toBeDefined();
    });
  });

  it('shows error when fetch fails', async () => {
    mockDetailQueryResult();
    mockMemoryFactsQuery.mockReturnValue({
      queryKey: ['memory', 'facts', { agentId: 'agent-1' }],
      queryFn: () => Promise.reject(new Error('Server error')),
    });

    renderSection();

    const { waitFor } = await import('@testing-library/react');
    await waitFor(() => {
      expect(screen.getByTestId('agent-memory-error')).toBeDefined();
    });
  });

  it('shows not-configured notice when route returns 404', async () => {
    mockDetailQueryResult();
    mockMemoryFactsQuery.mockReturnValue({
      queryKey: ['memory', 'facts', { agentId: 'agent-1' }],
      queryFn: () => Promise.reject(new Error('Route GET:/api/memory/facts not found')),
    });

    renderSection();

    const { waitFor } = await import('@testing-library/react');
    await waitFor(() => {
      expect(screen.getByTestId('agent-memory-not-configured')).toBeDefined();
    });

    expect(screen.getByText(/LITELLM_URL/)).toBeDefined();
  });

  it('passes agentId to memoryFactsQuery', () => {
    mockDetailQueryResult();
    const agentId = 'agent-xyz-999';
    mockMemoryFactsQuery.mockReturnValue({
      queryKey: ['memory', 'facts', { agentId }],
      queryFn: () => Promise.resolve({ ok: true, facts: [], total: 0 }),
    });

    renderSection(agentId);

    expect(mockMemoryFactsQuery).toHaveBeenCalledWith({ agentId });
  });

  it('opens the fact detail sheet with drawer evidence when a top fact is selected', async () => {
    const fact = createFact({ id: 'f1', content: 'Top fact content', strength: 0.95 });
    mockMemoryFactsQuery.mockReturnValue({
      queryKey: ['memory', 'facts', { agentId: 'agent-1' }],
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

    renderSection();

    const { waitFor } = await import('@testing-library/react');
    await waitFor(() => {
      expect(screen.getByText('Top fact content')).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: /Top fact content/ }));

    await waitFor(() => {
      expect(screen.getByText('Evidence (1)')).toBeDefined();
    });
    expect(screen.getByText('Keep the rollout note concise and source-linked.')).toBeDefined();
  });
});
