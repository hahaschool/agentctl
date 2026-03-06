import { fireEvent, render, screen } from '@testing-library/react';

import { ThinkingBlock } from './ThinkingBlock';

describe('ThinkingBlock', () => {
  describe('collapsed state (default)', () => {
    it('renders collapsed by default with first line preview', () => {
      render(<ThinkingBlock content={'First line of thought\nSecond line'} />);
      expect(screen.getByText('First line of thought')).toBeDefined();
      expect(screen.queryByText('Second line')).toBeNull();
    });

    it('shows "click to expand" hint', () => {
      render(<ThinkingBlock content="Some thinking content" />);
      expect(screen.getByText('click to expand')).toBeDefined();
    });

    it('shows "Thinking" label', () => {
      render(<ThinkingBlock content="Some content" />);
      expect(screen.getByText('Thinking')).toBeDefined();
    });

    it('renders as an interactive button element', () => {
      render(<ThinkingBlock content="content" />);
      const btn = screen.getByRole('button');
      expect(btn).toBeDefined();
      expect(btn.tagName).toBe('BUTTON');
    });

    it('truncates first line preview to 120 characters', () => {
      const longLine = 'A'.repeat(200);
      render(<ThinkingBlock content={longLine} />);
      const preview = screen.getByText('A'.repeat(120));
      expect(preview).toBeDefined();
    });

    it('shows full first line when under 120 characters', () => {
      render(<ThinkingBlock content="Short thinking line" />);
      expect(screen.getByText('Short thinking line')).toBeDefined();
    });

    it('does not show the "collapse" button', () => {
      render(<ThinkingBlock content="content" />);
      expect(screen.queryByText('collapse')).toBeNull();
    });

    it('does not show the timestamp even if provided', () => {
      render(<ThinkingBlock content="content" timestamp="12:00:00" />);
      expect(screen.queryByText('12:00:00')).toBeNull();
    });

    it('handles empty content gracefully', () => {
      const { container } = render(<ThinkingBlock content="" />);
      expect(container.firstChild).toBeDefined();
      expect(screen.getByText('Thinking')).toBeDefined();
    });

    it('handles content with only newlines', () => {
      render(<ThinkingBlock content={'\n\n\n'} />);
      expect(screen.getByText('Thinking')).toBeDefined();
      expect(screen.getByText('click to expand')).toBeDefined();
    });
  });

  describe('expand/collapse behavior', () => {
    it('expands on click showing full content', () => {
      const { container } = render(
        <ThinkingBlock content={'First line\nSecond line\nThird line'} />,
      );
      fireEvent.click(screen.getByRole('button'));
      const contentDiv = container.querySelector('.whitespace-pre-wrap');
      expect(contentDiv!.textContent).toBe('First line\nSecond line\nThird line');
      expect(screen.queryByText('click to expand')).toBeNull();
      expect(screen.getByText('collapse')).toBeDefined();
    });

    it('collapses again when collapse button is clicked', () => {
      render(<ThinkingBlock content={'Line 1\nLine 2'} />);
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByText('collapse')).toBeDefined();
      fireEvent.click(screen.getByText('collapse'));
      expect(screen.getByText('click to expand')).toBeDefined();
      expect(screen.queryByText('collapse')).toBeNull();
    });

    it('can expand and collapse multiple times', () => {
      render(<ThinkingBlock content={'Line A\nLine B'} />);
      // Cycle 1
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByText('collapse')).toBeDefined();
      fireEvent.click(screen.getByText('collapse'));
      expect(screen.getByText('click to expand')).toBeDefined();
      // Cycle 2
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByText('collapse')).toBeDefined();
      fireEvent.click(screen.getByText('collapse'));
      expect(screen.getByText('click to expand')).toBeDefined();
    });
  });

  describe('expanded state', () => {
    it('shows "Thinking" label when expanded', () => {
      render(<ThinkingBlock content="content" />);
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByText('Thinking')).toBeDefined();
    });

    it('shows timestamp when expanded and provided', () => {
      render(<ThinkingBlock content="Thinking..." timestamp="12:34:56" />);
      fireEvent.click(screen.getByRole('button'));
      expect(screen.getByText('12:34:56')).toBeDefined();
    });

    it('does not show timestamp element when not provided', () => {
      render(<ThinkingBlock content="content" />);
      fireEvent.click(screen.getByRole('button'));
      expect(screen.queryByText(/\d{2}:\d{2}:\d{2}/)).toBeNull();
    });

    it('renders full multiline content in pre-wrap div', () => {
      const multiline = 'First\nSecond\nThird\nFourth';
      const { container } = render(<ThinkingBlock content={multiline} />);
      fireEvent.click(screen.getByRole('button'));
      const contentDiv = container.querySelector('.whitespace-pre-wrap');
      expect(contentDiv!.textContent).toBe(multiline);
    });

    it('renders content in a monospace font container', () => {
      const { container } = render(<ThinkingBlock content="mono content" />);
      fireEvent.click(screen.getByRole('button'));
      const monoDiv = container.querySelector('.font-mono');
      expect(monoDiv).not.toBeNull();
      expect(monoDiv!.textContent).toBe('mono content');
    });

    it('has a max-height with overflow scroll for long content', () => {
      const { container } = render(<ThinkingBlock content="Long content" />);
      fireEvent.click(screen.getByRole('button'));
      const scrollDiv = container.querySelector('.max-h-\\[300px\\]');
      expect(scrollDiv).not.toBeNull();
      const overflowDiv = container.querySelector('.overflow-auto');
      expect(overflowDiv).not.toBeNull();
    });
  });
});
