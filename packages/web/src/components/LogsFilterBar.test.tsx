import { fireEvent, render, screen, within } from '@testing-library/react';

import type { AuditAction } from '../lib/api';

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('../lib/format-utils', () => ({
  downloadCsv: vi.fn(),
}));

vi.mock('./SimpleTooltip', () => ({
  SimpleTooltip: ({ children, content }: { children: React.ReactNode; content: string }) => (
    <div data-testid="tooltip" data-tooltip-content={content}>
      {children}
    </div>
  ),
}));

import { downloadCsv } from '../lib/format-utils';
import type { LogsFilterBarProps } from './LogsFilterBar';
import { LogsFilterBar } from './LogsFilterBar';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAction(overrides: Partial<AuditAction> = {}): AuditAction {
  return {
    id: 'act-1',
    runId: 'run-1',
    timestamp: '2026-03-07T12:00:00Z',
    actionType: 'tool_use',
    toolName: 'Read',
    toolInput: null,
    toolOutputHash: null,
    durationMs: 150,
    approvedBy: null,
    agentId: 'agent-1',
    ...overrides,
  };
}

const defaultProps: LogsFilterBarProps = {
  search: '',
  actionTypeFilter: 'all',
  agentFilter: '',
  toolFilter: '',
  sortBy: 'newest',
  agents: [
    { id: 'agent-1', name: 'Builder' },
    { id: 'agent-2', name: 'Reviewer' },
  ],
  toolNames: ['Read', 'Write', 'Bash'],
  sortedActions: [makeAction()],
  onSearchChange: vi.fn(),
  onActionTypeFilterChange: vi.fn(),
  onAgentFilterChange: vi.fn(),
  onToolFilterChange: vi.fn(),
  onSortByChange: vi.fn(),
};

