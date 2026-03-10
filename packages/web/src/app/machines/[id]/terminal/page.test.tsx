import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockPush,
  mockSpawnTerminal,
  mockKillTerminal,
  mockToast,
  mockUseSearchParams,
  mockInteractiveTerminal,
} = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockSpawnTerminal: vi.fn(),
  mockKillTerminal: vi.fn(),
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  },
  mockUseSearchParams: vi.fn(),
  mockInteractiveTerminal: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'machine-1' }),
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockUseSearchParams(),
}));

vi.mock('@/components/Breadcrumb', () => ({
  Breadcrumb: () => <div data-testid="breadcrumb">Breadcrumb</div>,
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => mockToast,
}));

vi.mock('@/components/InteractiveTerminal', () => ({
  InteractiveTerminal: (props: Record<string, unknown>) => {
    mockInteractiveTerminal(props);
    return <div data-testid="interactive-terminal">{String(props.initialCommand ?? '')}</div>;
  },
}));

vi.mock('@/lib/api', () => ({
  api: {
    spawnTerminal: (...args: unknown[]) => mockSpawnTerminal(...args),
    killTerminal: (...args: unknown[]) => mockKillTerminal(...args),
  },
}));

import MachineTerminalPage from './page';

describe('MachineTerminalPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSearchParams.mockReturnValue(new URLSearchParams('command=claude%20login'));
    mockKillTerminal.mockResolvedValue(undefined);
    mockSpawnTerminal.mockResolvedValue({
      id: 'term-123',
      pid: 123,
      command: '/bin/zsh',
      cols: 120,
      rows: 36,
      createdAt: '2026-03-10T00:00:00.000Z',
    });
  });

  it('passes the command query parameter to InteractiveTerminal', async () => {
    render(<MachineTerminalPage />);

    await waitFor(() => {
      expect(mockInteractiveTerminal).toHaveBeenCalledWith(
        expect.objectContaining({
          machineId: 'machine-1',
          terminalId: 'term-123',
          initialCommand: 'claude login',
        }),
      );
    });
  });

  it('renders the queued command hint', async () => {
    render(<MachineTerminalPage />);

    await waitFor(() => {
      expect(screen.getByText('Queued command')).toBeDefined();
      expect(screen.getByText('claude login')).toBeDefined();
    });
  });
});
