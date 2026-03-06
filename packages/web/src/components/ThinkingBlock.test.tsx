import { fireEvent, render, screen } from '@testing-library/react';

import { ThinkingBlock } from './ThinkingBlock';

describe('ThinkingBlock', () => {
  it('renders collapsed by default with first line preview', () => {
    render(<ThinkingBlock content={'First line of thought\nSecond line'} />);
    expect(screen.getByText('First line of thought')).toBeDefined();
    expect(screen.queryByText('Second line')).toBeNull();
  });

  it('shows "click to expand" text when collapsed', () => {
    render(<ThinkingBlock content="Some thinking content" />);
    expect(screen.getByText('click to expand')).toBeDefined();
  });

  it('shows "Thinking" label when collapsed', () => {
    render(<ThinkingBlock content="Some content" />);
    expect(screen.getByText('Thinking')).toBeDefined();
  });

  it('expands on click showing full content', () => {
    const { container } = render(<ThinkingBlock content={'First line\nSecond line\nThird line'} />);
    // Click the collapsed button to expand
    fireEvent.click(screen.getByRole('button'));
    // Full content should now be visible in the pre-wrap div
    const contentDiv = container.querySelector('.whitespace-pre-wrap');
    expect(contentDiv?.textContent).toBe('First line\nSecond line\nThird line');
    // "click to expand" should be gone
    expect(screen.queryByText('click to expand')).toBeNull();
    // "collapse" button should appear
    expect(screen.getByText('collapse')).toBeDefined();
  });

  it('collapses again when collapse button is clicked', () => {
    render(<ThinkingBlock content={'Line 1\nLine 2'} />);
    // Expand
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('collapse')).toBeDefined();
    // Collapse
    fireEvent.click(screen.getByText('collapse'));
    // Should be back to collapsed state
    expect(screen.getByText('click to expand')).toBeDefined();
    expect(screen.queryByText('collapse')).toBeNull();
  });

  it('handles empty content gracefully', () => {
    const { container } = render(<ThinkingBlock content="" />);
    expect(container.firstChild).toBeDefined();
    expect(screen.getByText('Thinking')).toBeDefined();
  });

  it('truncates first line preview to 120 characters', () => {
    const longLine = 'A'.repeat(200);
    render(<ThinkingBlock content={longLine} />);
    const preview = screen.getByText('A'.repeat(120));
    expect(preview).toBeDefined();
  });

  it('shows timestamp when expanded', () => {
    render(<ThinkingBlock content="Thinking..." timestamp="12:34:56" />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('12:34:56')).toBeDefined();
  });
});
