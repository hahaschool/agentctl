import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className, ...props }: { className?: string }) => (
    <div data-testid="skeleton" className={className} {...props} />
  ),
}));

vi.mock('./DashboardSectionHeader', () => ({
  DashboardSectionHeader: ({ title }: { title: string }) => (
    <div data-testid="section-header">{title}</div>
  ),
}));

import { DashboardCostOverview } from './DashboardCostOverview';

afterEach(() => {
  vi.restoreAllMocks();
});

const makeSessions = (costs: number[]) =>
  costs.map((cost, i) => ({
    id: `sess-${String(i)}`,
    agentName: `Agent ${String(i)}`,
    claudeSessionId: `claude-${String(i)}-abcdef01`,
    metadata: { costUsd: cost },
  }));

const makeAgentBreakdown = (items: { name: string; cost: number }[]) =>
  items.map((item, i) => ({
    id: `agent-${String(i)}`,
    name: item.name,
    totalCostUsd: item.cost,
  }));

describe('DashboardCostOverview', () => {
  describe('loading state', () => {
    it('renders skeletons when isLoading is true', () => {
      render(<DashboardCostOverview sessionList={[]} agentCostBreakdown={[]} isLoading={true} />);
      expect(screen.getByTestId('cost-overview-skeleton')).toBeDefined();
      expect(screen.getAllByTestId('skeleton').length).toBe(3);
    });

    it('renders section header in loading state', () => {
      render(<DashboardCostOverview sessionList={[]} agentCostBreakdown={[]} isLoading={true} />);
      expect(screen.getByText('Cost Overview')).toBeDefined();
    });
  });

  describe('empty state', () => {
    it('returns null when totalCost is 0 and no agent breakdown', () => {
      const { container } = render(
        <DashboardCostOverview sessionList={[]} agentCostBreakdown={[]} isLoading={false} />,
      );
      expect(container.innerHTML).toBe('');
    });

    it('returns null when all sessions have zero cost', () => {
      const { container } = render(
        <DashboardCostOverview
          sessionList={makeSessions([0, 0, 0])}
          agentCostBreakdown={[]}
          isLoading={false}
        />,
      );
      expect(container.innerHTML).toBe('');
    });
  });

  describe('total cost display', () => {
    it('renders total session cost', () => {
      render(
        <DashboardCostOverview
          sessionList={makeSessions([1.5, 2.5, 0])}
          agentCostBreakdown={[]}
          isLoading={false}
        />,
      );
      expect(screen.getByText('$4.00')).toBeDefined();
      expect(screen.getByText('Total Session Cost')).toBeDefined();
    });

    it('shows count of sessions with cost > 0', () => {
      render(
        <DashboardCostOverview
          sessionList={makeSessions([1.0, 0, 3.0, 0, 2.0])}
          agentCostBreakdown={[]}
          isLoading={false}
        />,
      );
      expect(screen.getByText('across 3 sessions')).toBeDefined();
    });
  });

  describe('agent cost breakdown', () => {
    it('renders agent cost bars', () => {
      render(
        <DashboardCostOverview
          sessionList={makeSessions([5.0])}
          agentCostBreakdown={makeAgentBreakdown([
            { name: 'Worker A', cost: 3.0 },
            { name: 'Worker B', cost: 1.0 },
          ])}
          isLoading={false}
        />,
      );
      expect(screen.getByText('Worker A')).toBeDefined();
      expect(screen.getByText('Worker B')).toBeDefined();
      expect(screen.getByText('$3.00')).toBeDefined();
      expect(screen.getByText('$1.00')).toBeDefined();
    });

    it('shows "No agent cost data yet" when breakdown is empty but sessions have cost', () => {
      render(
        <DashboardCostOverview
          sessionList={makeSessions([2.0])}
          agentCostBreakdown={[]}
          isLoading={false}
        />,
      );
      expect(screen.getByText('No agent cost data yet')).toBeDefined();
    });

    it('renders agent links pointing to correct href', () => {
      render(
        <DashboardCostOverview
          sessionList={makeSessions([5.0])}
          agentCostBreakdown={makeAgentBreakdown([{ name: 'Test Agent', cost: 2.5 }])}
          isLoading={false}
        />,
      );
      const link = screen.getByText('Test Agent').closest('a');
      expect(link?.getAttribute('href')).toBe('/agents/agent-0');
    });
  });

  describe('most expensive sessions', () => {
    it('renders top 5 most expensive sessions sorted by cost descending', () => {
      const sessions = makeSessions([1.0, 5.0, 3.0, 2.0, 4.0, 0.5, 6.0]);
      render(
        <DashboardCostOverview sessionList={sessions} agentCostBreakdown={[]} isLoading={false} />,
      );
      // Top 5 should be: 6.0, 5.0, 4.0, 3.0, 2.0
      expect(screen.getByText('$6.00')).toBeDefined();
      expect(screen.getByText('$5.00')).toBeDefined();
      expect(screen.getByText('$4.00')).not.toBeNull();
      expect(screen.getByText('$3.00')).toBeDefined();
      expect(screen.getByText('$2.00')).toBeDefined();
      // $0.50 should not appear in top 5
      expect(screen.queryByText('$0.50')).toBeNull();
    });

    it('renders session links with correct href', () => {
      const sessions = makeSessions([10.0]);
      render(
        <DashboardCostOverview sessionList={sessions} agentCostBreakdown={[]} isLoading={false} />,
      );
      const link = screen.getByText('Agent 0').closest('a');
      expect(link?.getAttribute('href')).toBe('/sessions/sess-0');
    });

    it('shows "No session cost data yet" when no sessions have cost', () => {
      // Need agentCostBreakdown to avoid null return
      render(
        <DashboardCostOverview
          sessionList={makeSessions([0, 0])}
          agentCostBreakdown={makeAgentBreakdown([{ name: 'A', cost: 1.0 }])}
          isLoading={false}
        />,
      );
      expect(screen.getByText('No session cost data yet')).toBeDefined();
    });

    it('uses claudeSessionId for display when agentName is null', () => {
      const sessions = [
        {
          id: 'sess-x',
          agentName: null,
          claudeSessionId: 'abcd1234rest',
          metadata: { costUsd: 5.0 },
        },
      ];
      render(
        <DashboardCostOverview sessionList={sessions} agentCostBreakdown={[]} isLoading={false} />,
      );
      expect(screen.getByText('Session abcd1234')).toBeDefined();
    });

    it('uses session id for display when both agentName and claudeSessionId are null', () => {
      const sessions = [
        {
          id: 'xyz98765rest',
          agentName: null,
          claudeSessionId: null,
          metadata: { costUsd: 3.0 },
        },
      ];
      render(
        <DashboardCostOverview sessionList={sessions} agentCostBreakdown={[]} isLoading={false} />,
      );
      expect(screen.getByText('Session xyz98765')).toBeDefined();
    });

    it('displays numbered ranks for top sessions', () => {
      const sessions = makeSessions([5.0, 3.0]);
      render(
        <DashboardCostOverview sessionList={sessions} agentCostBreakdown={[]} isLoading={false} />,
      );
      expect(screen.getByText('#1')).toBeDefined();
      expect(screen.getByText('#2')).toBeDefined();
    });
  });

  describe('renders when only agentCostBreakdown present', () => {
    it('renders the component when totalCost=0 but agentCostBreakdown has data', () => {
      render(
        <DashboardCostOverview
          sessionList={[]}
          agentCostBreakdown={makeAgentBreakdown([{ name: 'Agent X', cost: 2.0 }])}
          isLoading={false}
        />,
      );
      expect(screen.getByText('Cost Overview')).toBeDefined();
      expect(screen.getByText('Agent X')).toBeDefined();
    });
  });
});
