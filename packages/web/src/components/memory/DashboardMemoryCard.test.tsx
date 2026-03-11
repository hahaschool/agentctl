import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { MemoryStats } from '@agentctl/shared';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockMemoryStatsQuery } = vi.hoisted(() => ({
  mockMemoryStatsQuery: vi.fn(),
}));

vi.mock('@/lib/queries', () => ({
  memoryStatsQuery: () => mockMemoryStatsQuery(),
}));

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className }: { className: string }) => (
    <div className={className} data-testid="skeleton" />
  ),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => (
    <a href={href} className={className} data-testid={`link-${href}`}>
      {children}
    </a>
  ),
}));

// ---------------------------------------------------------------------------
// Component import — AFTER mocks
// ---------------------------------------------------------------------------

import { DashboardMemoryCard } from './DashboardMemoryCard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createStats(overrides?: Partial<MemoryStats>): MemoryStats {
  return {
    totalFacts: 142,
    newThisWeek: 8,
    avgConfidence: 0.82,
    pendingConsolidation: 3,
    byScope: { global: 50, 'project:agentctl': 92 },
    byEntityType: { decision: 40, principle: 30, concept: 72 },
    strengthDistribution: { active: 120, decaying: 15, archived: 7 },
    growthTrend: [
      { date: '2026-03-05', count: 130 },
      { date: '2026-03-06', count: 132 },
      { date: '2026-03-07', count: 135 },
      { date: '2026-03-08', count: 138 },
      { date: '2026-03-09', count: 140 },
      { date: '2026-03-10', count: 141 },
      { date: '2026-03-11', count: 142 },
    ],
    ...overrides,
  };
}

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

function renderCard() {
  const qc = createQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <DashboardMemoryCard />
    </QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DashboardMemoryCard', () => {
  it('shows loading skeletons while fetching', () => {
    mockMemoryStatsQuery.mockReturnValue({
      queryKey: ['memory', 'stats'],
      queryFn: () => new Promise(() => {}),
    });

    renderCard();

    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
  });

  it('renders stats when data is loaded', async () => {
    const stats = createStats();
    mockMemoryStatsQuery.mockReturnValue({
      queryKey: ['memory', 'stats'],
      queryFn: () => Promise.resolve({ ok: true, stats }),
    });

    renderCard();

    const { waitFor } = await import('@testing-library/react');
    await waitFor(() => {
      expect(screen.getByText('142')).toBeDefined();
    });

    expect(screen.getByText('+8')).toBeDefined();
    expect(screen.getByText('82%')).toBeDefined();
    expect(screen.getByText('3')).toBeDefined();
  });

  it('renders sparkline when growth trend has data', async () => {
    const stats = createStats();
    mockMemoryStatsQuery.mockReturnValue({
      queryKey: ['memory', 'stats'],
      queryFn: () => Promise.resolve({ ok: true, stats }),
    });

    renderCard();

    const { waitFor } = await import('@testing-library/react');
    await waitFor(() => {
      expect(screen.getByTestId('memory-sparkline')).toBeDefined();
    });
  });

  it('links to /memory/dashboard', async () => {
    const stats = createStats();
    mockMemoryStatsQuery.mockReturnValue({
      queryKey: ['memory', 'stats'],
      queryFn: () => Promise.resolve({ ok: true, stats }),
    });

    renderCard();

    const { waitFor } = await import('@testing-library/react');
    await waitFor(() => {
      expect(screen.getByTestId('link-/memory/dashboard')).toBeDefined();
    });
  });

  it('shows error card when fetch fails', async () => {
    mockMemoryStatsQuery.mockReturnValue({
      queryKey: ['memory', 'stats'],
      queryFn: () => Promise.reject(new Error('API error')),
    });

    renderCard();

    const { waitFor } = await import('@testing-library/react');
    await waitFor(() => {
      expect(screen.getByTestId('dashboard-memory-card-error')).toBeDefined();
    });

    expect(screen.getByText(/Could not load memory stats/)).toBeDefined();
  });

  it('shows high pending consolidation with red accent when count > 10', async () => {
    const stats = createStats({ pendingConsolidation: 15 });
    mockMemoryStatsQuery.mockReturnValue({
      queryKey: ['memory', 'stats'],
      queryFn: () => Promise.resolve({ ok: true, stats }),
    });

    renderCard();

    const { waitFor } = await import('@testing-library/react');
    await waitFor(() => {
      expect(screen.getByText('15')).toBeDefined();
    });
  });
});
