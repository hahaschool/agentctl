import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fuzzyScore, levenshtein } from '@/lib/fuzzy-search';
import { CommandPalette } from './CommandPalette';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

const mockSetTheme = vi.fn();
let mockTheme = 'dark';
vi.mock('next-themes', () => ({
  useTheme: () => ({
    theme: mockTheme,
    setTheme: mockSetTheme,
  }),
}));

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock('@/components/Toast', () => ({
  toast: mockToast,
}));

const mockAgentsQuery = vi.fn();
const mockMachinesQuery = vi.fn();
const mockSessionsQuery = vi.fn();

const mockDeleteMutate = vi.fn();
vi.mock('@/lib/queries', () => ({
  agentsQuery: () => mockAgentsQuery(),
  machinesQuery: () => mockMachinesQuery(),
  sessionsQuery: () => mockSessionsQuery(),
  useDeleteSession: () => ({ mutate: mockDeleteMutate, isPending: false }),
}));

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

function renderPalette(props: { open: boolean; onClose?: () => void }) {
  const qc = createQueryClient();
  const onClose = props.onClose ?? vi.fn();
  const result = render(
    <QueryClientProvider client={qc}>
      <CommandPalette open={props.open} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { ...result, onClose, queryClient: qc };
}

beforeEach(() => {
  mockTheme = 'dark';
  mockAgentsQuery.mockReturnValue({ queryKey: ['agents'], queryFn: () => [] });
  mockMachinesQuery.mockReturnValue({ queryKey: ['machines'], queryFn: () => [] });
  mockSessionsQuery.mockReturnValue({ queryKey: ['sessions'], queryFn: () => ({ sessions: [] }) });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CommandPalette', () => {
  it('renders nothing when open=false', () => {
    const { container } = renderPalette({ open: false });
    expect(container.innerHTML).toBe('');
  });

  it('renders modal overlay when open=true', () => {
    renderPalette({ open: true });
    expect(screen.getByRole('dialog', { name: /command palette/i })).toBeDefined();
  });

  it('tracks the active option through aria-activedescendant on the listbox', () => {
    renderPalette({ open: true });

    const listbox = screen.getByRole('listbox', { name: 'Commands' });
    const options = screen.getAllByRole('option');

    expect(listbox.getAttribute('aria-activedescendant')).toBe(options[0]?.id ?? null);
  });

  it('shows all sidebar navigation pages', () => {
    renderPalette({ open: true });
    expect(screen.getByText('Dashboard')).toBeDefined();
    expect(screen.getByText('Machines')).toBeDefined();
    expect(screen.getByText('Agents')).toBeDefined();
    expect(screen.getByText('Sessions')).toBeDefined();
    expect(screen.getByText('Discover')).toBeDefined();
    expect(screen.getByText('Logs')).toBeDefined();
    expect(screen.getByText('Settings')).toBeDefined();
    expect(screen.getAllByText('Memory').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Spaces')).toBeDefined();
    expect(screen.getByText('Tasks')).toBeDefined();
    expect(screen.getByText('Deployment')).toBeDefined();
  });

  it('shows base action commands', () => {
    renderPalette({ open: true });
    expect(screen.getByText('New Session')).toBeDefined();
    expect(screen.getByText('Refresh All Data')).toBeDefined();
    expect(screen.getByText('Toggle Dark/Light Mode')).toBeDefined();
    expect(screen.getByText('Clear Notifications')).toBeDefined();
    expect(screen.getByText('Keyboard Shortcuts')).toBeDefined();
  });

  it('navigates to correct route when a nav command is clicked', () => {
    const { onClose } = renderPalette({ open: true });
    fireEvent.click(screen.getByText('Dashboard'));
    expect(mockPush).toHaveBeenCalledWith('/');
    expect(onClose).toHaveBeenCalled();
  });

  it('calls toast.dismiss when Clear Notifications is clicked', () => {
    const { onClose } = renderPalette({ open: true });
    fireEvent.click(screen.getByText('Clear Notifications'));
    expect(mockToast.dismiss).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('calls setTheme when Toggle Dark/Light Mode is clicked', () => {
    const { onClose } = renderPalette({ open: true });
    fireEvent.click(screen.getByText('Toggle Dark/Light Mode'));
    expect(mockSetTheme).toHaveBeenCalledWith('light');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows toast on Refresh All Data', () => {
    const { onClose } = renderPalette({ open: true });
    fireEvent.click(screen.getByText('Refresh All Data'));
    expect(mockToast.success).toHaveBeenCalledWith('All data refreshed');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows agent actions for each agent: Start, Settings, View', async () => {
    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: () => [
        {
          id: 'agent-1',
          machineId: 'machine-1',
          name: 'alpha',
          type: 'adhoc',
          status: 'idle',
          schedule: null,
          projectPath: '/repo/alpha',
          worktreeBranch: null,
          currentSessionId: null,
          config: {},
          lastRunAt: null,
          lastCostUsd: null,
          totalCostUsd: 0,
          accountId: null,
          createdAt: '2026-03-01T00:00:00Z',
        },
      ],
    });

    renderPalette({ open: true });

    await waitFor(() => {
      expect(screen.getByText('Start alpha')).toBeDefined();
      expect(screen.getByText('Settings alpha')).toBeDefined();
      expect(screen.getByText('View alpha')).toBeDefined();
    });
  });

  it('navigates to agent settings from agent action', async () => {
    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: () => [
        {
          id: 'agent-2',
          machineId: 'machine-1',
          name: 'beta',
          type: 'adhoc',
          status: 'running',
          schedule: null,
          projectPath: '/repo/beta',
          worktreeBranch: null,
          currentSessionId: null,
          config: {},
          lastRunAt: null,
          lastCostUsd: null,
          totalCostUsd: 0,
          accountId: null,
          createdAt: '2026-03-01T00:00:00Z',
        },
      ],
    });

    const { onClose } = renderPalette({ open: true });

    await waitFor(() => {
      expect(screen.getByText('Settings beta')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Settings beta'));
    expect(mockPush).toHaveBeenCalledWith('/agents/agent-2/settings');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows recent sessions section with last 5 View actions', async () => {
    const sessions = Array.from({ length: 6 }, (_, i) => ({
      id: `sess-00${i}`,
      agentId: `a${i}`,
      agentName: `agent-${i}`,
      machineId: 'm1',
      sessionUrl: null,
      claudeSessionId: null,
      status: 'ended',
      projectPath: '/repo/test',
      pid: null,
      startedAt: `2026-03-0${i + 1}T10:00:00Z`,
      endedAt: null,
      lastHeartbeat: null,
      metadata: { summary: `Summary ${i}` },
      accountId: null,
      model: null,
    }));

    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: () => ({ sessions }),
    });

    renderPalette({ open: true });

    await waitFor(() => {
      expect(screen.getByText('View Summary 5')).toBeDefined();
      expect(screen.getByText('View Summary 1')).toBeDefined();
    });

    expect(screen.queryByText('View Summary 0')).toBeNull();
  });

  it('search results are grouped by Agents, Sessions, and Pages', async () => {
    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: () => [
        {
          id: 'agent-deploy-1',
          machineId: 'machine-1',
          name: 'Deploy Bot',
          type: 'adhoc',
          status: 'idle',
          schedule: null,
          projectPath: '/repo/deploy-service',
          worktreeBranch: null,
          currentSessionId: null,
          config: {},
          lastRunAt: null,
          lastCostUsd: null,
          totalCostUsd: 0,
          accountId: null,
          createdAt: '2026-03-01T00:00:00Z',
        },
      ],
    });

    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: () => ({
        sessions: [
          {
            id: 'sess-deploy-1',
            agentId: 'agent-deploy-1',
            agentName: 'Deploy Bot',
            machineId: 'm1',
            sessionUrl: null,
            claudeSessionId: null,
            status: 'active',
            projectPath: '/repo/deploy-service',
            pid: null,
            startedAt: '2026-03-11T10:00:00Z',
            endedAt: null,
            lastHeartbeat: null,
            metadata: { summary: 'Deploy production hotfix' },
            accountId: null,
            model: null,
          },
        ],
      }),
    });

    renderPalette({ open: true });

    const input = screen.getByPlaceholderText(/search agents, sessions, pages/i);
    fireEvent.change(input, { target: { value: 'deploy' } });

    await waitFor(() => {
      expect(screen.getByText('Agents')).toBeDefined();
      expect(screen.getByText('Sessions')).toBeDefined();
      expect(screen.getByText('Pages')).toBeDefined();
      expect(screen.getByText('Deploy Bot')).toBeDefined();
      expect(screen.getByText('Deploy production hotfix')).toBeDefined();
      expect(screen.getByText('Deployment')).toBeDefined();
    });
  });

  it('search matches agent project path', async () => {
    mockAgentsQuery.mockReturnValue({
      queryKey: ['agents'],
      queryFn: () => [
        {
          id: 'agent-path-1',
          machineId: 'machine-1',
          name: 'Path Bot',
          type: 'adhoc',
          status: 'idle',
          schedule: null,
          projectPath: '/workspaces/important-project',
          worktreeBranch: null,
          currentSessionId: null,
          config: {},
          lastRunAt: null,
          lastCostUsd: null,
          totalCostUsd: 0,
          accountId: null,
          createdAt: '2026-03-01T00:00:00Z',
        },
      ],
    });

    renderPalette({ open: true });

    const input = screen.getByPlaceholderText(/search agents, sessions, pages/i);
    fireEvent.change(input, { target: { value: 'important-project' } });

    await waitFor(() => {
      expect(screen.getByText('Path Bot')).toBeDefined();
    });
  });

  it('shows search-mode empty state when no grouped matches', () => {
    renderPalette({ open: true });
    const input = screen.getByPlaceholderText(/search agents, sessions, pages/i);
    fireEvent.change(input, { target: { value: 'xyznonexistent' } });

    expect(screen.getByText('No matching agents, sessions, or pages')).toBeDefined();
  });

  it('calls onClose when Escape is pressed', () => {
    const { onClose } = renderPalette({ open: true });
    const input = screen.getByPlaceholderText(/search agents, sessions, pages/i);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when backdrop is clicked', () => {
    const { onClose } = renderPalette({ open: true });
    const backdrop = screen.getByLabelText('Close command palette');
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('executes active command on Enter', () => {
    renderPalette({ open: true });
    const input = screen.getByPlaceholderText(/search agents, sessions, pages/i);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockPush).toHaveBeenCalledWith('/');
  });

  it('navigates down with ArrowDown', () => {
    renderPalette({ open: true });
    const input = screen.getByPlaceholderText(/search agents, sessions, pages/i);
    const listbox = screen.getByRole('listbox', { name: 'Commands' });
    const options = screen.getAllByRole('option');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(listbox.getAttribute('aria-activedescendant')).toBe(options[1]?.id ?? null);
  });

  it('shows keyboard shortcut hints in footer', () => {
    renderPalette({ open: true });
    expect(screen.getByText('Navigate')).toBeDefined();
    expect(screen.getByText('Select')).toBeDefined();
    expect(screen.getByText('Close')).toBeDefined();
  });

  it('shows result count in footer', () => {
    renderPalette({ open: true });
    expect(screen.getByText('19 results')).toBeDefined();
  });

  it('updates result count in search mode', () => {
    renderPalette({ open: true });
    const input = screen.getByPlaceholderText(/search agents, sessions, pages/i);
    fireEvent.change(input, { target: { value: 'dashboard' } });
    expect(screen.getByText('1 result')).toBeDefined();
  });

  it('shows section headers in default mode', () => {
    renderPalette({ open: true });
    expect(screen.getByText('Navigation')).toBeDefined();
    expect(screen.getByText('Actions')).toBeDefined();
  });

  it('shows keyboard shortcut badges for nav commands', () => {
    renderPalette({ open: true });
    expect(screen.getByText('1')).toBeDefined();
    expect(screen.getByText('2')).toBeDefined();
    expect(screen.getByText('7')).toBeDefined();
  });

  it('changes active item on mouseEnter', () => {
    renderPalette({ open: true });
    const listbox = screen.getByRole('listbox', { name: 'Commands' });
    const machinesOption = screen.getByText('Machines').closest('button');
    if (machinesOption) {
      fireEvent.mouseEnter(machinesOption);
    }
    expect(listbox.getAttribute('aria-activedescendant')).toBe(machinesOption?.id ?? null);
  });

  it('resets query when reopened', () => {
    const qc = createQueryClient();
    const onClose = vi.fn();
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <CommandPalette open={true} onClose={onClose} />
      </QueryClientProvider>,
    );

    const input = screen.getByPlaceholderText(/search agents, sessions, pages/i);
    fireEvent.change(input, { target: { value: 'test' } });
    expect((input as HTMLInputElement).value).toBe('test');

    rerender(
      <QueryClientProvider client={qc}>
        <CommandPalette open={false} onClose={onClose} />
      </QueryClientProvider>,
    );

    rerender(
      <QueryClientProvider client={qc}>
        <CommandPalette open={true} onClose={onClose} />
      </QueryClientProvider>,
    );

    const newInput = screen.getByPlaceholderText(/search agents, sessions, pages/i);
    expect((newInput as HTMLInputElement).value).toBe('');
  });

  it('shows Stop Session actions for active sessions', async () => {
    const activeSession = {
      id: 'sess-active-001',
      agentId: 'a1',
      agentName: 'my-agent',
      machineId: 'm1',
      sessionUrl: null,
      claudeSessionId: null,
      status: 'active',
      projectPath: '/home/user/project',
      pid: null,
      startedAt: '2026-03-07T10:00:00Z',
      endedAt: null,
      lastHeartbeat: null,
      metadata: {},
      accountId: null,
      model: null,
    };
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: () => ({ sessions: [activeSession] }),
    });

    renderPalette({ open: true });

    await waitFor(() => {
      expect(screen.getByText(/Stop: my-agent/)).toBeDefined();
    });
  });

  it('calls deleteSession.mutate when Stop action is clicked', async () => {
    const activeSession = {
      id: 'sess-active-002',
      agentId: 'a2',
      agentName: null,
      machineId: 'm1',
      sessionUrl: null,
      claudeSessionId: null,
      status: 'active',
      projectPath: null,
      pid: null,
      startedAt: '2026-03-07T10:00:00Z',
      endedAt: null,
      lastHeartbeat: null,
      metadata: {},
      accountId: null,
      model: null,
    };
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: () => ({ sessions: [activeSession] }),
    });

    const { onClose } = renderPalette({ open: true });

    await waitFor(() => {
      expect(screen.getByText(/Stop: sess-act/)).toBeDefined();
    });

    fireEvent.click(screen.getByText(/Stop: sess-act/));
    expect(mockDeleteMutate).toHaveBeenCalledWith('sess-active-002', expect.any(Object));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not show Stop actions for ended sessions', async () => {
    const endedSession = {
      id: 'sess-ended-001',
      agentId: 'a1',
      agentName: 'ended-agent',
      machineId: 'm1',
      sessionUrl: null,
      claudeSessionId: null,
      status: 'ended',
      projectPath: null,
      pid: null,
      startedAt: '2026-03-07T10:00:00Z',
      endedAt: '2026-03-07T10:30:00Z',
      lastHeartbeat: null,
      metadata: {},
      accountId: null,
      model: null,
    };
    mockSessionsQuery.mockReturnValue({
      queryKey: ['sessions'],
      queryFn: () => ({ sessions: [endedSession] }),
    });

    renderPalette({ open: true });

    await waitFor(() => {
      expect(screen.getByText('View ended-agent')).toBeDefined();
    });

    expect(screen.queryByText(/Stop:/)).toBeNull();
  });
});

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('hello', 'hello')).toBe(0);
  });

  it('returns length of non-empty string when other is empty', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
  });

  it('returns 1 for single substitution', () => {
    expect(levenshtein('cat', 'car')).toBe(1);
  });

  it('returns 1 for single deletion', () => {
    expect(levenshtein('cat', 'ca')).toBe(1);
  });

  it('returns 1 for single insertion', () => {
    expect(levenshtein('ca', 'cat')).toBe(1);
  });

  it('computes correct distance for "kitten" vs "sitting"', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });
});

