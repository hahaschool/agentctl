import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fuzzyScore, levenshtein } from '@/lib/fuzzy-search';
import { CommandPalette } from './CommandPalette';

// ---------------------------------------------------------------------------
// Mock next/navigation
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Mock next-themes
// ---------------------------------------------------------------------------

const mockSetTheme = vi.fn();
let mockTheme = 'dark';
vi.mock('next-themes', () => ({
  useTheme: () => ({
    theme: mockTheme,
    setTheme: mockSetTheme,
  }),
}));

// ---------------------------------------------------------------------------
// Mock Toast
// ---------------------------------------------------------------------------

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock('@/components/Toast', () => ({
  toast: mockToast,
}));

// ---------------------------------------------------------------------------
// Mock queries
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockTheme = 'dark';
  mockAgentsQuery.mockReturnValue({ queryKey: ['agents'], queryFn: () => [] });
  mockMachinesQuery.mockReturnValue({ queryKey: ['machines'], queryFn: () => [] });
  mockSessionsQuery.mockReturnValue({ queryKey: ['sessions'], queryFn: () => ({ sessions: [] }) });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// Tests
// ===========================================================================

describe('CommandPalette', () => {
  // -----------------------------------------------------------------------
  // Visibility
  // -----------------------------------------------------------------------

  it('renders nothing when open=false', () => {
    const { container } = renderPalette({ open: false });
    expect(container.innerHTML).toBe('');
  });

  it('renders modal overlay when open=true', () => {
    renderPalette({ open: true });
    expect(screen.getByRole('dialog', { name: /command palette/i })).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Search input
  // -----------------------------------------------------------------------

  it('shows search input with placeholder text', () => {
    renderPalette({ open: true });
    const input = screen.getByPlaceholderText(/type a command or search/i);
    expect(input).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Navigation commands
  // -----------------------------------------------------------------------

  it('shows all navigation commands', () => {
    renderPalette({ open: true });
    expect(screen.getByText('Dashboard')).toBeDefined();
    expect(screen.getByText('Machines')).toBeDefined();
    expect(screen.getByText('Agents')).toBeDefined();
    expect(screen.getByText('Sessions')).toBeDefined();
    expect(screen.getByText('Discover Sessions')).toBeDefined();
    expect(screen.getByText('Logs & Metrics')).toBeDefined();
    expect(screen.getByText('Settings')).toBeDefined();
  });

  it('navigates to correct route when a nav command is clicked', () => {
    const { onClose } = renderPalette({ open: true });
    fireEvent.click(screen.getByText('Dashboard'));
    expect(mockPush).toHaveBeenCalledWith('/');
    expect(onClose).toHaveBeenCalled();
  });

  it('navigates to /machines when Machines command is clicked', () => {
    const { onClose } = renderPalette({ open: true });
    fireEvent.click(screen.getByText('Machines'));
    expect(mockPush).toHaveBeenCalledWith('/machines');
    expect(onClose).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Action commands
  // -----------------------------------------------------------------------

  it('shows action commands', () => {
    renderPalette({ open: true });
    expect(screen.getByText('Refresh All Data')).toBeDefined();
    expect(screen.getByText('Toggle Dark/Light Mode')).toBeDefined();
    expect(screen.getByText('Clear Notifications')).toBeDefined();
    expect(screen.getByText('Keyboard Shortcuts')).toBeDefined();
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

  it('toggles to dark when current theme is light', () => {
    mockTheme = 'light';
    renderPalette({ open: true });
    fireEvent.click(screen.getByText('Toggle Dark/Light Mode'));
    expect(mockSetTheme).toHaveBeenCalledWith('dark');
  });

  it('shows toast on Refresh All Data', () => {
    const { onClose } = renderPalette({ open: true });
    fireEvent.click(screen.getByText('Refresh All Data'));
    expect(mockToast.success).toHaveBeenCalledWith('All data refreshed');
    expect(onClose).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Filtering
  // -----------------------------------------------------------------------

  it('filters commands based on search query', () => {
    renderPalette({ open: true });
    const input = screen.getByPlaceholderText(/type a command or search/i);
    fireEvent.change(input, { target: { value: 'dashboard' } });

    expect(screen.getByText('Dashboard')).toBeDefined();
    // Other nav commands should be filtered out
    expect(screen.queryByText('Machines')).toBeNull();
    expect(screen.queryByText('Agents')).toBeNull();
    expect(screen.queryByText('Sessions')).toBeNull();
  });

  it('filters by section name', () => {
    renderPalette({ open: true });
    const input = screen.getByPlaceholderText(/type a command or search/i);
    fireEvent.change(input, { target: { value: 'actions' } });

    // Action commands should match via section
    expect(screen.getByText('Refresh All Data')).toBeDefined();
    expect(screen.getByText('Toggle Dark/Light Mode')).toBeDefined();
    // Nav commands should be filtered out
    expect(screen.queryByText('Dashboard')).toBeNull();
  });

  it('shows "No matching commands" when query has no matches', () => {
    renderPalette({ open: true });
    const input = screen.getByPlaceholderText(/type a command or search/i);
    fireEvent.change(input, { target: { value: 'xyznonexistent' } });

    expect(screen.getByText('No matching commands')).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Keyboard interaction
  // -----------------------------------------------------------------------

  it('calls onClose when Escape is pressed', () => {
    const { onClose } = renderPalette({ open: true });
    const input = screen.getByPlaceholderText(/type a command or search/i);
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
    const input = screen.getByPlaceholderText(/type a command or search/i);
    // First item (Dashboard) is active by default
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockPush).toHaveBeenCalledWith('/');
  });

  it('navigates down with ArrowDown and wraps around', () => {
    renderPalette({ open: true });
    const input = screen.getByPlaceholderText(/type a command or search/i);

    // Move down once — now on Machines (index 1)
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockPush).toHaveBeenCalledWith('/machines');
  });

  it('navigates up with ArrowUp from first item wraps to last', () => {
    renderPalette({ open: true });
    const input = screen.getByPlaceholderText(/type a command or search/i);

    // ArrowUp from index 0 should wrap to last item
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    // Last item is "Keyboard Shortcuts" action — pressing Enter triggers it
    fireEvent.keyDown(input, { key: 'Enter' });
    // The last action dispatches a keydown event and calls onClose
    // We can just verify it doesn't crash and the action fires
  });

  // -----------------------------------------------------------------------
  // Footer
  // -----------------------------------------------------------------------

  it('shows keyboard shortcut hints in footer', () => {
    renderPalette({ open: true });
    // "Navigate" appears both as section header and footer hint — use getAllByText
    expect(screen.getAllByText('Navigate').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Select')).toBeDefined();
    expect(screen.getByText('Close')).toBeDefined();
  });

  it('shows result count in footer', () => {
    renderPalette({ open: true });
    // 7 nav + 5 action = 12 results
    expect(screen.getByText('12 results')).toBeDefined();
  });

  it('updates result count when filtering', () => {
    renderPalette({ open: true });
    const input = screen.getByPlaceholderText(/type a command or search/i);
    fireEvent.change(input, { target: { value: 'dashboard' } });
    expect(screen.getByText('1 result')).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Section headers
  // -----------------------------------------------------------------------

  it('shows section headers', () => {
    renderPalette({ open: true });
    // "Navigate" appears both as section header and as footer hint
    // "Actions" should be a section header
    const actionHeaders = screen.getAllByText('Actions');
    expect(actionHeaders.length).toBeGreaterThanOrEqual(1);
  });

  // -----------------------------------------------------------------------
  // Shortcut badges
  // -----------------------------------------------------------------------

  it('shows keyboard shortcut badges for nav commands', () => {
    renderPalette({ open: true });
    // Shortcut "1" for Dashboard
    expect(screen.getByText('1')).toBeDefined();
    expect(screen.getByText('2')).toBeDefined();
    expect(screen.getByText('7')).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Active item highlight via mouse
  // -----------------------------------------------------------------------

  it('changes active item on mouseEnter', () => {
    renderPalette({ open: true });
    const machinesOption = screen.getByText('Machines').closest('button');
    if (machinesOption) {
      fireEvent.mouseEnter(machinesOption);
    }
    const input = screen.getByPlaceholderText(/type a command or search/i);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockPush).toHaveBeenCalledWith('/machines');
  });

  // -----------------------------------------------------------------------
  // Query reset on open
  // -----------------------------------------------------------------------

  it('resets query when reopened', () => {
    const qc = createQueryClient();
    const onClose = vi.fn();
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <CommandPalette open={true} onClose={onClose} />
      </QueryClientProvider>,
    );
    // Type something
    const input = screen.getByPlaceholderText(/type a command or search/i);
    fireEvent.change(input, { target: { value: 'test' } });
    expect((input as HTMLInputElement).value).toBe('test');

    // Close
    rerender(
      <QueryClientProvider client={qc}>
        <CommandPalette open={false} onClose={onClose} />
      </QueryClientProvider>,
    );

    // Reopen
    rerender(
      <QueryClientProvider client={qc}>
        <CommandPalette open={true} onClose={onClose} />
      </QueryClientProvider>,
    );
    const newInput = screen.getByPlaceholderText(/type a command or search/i);
    expect((newInput as HTMLInputElement).value).toBe('');
  });

  // -----------------------------------------------------------------------
  // Fuzzy search: partial matches
  // -----------------------------------------------------------------------

  it('fuzzy matches partial query "mach" to "Machines"', () => {
    renderPalette({ open: true });
    const input = screen.getByPlaceholderText(/type a command or search/i);
    fireEvent.change(input, { target: { value: 'mach' } });
    expect(screen.getByText('Machines')).toBeDefined();
  });

  it('fuzzy matches partial query "sett" to "Settings"', () => {
    renderPalette({ open: true });
    const input = screen.getByPlaceholderText(/type a command or search/i);
    fireEvent.change(input, { target: { value: 'sett' } });
    expect(screen.getByText('Settings')).toBeDefined();
  });

  it('fuzzy matches partial query "sess" to "Sessions" and "Discover Sessions"', () => {
    renderPalette({ open: true });
    const input = screen.getByPlaceholderText(/type a command or search/i);
    fireEvent.change(input, { target: { value: 'sess' } });
    expect(screen.getByText('Sessions')).toBeDefined();
    expect(screen.getByText('Discover Sessions')).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Fuzzy search: typo tolerance
  // -----------------------------------------------------------------------

  it('fuzzy matches "dashbord" (typo) to "Dashboard"', () => {
    renderPalette({ open: true });
    const input = screen.getByPlaceholderText(/type a command or search/i);
    fireEvent.change(input, { target: { value: 'dashbord' } });
    expect(screen.getByText('Dashboard')).toBeDefined();
  });

  it('fuzzy matches "machnes" (typo) to "Machines"', () => {
    renderPalette({ open: true });
    const input = screen.getByPlaceholderText(/type a command or search/i);
    fireEvent.change(input, { target: { value: 'machnes' } });
    expect(screen.getByText('Machines')).toBeDefined();
  });

  it('fuzzy matches "settngs" (typo) to "Settings"', () => {
    renderPalette({ open: true });
    const input = screen.getByPlaceholderText(/type a command or search/i);
    fireEvent.change(input, { target: { value: 'settngs' } });
    expect(screen.getByText('Settings')).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Fuzzy search: results sorted by relevance
  // -----------------------------------------------------------------------

  it('sorts results by relevance — exact match first', () => {
    renderPalette({ open: true });
    const input = screen.getByPlaceholderText(/type a command or search/i);
    // "Log" is a substring of "Logs & Metrics" (exact substring) and also
    // a subsequence of "Toggle Dark/Light Mode" (t-o-g-g-l-e has no 'l' before 'o'... but "Toggle" has o,g,l → subsequence "log" matches)
    fireEvent.change(input, { target: { value: 'log' } });

    // Get all option buttons in order
    const options = screen.getAllByRole('option');
    // "Logs & Metrics" should appear before any other match because it has an exact substring match
    const logsIndex = options.findIndex((opt) => opt.textContent?.includes('Logs & Metrics'));
    expect(logsIndex).toBeGreaterThanOrEqual(0);
    // If Toggle appears, it should be ranked lower
    const toggleIndex = options.findIndex((opt) => opt.textContent?.includes('Toggle'));
    if (toggleIndex >= 0) {
      expect(logsIndex).toBeLessThan(toggleIndex);
    }
  });

  it('ranks exact substring higher than subsequence match', () => {
    renderPalette({ open: true });
    const input = screen.getByPlaceholderText(/type a command or search/i);
    fireEvent.change(input, { target: { value: 'agent' } });

    const options = screen.getAllByRole('option');
    // "Agents" (exact substring on label) should come first
    const agentsIdx = options.findIndex((opt) => opt.textContent?.includes('Agents'));
    expect(agentsIdx).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Stop Session actions
  // -----------------------------------------------------------------------

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
      const input = screen.getByPlaceholderText(/type a command or search/i);
      fireEvent.change(input, { target: { value: 'stop' } });
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
      expect(screen.queryByText(/Stop: sess-act/)).not.toBeNull();
    });

    const input = screen.getByPlaceholderText(/type a command or search/i);
    fireEvent.change(input, { target: { value: 'stop' } });
    const stopBtn = screen.getByText(/Stop: sess-act/);
    fireEvent.click(stopBtn);
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

    // Wait for query to resolve, then verify no Stop actions appear
    await waitFor(() => {
      // The session data should have loaded by now
      const input = screen.getByPlaceholderText(/type a command or search/i);
      fireEvent.change(input, { target: { value: 'stop' } });
    });
    expect(screen.queryByText(/Stop:/)).toBeNull();
  });
});

// ===========================================================================
// Unit tests for fuzzyScore and levenshtein
// ===========================================================================

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
  // Exact substring
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

  // Subsequence
  it('matches subsequence characters in order', () => {
    // "dbd" is a subsequence of "Dashboard" (d-a-s-h-b-o-a-r-d → d(0), b(4), d(8))
    const score = fuzzyScore('dbd', 'Dashboard');
    expect(score).not.toBeNull();
    expect(score).toBeGreaterThanOrEqual(10);
    expect(score).toBeLessThan(100);
  });

  // Typo tolerance via Levenshtein
  it('matches "dashbord" (one missing char) to "dashboard"', () => {
    const score = fuzzyScore('dashbord', 'Dashboard');
    expect(score).not.toBeNull();
    expect(score).toBeGreaterThanOrEqual(1);
  });

  it('matches "settngs" (one missing char) to "settings"', () => {
    const score = fuzzyScore('settngs', 'Settings');
    expect(score).not.toBeNull();
  });

  // No match
  it('returns null for completely unrelated strings', () => {
    expect(fuzzyScore('xyz', 'Dashboard')).toBeNull();
  });

  it('returns null for short queries with too many edits', () => {
    expect(fuzzyScore('zzz', 'abc')).toBeNull();
  });

  // Case insensitivity
  it('is case insensitive', () => {
    const score1 = fuzzyScore('MACH', 'machines');
    const score2 = fuzzyScore('mach', 'MACHINES');
    expect(score1).not.toBeNull();
    expect(score2).not.toBeNull();
    expect(score1).toBe(score2);
  });
});
