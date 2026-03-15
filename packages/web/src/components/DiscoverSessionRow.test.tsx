import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { DiscoveredSession } from '../lib/api';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('../lib/format-utils', () => ({
  formatNumber: (n: number) => String(n),
  recencyColorClass: (dateStr: string) => (dateStr ? 'bg-green-500' : 'bg-muted-foreground'),
}));

vi.mock('./CopyableText', () => ({
  CopyableText: ({ value }: { value: string }) => <span data-testid="copyable-text">{value}</span>,
}));

vi.mock('./HighlightText', () => ({
  HighlightText: ({ text, highlight }: { text: string; highlight: string }) => (
    <span data-testid="highlight-text" data-highlight={highlight}>
      {text}
    </span>
  ),
}));

vi.mock('./LiveTimeAgo', () => ({
  LiveTimeAgo: ({ date }: { date: string }) => <span data-testid="live-time-ago">{date}</span>,
}));

vi.mock('./SimpleTooltip', () => ({
  SimpleTooltip: ({ content, children }: { content: string; children: React.ReactNode }) => (
    <div data-testid="simple-tooltip" data-tooltip-content={content}>
      {children}
    </div>
  ),
}));

import { DiscoverSessionRow } from './DiscoverSessionRow';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<DiscoveredSession> = {}): DiscoveredSession {
  return {
    sessionId: 'abcdef12-3456-7890-abcd-ef1234567890',
    projectPath: '/home/user/project',
    summary: 'Test session summary',
    messageCount: 42,
    lastActivity: '2026-03-07T12:00:00Z',
    branch: null,
    machineId: 'machine-1',
    hostname: 'mac-mini',
    ...overrides,
  };
}

function defaultProps(overrides: Partial<Parameters<typeof DiscoverSessionRow>[0]> = {}) {
  return {
    session: makeSession(),
    isFlat: false,
    isSelected: false,
    isResuming: false,
    isImported: false,
    isChecked: false,
    isImporting: false,
    search: '',
    resumePrompt: '',
    onResumePromptChange: vi.fn(),
    onSelect: vi.fn(),
    onToggleCheck: vi.fn(),
    onImport: vi.fn(),
    onStartResume: vi.fn(),
    onSubmitResume: vi.fn(),
    onCancelResume: vi.fn(),
    ...overrides,
  };
}

