import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeploymentTierStatus } from '@/lib/api';
import { api } from '@/lib/api';

import { PromoteGate } from './PromoteGate';

vi.mock('@/lib/api', () => ({
  api: {
    runPreflight: vi.fn(),
    triggerPromotion: vi.fn(),
  },
}));

const mockTiers: DeploymentTierStatus[] = [
  {
    name: 'dev-1',
    label: 'Dev 1',
    status: 'running',
    services: [],
    config: {
      cpPort: 8080,
      workerPort: 8090,
      webPort: 5173,
      database: 'agentctl_dev_1',
      redisDb: 1,
    },
  },
  {
    name: 'dev-2',
    label: 'Dev 2',
    status: 'running',
    services: [],
    config: {
      cpPort: 8081,
      workerPort: 8091,
      webPort: 5174,
      database: 'agentctl_dev_2',
      redisDb: 2,
    },
  },
  {
    name: 'beta',
    label: 'Beta',
    status: 'running',
    services: [],
    config: {
      cpPort: 9000,
      workerPort: 9010,
      webPort: 5175,
      database: 'agentctl_beta',
      redisDb: 3,
    },
  },
];

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('PromoteGate', () => {
  beforeEach(() => {
    vi.mocked(api.runPreflight).mockResolvedValue({
      ready: false,
      checks: [
        { name: 'Build', status: 'pass' },
        { name: 'Tests', status: 'pass' },
        { name: 'Lint', status: 'pass' },
        { name: 'Health', status: 'pass' },
      ],
    });
    vi.mocked(api.triggerPromotion).mockResolvedValue({ id: 'promo-1', status: 'queued' });
  });

  it('enables preflight when tiers load after initial mount and defaults to dev-1', async () => {
    const onPromoteStarted = vi.fn();
    const { rerender } = render(<PromoteGate tiers={[]} onPromoteStarted={onPromoteStarted} />, {
      wrapper: createWrapper(),
    });

    const preflightButtonBeforeLoad = screen.getByRole('button', { name: 'Run Preflight' });
    expect(preflightButtonBeforeLoad.hasAttribute('disabled')).toBe(true);

    rerender(<PromoteGate tiers={mockTiers} onPromoteStarted={onPromoteStarted} />);

    const preflightButton = screen.getByRole('button', { name: 'Run Preflight' });
    expect(preflightButton.hasAttribute('disabled')).toBe(false);

    fireEvent.click(preflightButton);

    await waitFor(() => {
      expect(api.runPreflight).toHaveBeenCalledWith('dev-1');
    });
  });
});