function renderBar(overrides: Partial<LogsFilterBarProps> = {}) {
  const props = { ...defaultProps, ...overrides };
  return render(<LogsFilterBar {...props} />);
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LogsFilterBar', () => {
  // -----------------------------------------------------------------------
  // 1. Rendering with default props
  // -----------------------------------------------------------------------
  describe('rendering with default props', () => {
    it('renders the search input with placeholder', () => {
      renderBar();
      const input = screen.getByPlaceholderText('Search actions, tools, agents...');
      expect(input).toBeDefined();
    });

    it('renders the agent filter dropdown', () => {
      renderBar();
      expect(screen.getByLabelText('Filter by agent')).toBeDefined();
    });

    it('renders the tool filter dropdown', () => {
      renderBar();
      expect(screen.getByLabelText('Filter by tool')).toBeDefined();
    });

    it('renders the sort dropdown', () => {
      renderBar();
      expect(screen.getByLabelText('Sort by')).toBeDefined();
    });

    it('renders the Export CSV button', () => {
      renderBar();
      expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDefined();
    });

    it('renders all five action type tabs', () => {
      renderBar();
      expect(screen.getByRole('button', { name: 'All' })).toBeDefined();
      expect(screen.getByRole('button', { name: 'Tool Use' })).toBeDefined();
      expect(screen.getByRole('button', { name: 'Tool Result' })).toBeDefined();
      expect(screen.getByRole('button', { name: 'Text' })).toBeDefined();
      expect(screen.getByRole('button', { name: 'Error' })).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // 2. Search input changes
  // -----------------------------------------------------------------------
  describe('search input', () => {
    it('calls onSearchChange when user types', () => {
      const onSearchChange = vi.fn();
      renderBar({ onSearchChange });
      const input = screen.getByPlaceholderText('Search actions, tools, agents...');
      fireEvent.change(input, { target: { value: 'bash' } });
      expect(onSearchChange).toHaveBeenCalledWith('bash');
    });

    it('reflects the current search value', () => {
      renderBar({ search: 'existing query' });
      const input = screen.getByPlaceholderText(
        'Search actions, tools, agents...',
      ) as HTMLInputElement;
      expect(input.value).toBe('existing query');
    });
  });

  // -----------------------------------------------------------------------
  // 3. Agent filter dropdown
  // -----------------------------------------------------------------------
  describe('agent filter dropdown', () => {
    it('shows "All Agents" as the default option', () => {
      renderBar();
      const select = screen.getByLabelText('Filter by agent') as HTMLSelectElement;
      const options = within(select).getAllByRole('option');
      expect((options[0] as HTMLOptionElement).textContent).toBe('All Agents');
      expect((options[0] as HTMLOptionElement).value).toBe('');
    });

    it('lists all provided agents as options', () => {
      renderBar();
      const select = screen.getByLabelText('Filter by agent') as HTMLSelectElement;
      const options = within(select).getAllByRole('option');
      // "All Agents" + 2 agents = 3
      expect(options.length).toBe(3);
      expect((options[1] as HTMLOptionElement).textContent).toBe('Builder');
      expect((options[2] as HTMLOptionElement).textContent).toBe('Reviewer');
    });

    it('calls onAgentFilterChange when a different agent is selected', () => {
      const onAgentFilterChange = vi.fn();
      renderBar({ onAgentFilterChange });
      fireEvent.change(screen.getByLabelText('Filter by agent'), {
        target: { value: 'agent-2' },
      });
      expect(onAgentFilterChange).toHaveBeenCalledWith('agent-2');
    });

    it('reflects the current agentFilter value', () => {
      renderBar({ agentFilter: 'agent-1' });
      const select = screen.getByLabelText('Filter by agent') as HTMLSelectElement;
      expect(select.value).toBe('agent-1');
    });
  });

  // -----------------------------------------------------------------------
  // 4. Tool filter dropdown
  // -----------------------------------------------------------------------
  describe('tool filter dropdown', () => {
    it('shows "All Tools" as the default option', () => {
      renderBar();
      const select = screen.getByLabelText('Filter by tool') as HTMLSelectElement;
      const options = within(select).getAllByRole('option');
      expect((options[0] as HTMLOptionElement).textContent).toBe('All Tools');
      expect((options[0] as HTMLOptionElement).value).toBe('');
    });

    it('lists all provided tool names as options', () => {
      renderBar();
      const select = screen.getByLabelText('Filter by tool') as HTMLSelectElement;
      const options = within(select).getAllByRole('option');
      // "All Tools" + 3 tools = 4
      expect(options.length).toBe(4);
      expect((options[1] as HTMLOptionElement).textContent).toBe('Read');
      expect((options[2] as HTMLOptionElement).textContent).toBe('Write');
      expect((options[3] as HTMLOptionElement).textContent).toBe('Bash');
    });

    it('calls onToolFilterChange when a different tool is selected', () => {
      const onToolFilterChange = vi.fn();
      renderBar({ onToolFilterChange });
      fireEvent.change(screen.getByLabelText('Filter by tool'), {
        target: { value: 'Bash' },
      });
      expect(onToolFilterChange).toHaveBeenCalledWith('Bash');
    });

    it('reflects the current toolFilter value', () => {
      renderBar({ toolFilter: 'Write' });
      const select = screen.getByLabelText('Filter by tool') as HTMLSelectElement;
      expect(select.value).toBe('Write');
    });
  });

  // -----------------------------------------------------------------------
  // 5. Action type tab buttons
  // -----------------------------------------------------------------------
  describe('action type tabs', () => {
    it('calls onActionTypeFilterChange when a tab is clicked', () => {
      const onActionTypeFilterChange = vi.fn();
      renderBar({ onActionTypeFilterChange });
      fireEvent.click(screen.getByRole('button', { name: 'Tool Use' }));
      expect(onActionTypeFilterChange).toHaveBeenCalledWith('tool_use');
    });

    it('calls onActionTypeFilterChange with "error" for the Error tab', () => {
      const onActionTypeFilterChange = vi.fn();
      renderBar({ onActionTypeFilterChange });
      fireEvent.click(screen.getByRole('button', { name: 'Error' }));
      expect(onActionTypeFilterChange).toHaveBeenCalledWith('error');
    });

    it('calls onActionTypeFilterChange with "text" for the Text tab', () => {
      const onActionTypeFilterChange = vi.fn();
      renderBar({ onActionTypeFilterChange });
      fireEvent.click(screen.getByRole('button', { name: 'Text' }));
      expect(onActionTypeFilterChange).toHaveBeenCalledWith('text');
    });

    it('calls onActionTypeFilterChange with "tool_result" for the Tool Result tab', () => {
      const onActionTypeFilterChange = vi.fn();
      renderBar({ onActionTypeFilterChange });
      fireEvent.click(screen.getByRole('button', { name: 'Tool Result' }));
      expect(onActionTypeFilterChange).toHaveBeenCalledWith('tool_result');
    });

    it('applies active styling to the currently selected tab', () => {
      renderBar({ actionTypeFilter: 'error' });
      const errorBtn = screen.getByRole('button', { name: 'Error' });
      expect(errorBtn.className).toContain('bg-foreground');
      expect(errorBtn.className).toContain('text-background');
    });

    it('applies inactive styling to non-selected tabs', () => {
      renderBar({ actionTypeFilter: 'error' });
      const allBtn = screen.getByRole('button', { name: 'All' });
      expect(allBtn.className).toContain('bg-card');
      expect(allBtn.className).toContain('text-muted-foreground');
    });
  });

  // -----------------------------------------------------------------------
  // 6. Sort dropdown
  // -----------------------------------------------------------------------
  describe('sort dropdown', () => {
    it('renders all sort options', () => {
      renderBar();
      const select = screen.getByLabelText('Sort by') as HTMLSelectElement;
      const options = within(select).getAllByRole('option');
      expect(options.length).toBe(4);
      expect((options[0] as HTMLOptionElement).value).toBe('newest');
      expect((options[1] as HTMLOptionElement).value).toBe('oldest');
      expect((options[2] as HTMLOptionElement).value).toBe('agent');
      expect((options[3] as HTMLOptionElement).value).toBe('tool');
    });

    it('displays human-readable labels for sort options', () => {
      renderBar();
      const select = screen.getByLabelText('Sort by') as HTMLSelectElement;
      const options = within(select).getAllByRole('option');
      expect((options[0] as HTMLOptionElement).textContent).toBe('Newest first');
      expect((options[1] as HTMLOptionElement).textContent).toBe('Oldest first');
      expect((options[2] as HTMLOptionElement).textContent).toBe('Agent');
      expect((options[3] as HTMLOptionElement).textContent).toBe('Tool name');
    });

    it('calls onSortByChange when the sort selection changes', () => {
      const onSortByChange = vi.fn();
      renderBar({ onSortByChange });
      fireEvent.change(screen.getByLabelText('Sort by'), {
        target: { value: 'oldest' },
      });
      expect(onSortByChange).toHaveBeenCalledWith('oldest');
    });

    it('reflects the current sortBy value', () => {
      renderBar({ sortBy: 'agent' });
      const select = screen.getByLabelText('Sort by') as HTMLSelectElement;
      expect(select.value).toBe('agent');
    });
  });

  // -----------------------------------------------------------------------
  // 7. CSV export button
  // -----------------------------------------------------------------------
  describe('CSV export button', () => {
    it('calls downloadCsv with correct headers and data when clicked', () => {
      const action = makeAction({
        timestamp: '2026-03-07T10:00:00Z',
        actionType: 'tool_use',
        toolName: 'Read',
        agentId: 'agent-1',
        runId: 'run-1',
        durationMs: 200,
        approvedBy: 'auto',
      });
      renderBar({ sortedActions: [action] });
      fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
      expect(downloadCsv).toHaveBeenCalledTimes(1);
      const [headers, rows, filename] = (downloadCsv as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(headers).toEqual([
        'timestamp',
        'actionType',
        'toolName',
        'agentId',
        'runId',
        'durationMs',
        'approvedBy',
      ]);
      expect(rows).toEqual([
        ['2026-03-07T10:00:00Z', 'tool_use', 'Read', 'agent-1', 'run-1', 200, 'auto'],
      ]);
      expect(filename).toMatch(/^audit-trail-\d{4}-\d{2}-\d{2}\.csv$/);
    });

    it('does not call downloadCsv when sortedActions is empty', () => {
      renderBar({ sortedActions: [] });
      fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
      expect(downloadCsv).not.toHaveBeenCalled();
    });

    it('is disabled when sortedActions is empty', () => {
      renderBar({ sortedActions: [] });
      const btn = screen.getByRole('button', { name: 'Export CSV' });
      expect(btn.hasAttribute('disabled')).toBe(true);
    });

    it('is enabled when sortedActions is not empty', () => {
      renderBar({ sortedActions: [makeAction()] });
      const btn = screen.getByRole('button', { name: 'Export CSV' });
      expect(btn.hasAttribute('disabled')).toBe(false);
    });

    it('shows tooltip with "No actions to export" when empty', () => {
      renderBar({ sortedActions: [] });
      const tooltip = screen.getByTestId('tooltip');
      expect(tooltip.getAttribute('data-tooltip-content')).toBe('No actions to export');
    });

    it('shows tooltip with "Download filtered actions as CSV" when actions exist', () => {
      renderBar({ sortedActions: [makeAction()] });
      const tooltip = screen.getByTestId('tooltip');
      expect(tooltip.getAttribute('data-tooltip-content')).toBe('Download filtered actions as CSV');
    });

    it('exports multiple actions as separate rows', () => {
      const actions = [
        makeAction({ id: 'act-1', toolName: 'Read' }),
        makeAction({ id: 'act-2', toolName: 'Write' }),
        makeAction({ id: 'act-3', toolName: 'Bash' }),
      ];
      renderBar({ sortedActions: actions });
      fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
      const [, rows] = (downloadCsv as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(rows.length).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // 8. Keyboard shortcut hint display
  // -----------------------------------------------------------------------
  describe('keyboard shortcut hint', () => {
    it('shows the "/" kbd hint when search is empty', () => {
      renderBar({ search: '' });
      const kbds = document.querySelectorAll('kbd');
      const slashKbd = Array.from(kbds).find((k) => k.textContent === '/');
      expect(slashKbd).toBeDefined();
    });

    it('hides the "/" kbd hint when search has a value', () => {
      renderBar({ search: 'something' });
      const kbds = document.querySelectorAll('kbd');
      const slashKbd = Array.from(kbds).find((k) => k.textContent === '/');
      expect(slashKbd).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // 9. Empty state when no agents/tools
  // -----------------------------------------------------------------------
  describe('empty agents and tools lists', () => {
    it('renders agent dropdown with only "All Agents" when agents list is empty', () => {
      renderBar({ agents: [] });
      const select = screen.getByLabelText('Filter by agent') as HTMLSelectElement;
      const options = within(select).getAllByRole('option');
      expect(options.length).toBe(1);
      expect((options[0] as HTMLOptionElement).textContent).toBe('All Agents');
    });

    it('renders tool dropdown with only "All Tools" when toolNames list is empty', () => {
      renderBar({ toolNames: [] });
      const select = screen.getByLabelText('Filter by tool') as HTMLSelectElement;
      const options = within(select).getAllByRole('option');
      expect(options.length).toBe(1);
      expect((options[0] as HTMLOptionElement).textContent).toBe('All Tools');
    });

    it('renders correctly when both agents and tools are empty', () => {
      renderBar({ agents: [], toolNames: [] });
      const agentSelect = screen.getByLabelText('Filter by agent') as HTMLSelectElement;
      const toolSelect = screen.getByLabelText('Filter by tool') as HTMLSelectElement;
      expect(within(agentSelect).getAllByRole('option').length).toBe(1);
      expect(within(toolSelect).getAllByRole('option').length).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // 10. Integration / edge cases
  // -----------------------------------------------------------------------
  describe('integration and edge cases', () => {
    it('does not call other callbacks when only search changes', () => {
      const onActionTypeFilterChange = vi.fn();
      const onAgentFilterChange = vi.fn();
      const onToolFilterChange = vi.fn();
      const onSortByChange = vi.fn();
      renderBar({
        onActionTypeFilterChange,
        onAgentFilterChange,
        onToolFilterChange,
        onSortByChange,
      });
      const input = screen.getByPlaceholderText('Search actions, tools, agents...');
      fireEvent.change(input, { target: { value: 'test' } });
      expect(onActionTypeFilterChange).not.toHaveBeenCalled();
      expect(onAgentFilterChange).not.toHaveBeenCalled();
      expect(onToolFilterChange).not.toHaveBeenCalled();
      expect(onSortByChange).not.toHaveBeenCalled();
    });

    it('renders search icon character', () => {
      renderBar();
      // The search icon is the Unicode character ⌕ (\u2315)
      const searchIcon = document.querySelector('span');
      expect(searchIcon?.textContent).toBe('\u2315');
    });
  });
});