// ===========================================================================
// DiscoverSessionRow
// ===========================================================================
describe('DiscoverSessionRow', () => {
  // -------------------------------------------------------------------------
  // Basic rendering
  // -------------------------------------------------------------------------
  it('renders the session summary', () => {
    render(<DiscoverSessionRow {...defaultProps()} />);
    expect(screen.getByText('Test session summary')).toBeDefined();
  });

  it('renders "Untitled" when summary is empty', () => {
    render(<DiscoverSessionRow {...defaultProps({ session: makeSession({ summary: '' }) })} />);
    expect(screen.getByText('Untitled')).toBeDefined();
  });

  it('strips XML/HTML tags from the rendered summary and tooltip', () => {
    render(
      <DiscoverSessionRow
        {...defaultProps({
          session: makeSession({
            summary: 'Run <local-command-caveat>carefully</local-command-caveat>',
          }),
        })}
      />,
    );

    expect(screen.getByText('Run carefully')).toBeDefined();

    const tooltips = screen.getAllByTestId('simple-tooltip');
    const summaryTooltip = tooltips.find(
      (t) => t.getAttribute('data-tooltip-content') === 'Run carefully',
    );
    expect(summaryTooltip).toBeDefined();
  });

  it('renders message count', () => {
    render(<DiscoverSessionRow {...defaultProps()} />);
    expect(screen.getByText('42 msgs')).toBeDefined();
  });

  it('renders hostname', () => {
    render(<DiscoverSessionRow {...defaultProps()} />);
    expect(screen.getByText('mac-mini')).toBeDefined();
  });

  it('renders LiveTimeAgo with lastActivity date', () => {
    render(<DiscoverSessionRow {...defaultProps()} />);
    const timeAgo = screen.getByTestId('live-time-ago');
    expect(timeAgo.textContent).toBe('2026-03-07T12:00:00Z');
  });

  it('renders CopyableText with sessionId', () => {
    render(<DiscoverSessionRow {...defaultProps()} />);
    const copyable = screen.getByTestId('copyable-text');
    expect(copyable.textContent).toBe('abcdef12-3456-7890-abcd-ef1234567890');
  });

  it('renders a recency dot', () => {
    const { container } = render(<DiscoverSessionRow {...defaultProps()} />);
    const dot = container.querySelector('.bg-green-500.rounded-full');
    expect(dot).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Branch badge
  // -------------------------------------------------------------------------
  it('does not render branch badge when branch is null', () => {
    render(<DiscoverSessionRow {...defaultProps({ session: makeSession({ branch: null }) })} />);
    const tooltips = screen.getAllByTestId('simple-tooltip');
    const branchTooltip = tooltips.find((t) =>
      t.getAttribute('data-tooltip-content')?.startsWith('Branch:'),
    );
    expect(branchTooltip).toBeUndefined();
  });

  it('renders branch badge when branch is present', () => {
    render(
      <DiscoverSessionRow
        {...defaultProps({
          session: makeSession({ branch: 'feat/my-feature' }),
        })}
      />,
    );
    expect(screen.getByText('feat/my-feature')).toBeDefined();
  });

  it('renders branch tooltip with branch name', () => {
    render(
      <DiscoverSessionRow
        {...defaultProps({
          session: makeSession({ branch: 'main' }),
        })}
      />,
    );
    const tooltips = screen.getAllByTestId('simple-tooltip');
    const branchTooltip = tooltips.find(
      (t) => t.getAttribute('data-tooltip-content') === 'Branch: main',
    );
    expect(branchTooltip).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Imported badge
  // -------------------------------------------------------------------------
  it('renders "Imported" badge when isImported is true', () => {
    render(<DiscoverSessionRow {...defaultProps({ isImported: true })} />);
    expect(screen.getByText('Imported')).toBeDefined();
  });

  it('does not render "Imported" badge when isImported is false', () => {
    render(<DiscoverSessionRow {...defaultProps({ isImported: false })} />);
    expect(screen.queryByText('Imported')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Checkbox
  // -------------------------------------------------------------------------
  it('renders a checkbox', () => {
    render(<DiscoverSessionRow {...defaultProps()} />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeDefined();
  });

  it('checkbox is checked when isChecked is true', () => {
    render(<DiscoverSessionRow {...defaultProps({ isChecked: true })} />);
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('checkbox is unchecked when isChecked is false', () => {
    render(<DiscoverSessionRow {...defaultProps({ isChecked: false })} />);
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });

  it('checkbox is disabled when isImported is true', () => {
    render(<DiscoverSessionRow {...defaultProps({ isImported: true })} />);
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
  });

  it('checkbox is enabled when isImported is false', () => {
    render(<DiscoverSessionRow {...defaultProps({ isImported: false })} />);
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.disabled).toBe(false);
  });

  it('calls onToggleCheck when checkbox is clicked', () => {
    const onToggleCheck = vi.fn();
    render(<DiscoverSessionRow {...defaultProps({ onToggleCheck })} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onToggleCheck).toHaveBeenCalledWith('abcdef12-3456-7890-abcd-ef1234567890');
  });

  it('checkbox has correct aria-label', () => {
    render(<DiscoverSessionRow {...defaultProps()} />);
    expect(screen.getByLabelText('Select session abcdef12')).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Import button
  // -------------------------------------------------------------------------
  it('renders Import button when not imported and not resuming', () => {
    render(<DiscoverSessionRow {...defaultProps({ isImported: false, isResuming: false })} />);
    expect(screen.getByLabelText(/Import session/)).toBeDefined();
  });

  it('does not render Import button when already imported', () => {
    render(<DiscoverSessionRow {...defaultProps({ isImported: true })} />);
    expect(screen.queryByLabelText(/Import session/)).toBeNull();
  });

  it('does not render Import button when resuming', () => {
    render(<DiscoverSessionRow {...defaultProps({ isResuming: true })} />);
    expect(screen.queryByLabelText(/Import session/)).toBeNull();
  });

  it('shows "Importing..." text when isImporting is true', () => {
    render(<DiscoverSessionRow {...defaultProps({ isImporting: true })} />);
    expect(screen.getByText('Importing...')).toBeDefined();
  });

  it('shows "Import" text when not importing', () => {
    render(<DiscoverSessionRow {...defaultProps()} />);
    expect(screen.getByText('Import')).toBeDefined();
  });

  it('disables Import button when isImporting is true', () => {
    render(<DiscoverSessionRow {...defaultProps({ isImporting: true })} />);
    const button = screen.getByLabelText(/Import session/);
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('calls onImport with session when Import button is clicked', () => {
    const onImport = vi.fn();
    const session = makeSession();
    render(<DiscoverSessionRow {...defaultProps({ session, onImport })} />);
    fireEvent.click(screen.getByText('Import'));
    expect(onImport).toHaveBeenCalledWith(session);
  });

  // -------------------------------------------------------------------------
  // Resume button
  // -------------------------------------------------------------------------
  it('renders Resume button when not resuming', () => {
    render(<DiscoverSessionRow {...defaultProps({ isResuming: false })} />);
    expect(screen.getByLabelText(/Resume session/)).toBeDefined();
  });

  it('does not render Resume button when resuming', () => {
    render(<DiscoverSessionRow {...defaultProps({ isResuming: true })} />);
    expect(screen.queryByLabelText(/Resume session/)).toBeNull();
  });

  it('calls onStartResume with sessionId when Resume button is clicked', () => {
    const onStartResume = vi.fn();
    render(<DiscoverSessionRow {...defaultProps({ onStartResume })} />);
    fireEvent.click(screen.getByText('Resume'));
    expect(onStartResume).toHaveBeenCalledWith('abcdef12-3456-7890-abcd-ef1234567890');
  });

  // -------------------------------------------------------------------------
  // Inline resume form
  // -------------------------------------------------------------------------
  it('does not render resume form when isResuming is false', () => {
    render(<DiscoverSessionRow {...defaultProps({ isResuming: false })} />);
    expect(screen.queryByPlaceholderText('Enter prompt to resume...')).toBeNull();
  });

  it('renders resume form when isResuming is true', () => {
    render(<DiscoverSessionRow {...defaultProps({ isResuming: true })} />);
    expect(screen.getByPlaceholderText('Enter prompt to resume...')).toBeDefined();
  });

  it('renders Go and Cancel buttons in resume form', () => {
    render(<DiscoverSessionRow {...defaultProps({ isResuming: true })} />);
    expect(screen.getByLabelText('Submit resume prompt')).toBeDefined();
    expect(screen.getByLabelText('Cancel resume')).toBeDefined();
  });

  it('reflects resumePrompt value in the resume input', () => {
    render(
      <DiscoverSessionRow {...defaultProps({ isResuming: true, resumePrompt: 'fix the bug' })} />,
    );
    const input = screen.getByPlaceholderText('Enter prompt to resume...') as HTMLInputElement;
    expect(input.value).toBe('fix the bug');
  });

  it('calls onResumePromptChange when typing in resume input', () => {
    const onResumePromptChange = vi.fn();
    render(<DiscoverSessionRow {...defaultProps({ isResuming: true, onResumePromptChange })} />);
    fireEvent.change(screen.getByPlaceholderText('Enter prompt to resume...'), {
      target: { value: 'new prompt' },
    });
    expect(onResumePromptChange).toHaveBeenCalledWith('new prompt');
  });

  it('calls onSubmitResume with session when Enter is pressed in resume input', () => {
    const onSubmitResume = vi.fn();
    const session = makeSession();
    render(<DiscoverSessionRow {...defaultProps({ session, isResuming: true, onSubmitResume })} />);
    fireEvent.keyDown(screen.getByPlaceholderText('Enter prompt to resume...'), { key: 'Enter' });
    expect(onSubmitResume).toHaveBeenCalledWith(session);
  });

  it('calls onCancelResume when Escape is pressed in resume input', () => {
    const onCancelResume = vi.fn();
    render(<DiscoverSessionRow {...defaultProps({ isResuming: true, onCancelResume })} />);
    fireEvent.keyDown(screen.getByPlaceholderText('Enter prompt to resume...'), { key: 'Escape' });
    expect(onCancelResume).toHaveBeenCalledTimes(1);
  });

  it('calls onSubmitResume when Go button is clicked', () => {
    const onSubmitResume = vi.fn();
    const session = makeSession();
    render(
      <DiscoverSessionRow
        {...defaultProps({
          session,
          isResuming: true,
          resumePrompt: 'do it',
          onSubmitResume,
        })}
      />,
    );
    fireEvent.click(screen.getByLabelText('Submit resume prompt'));
    expect(onSubmitResume).toHaveBeenCalledWith(session);
  });

  it('disables Go button when resumePrompt is empty', () => {
    render(<DiscoverSessionRow {...defaultProps({ isResuming: true, resumePrompt: '' })} />);
    const goBtn = screen.getByLabelText('Submit resume prompt');
    expect(goBtn.hasAttribute('disabled')).toBe(true);
  });

  it('disables Go button when resumePrompt is whitespace only', () => {
    render(<DiscoverSessionRow {...defaultProps({ isResuming: true, resumePrompt: '   ' })} />);
    const goBtn = screen.getByLabelText('Submit resume prompt');
    expect(goBtn.hasAttribute('disabled')).toBe(true);
  });

  it('enables Go button when resumePrompt has content', () => {
    render(<DiscoverSessionRow {...defaultProps({ isResuming: true, resumePrompt: 'fix bug' })} />);
    const goBtn = screen.getByLabelText('Submit resume prompt');
    expect(goBtn.hasAttribute('disabled')).toBe(false);
  });

  it('calls onCancelResume when Cancel button is clicked', () => {
    const onCancelResume = vi.fn();
    render(<DiscoverSessionRow {...defaultProps({ isResuming: true, onCancelResume })} />);
    fireEvent.click(screen.getByLabelText('Cancel resume'));
    expect(onCancelResume).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Select session
  // -------------------------------------------------------------------------
  it('calls onSelect with sessionId when session content is clicked', () => {
    const onSelect = vi.fn();
    render(<DiscoverSessionRow {...defaultProps({ onSelect })} />);
    fireEvent.click(screen.getByText('Test session summary'));
    expect(onSelect).toHaveBeenCalledWith('abcdef12-3456-7890-abcd-ef1234567890');
  });

  // -------------------------------------------------------------------------
  // HighlightText
  // -------------------------------------------------------------------------
  it('passes search to HighlightText', () => {
    render(<DiscoverSessionRow {...defaultProps({ search: 'test' })} />);
    const highlight = screen.getByTestId('highlight-text');
    expect(highlight.getAttribute('data-highlight')).toBe('test');
  });

  // -------------------------------------------------------------------------
  // Summary tooltip
  // -------------------------------------------------------------------------
  it('renders summary tooltip with session summary', () => {
    render(<DiscoverSessionRow {...defaultProps()} />);
    const tooltips = screen.getAllByTestId('simple-tooltip');
    const summaryTooltip = tooltips.find(
      (t) => t.getAttribute('data-tooltip-content') === 'Test session summary',
    );
    expect(summaryTooltip).toBeDefined();
  });

  it('renders "Untitled" in tooltip when summary is empty', () => {
    render(<DiscoverSessionRow {...defaultProps({ session: makeSession({ summary: '' }) })} />);
    const tooltips = screen.getAllByTestId('simple-tooltip');
    const untitledTooltip = tooltips.find(
      (t) => t.getAttribute('data-tooltip-content') === 'Untitled',
    );
    expect(untitledTooltip).toBeDefined();
  });
});