describe('fuzzyScore', () => {
  it('returns high score for exact substring match', () => {
    const score = fuzzyScore('mach', 'Machines');
    expect(score).not.toBeNull();
    expect(score).toBeGreaterThanOrEqual(100);
  });

  it('gives starts-with higher score than mid-string match', () => {
    const startScore = fuzzyScore('dash', 'Dashboard');
    const midScore = fuzzyScore('board', 'Dashboard');
    expect(startScore).not.toBeNull();
    expect(midScore).not.toBeNull();
    expect(startScore).toBeGreaterThan(midScore as number);
  });

  it('matches subsequence characters in order', () => {
    const score = fuzzyScore('dbd', 'Dashboard');
    expect(score).not.toBeNull();
    expect(score).toBeGreaterThanOrEqual(10);
    expect(score).toBeLessThan(100);
  });

  it('matches "dashbord" (one missing char) to "dashboard"', () => {
    const score = fuzzyScore('dashbord', 'Dashboard');
    expect(score).not.toBeNull();
    expect(score).toBeGreaterThanOrEqual(1);
  });

  it('matches "settngs" (one missing char) to "settings"', () => {
    const score = fuzzyScore('settngs', 'Settings');
    expect(score).not.toBeNull();
  });

  it('returns null for completely unrelated strings', () => {
    expect(fuzzyScore('xyz', 'Dashboard')).toBeNull();
  });

  it('returns null for short queries with too many edits', () => {
    expect(fuzzyScore('zzz', 'abc')).toBeNull();
  });

  it('is case insensitive', () => {
    const score1 = fuzzyScore('MACH', 'machines');
    const score2 = fuzzyScore('mach', 'MACHINES');
    expect(score1).not.toBeNull();
    expect(score2).not.toBeNull();
    expect(score1).toBe(score2);
  });
});
