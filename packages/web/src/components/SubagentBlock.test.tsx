import { render, screen } from '@testing-library/react';

import { SubagentBlock } from './SubagentBlock';

describe('SubagentBlock', () => {
  it('renders subagent content', () => {
    render(<SubagentBlock content="Subagent output here" />);
    expect(screen.getByText('Subagent output here')).toBeDefined();
  });

  it('shows "Subagent" label', () => {
    render(<SubagentBlock content="content" />);
    expect(screen.getByText('Subagent')).toBeDefined();
  });

  it('shows tool name if provided', () => {
    render(<SubagentBlock content="content" toolName="code_review" />);
    expect(screen.getByText('code_review')).toBeDefined();
  });

  it('does not show tool name span when not provided', () => {
    const { container } = render(<SubagentBlock content="content" />);
    // The header div should have only the "Subagent" label
    const headerSpans = container.querySelectorAll('.font-mono.text-muted-foreground');
    expect(headerSpans.length).toBe(0);
  });

  it('shows truncated subagentId (first 8 chars)', () => {
    const fullId = 'abcdef1234567890abcdef';
    render(<SubagentBlock content="content" subagentId={fullId} />);
    expect(screen.getByText('abcdef12')).toBeDefined();
    expect(screen.queryByText(fullId)).toBeNull();
  });

  it('does not show subagentId when not provided', () => {
    render(<SubagentBlock content="content" />);
    // No font-mono spans with truncated id
    const { container } = render(<SubagentBlock content="content" />);
    const idSpans = container.querySelectorAll('.text-muted-foreground\\/60');
    expect(idSpans.length).toBe(0);
  });

  it('shows timestamp when provided', () => {
    render(<SubagentBlock content="content" timestamp="14:30:00" />);
    expect(screen.getByText('14:30:00')).toBeDefined();
  });

  it('does not show timestamp when not provided', () => {
    render(<SubagentBlock content="content" />);
    // Only the "Subagent" label should be in the header area
    expect(screen.queryByText(/\d{2}:\d{2}:\d{2}/)).toBeNull();
  });

  it('renders multiline content preserving whitespace', () => {
    const multiline = 'Line 1\nLine 2\nLine 3';
    const { container } = render(<SubagentBlock content={multiline} />);
    const contentDiv = container.querySelector('.whitespace-pre-wrap');
    expect(contentDiv?.textContent).toBe(multiline);
  });
});
