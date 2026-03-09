import { render, screen } from '@testing-library/react';

import { SubagentBlock } from './SubagentBlock';

describe('SubagentBlock', () => {
  describe('basic rendering', () => {
    it('renders subagent content', () => {
      render(<SubagentBlock content="Subagent output here" />);
      expect(screen.getByText('Subagent output here')).toBeDefined();
    });

    it('shows "Subagent" label', () => {
      render(<SubagentBlock content="content" />);
      expect(screen.getByText('Subagent')).toBeDefined();
    });

    it('renders a GitBranch icon (SVG)', () => {
      const { container } = render(<SubagentBlock content="content" />);
      expect(container.querySelector('svg')).not.toBeNull();
    });

    it('renders empty content without crashing', () => {
      const { container } = render(<SubagentBlock content="" />);
      expect(container.firstChild).toBeDefined();
      expect(screen.getByText('Subagent')).toBeDefined();
    });
  });

  describe('toolName prop', () => {
    it('shows tool name when provided', () => {
      render(<SubagentBlock content="content" toolName="code_review" />);
      expect(screen.getByText('code_review')).toBeDefined();
    });

    it('does not render tool name span when not provided', () => {
      const { container } = render(<SubagentBlock content="content" />);
      const monoSpans = container.querySelectorAll(
        '.font-mono.text-muted-foreground:not(.text-muted-foreground\\/60)',
      );
      expect(monoSpans.length).toBe(0);
    });
  });

  describe('subagentId prop', () => {
    it('shows truncated subagentId (first 8 chars)', () => {
      const fullId = 'abcdef1234567890abcdef';
      render(<SubagentBlock content="content" subagentId={fullId} />);
      expect(screen.getByText('abcdef12')).toBeDefined();
      expect(screen.queryByText(fullId)).toBeNull();
    });

    it('handles subagentId shorter than 8 chars', () => {
      render(<SubagentBlock content="content" subagentId="abc" />);
      expect(screen.getByText('abc')).toBeDefined();
    });

    it('handles subagentId exactly 8 chars', () => {
      render(<SubagentBlock content="content" subagentId="12345678" />);
      expect(screen.getByText('12345678')).toBeDefined();
    });

    it('does not show subagentId when not provided', () => {
      const { container } = render(<SubagentBlock content="content" />);
      const idSpans = container.querySelectorAll('.text-muted-foreground\\/60');
      expect(idSpans.length).toBe(0);
    });
  });

  describe('timestamp prop', () => {
    it('shows timestamp when provided', () => {
      render(<SubagentBlock content="content" timestamp="14:30:00" />);
      expect(screen.getByText('14:30:00')).toBeDefined();
    });

    it('does not show timestamp when not provided', () => {
      render(<SubagentBlock content="content" />);
      expect(screen.queryByText(/\d{2}:\d{2}:\d{2}/)).toBeNull();
    });

    it('positions timestamp with ml-auto', () => {
      render(<SubagentBlock content="content" timestamp="09:15:00" />);
      const tsSpan = screen.getByText('09:15:00');
      expect(tsSpan.className).toContain('ml-auto');
    });
  });

  describe('content display', () => {
    it('renders multiline content preserving whitespace', () => {
      const multiline = 'Line 1\nLine 2\nLine 3';
      const { container } = render(<SubagentBlock content={multiline} />);
      const contentDiv = container.querySelector('.whitespace-pre-wrap');
      expect(contentDiv?.textContent).toBe(multiline);
    });

    it('has max-height with overflow for long content', () => {
      const { container } = render(<SubagentBlock content="Long content" />);
      const scrollDiv = container.querySelector('.max-h-\\[200px\\]');
      expect(scrollDiv).not.toBeNull();
    });
  });

  describe('all props combined', () => {
    it('renders all optional props together', () => {
      const { container } = render(
        <SubagentBlock
          content="Full output"
          toolName="write_file"
          subagentId="deadbeef99887766"
          timestamp="16:45:30"
        />,
      );
      expect(screen.getByText('Subagent')).toBeDefined();
      expect(screen.getByText('write_file')).toBeDefined();
      expect(screen.getByText('deadbeef')).toBeDefined();
      expect(screen.getByText('16:45:30')).toBeDefined();
      const contentDiv = container.querySelector('.whitespace-pre-wrap');
      expect(contentDiv?.textContent).toBe('Full output');
    });
  });
});
