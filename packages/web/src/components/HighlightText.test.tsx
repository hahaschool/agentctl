import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HighlightText } from './HighlightText';

// ===========================================================================
// HighlightText
// ===========================================================================
describe('HighlightText', () => {
  // -------------------------------------------------------------------------
  // Basic rendering
  // -------------------------------------------------------------------------
  it('renders the full text', () => {
    render(<HighlightText text="Hello world" highlight="world" />);
    expect(screen.getByText(/Hello/)).toBeDefined();
  });

  it('renders text in a span element', () => {
    const { container } = render(
      <HighlightText text="Some text" highlight="" />,
    );
    const outer = container.firstElementChild;
    expect(outer?.tagName).toBe('SPAN');
  });

  // -------------------------------------------------------------------------
  // No highlight (empty/whitespace query)
  // -------------------------------------------------------------------------
  it('returns plain text when highlight is empty', () => {
    const { container } = render(
      <HighlightText text="Plain text" highlight="" />,
    );
    expect(container.textContent).toBe('Plain text');
    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBe(0);
  });

  it('returns plain text when highlight is only whitespace', () => {
    const { container } = render(
      <HighlightText text="Plain text" highlight="   " />,
    );
    expect(container.textContent).toBe('Plain text');
    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // No match
  // -------------------------------------------------------------------------
  it('renders text without highlights when query does not match', () => {
    const { container } = render(
      <HighlightText text="Hello world" highlight="xyz" />,
    );
    expect(container.textContent).toBe('Hello world');
    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Single match
  // -------------------------------------------------------------------------
  it('wraps a matching substring in a <mark> element', () => {
    const { container } = render(
      <HighlightText text="Hello world" highlight="world" />,
    );
    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBe(1);
    expect(marks[0]!.textContent).toBe('world');
  });

  it('preserves non-matching text around the highlight', () => {
    const { container } = render(
      <HighlightText text="Hello world" highlight="world" />,
    );
    expect(container.textContent).toBe('Hello world');
  });

  // -------------------------------------------------------------------------
  // Multiple matches
  // -------------------------------------------------------------------------
  it('highlights all occurrences of the query', () => {
    const { container } = render(
      <HighlightText text="foo bar foo baz foo" highlight="foo" />,
    );
    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBe(3);
    for (const mark of marks) {
      expect(mark.textContent).toBe('foo');
    }
  });

  // -------------------------------------------------------------------------
  // Case insensitivity
  // -------------------------------------------------------------------------
  it('matches case-insensitively', () => {
    const { container } = render(
      <HighlightText text="Hello HELLO hello" highlight="hello" />,
    );
    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBe(3);
  });

  it('preserves original casing in highlighted text', () => {
    const { container } = render(
      <HighlightText text="Hello HELLO" highlight="hello" />,
    );
    const marks = container.querySelectorAll('mark');
    expect(marks[0]!.textContent).toBe('Hello');
    expect(marks[1]!.textContent).toBe('HELLO');
  });

  // -------------------------------------------------------------------------
  // Special regex characters in search query
  // -------------------------------------------------------------------------
  it('handles regex special characters in the query (dot)', () => {
    const { container } = render(
      <HighlightText text="file.txt and filetxt" highlight="file.txt" />,
    );
    const marks = container.querySelectorAll('mark');
    // Should match only the literal "file.txt", not "filetxt"
    expect(marks.length).toBe(1);
    expect(marks[0]!.textContent).toBe('file.txt');
  });

  it('handles regex special characters in the query (parentheses)', () => {
    const { container } = render(
      <HighlightText text="call fn() now" highlight="fn()" />,
    );
    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBe(1);
    expect(marks[0]!.textContent).toBe('fn()');
  });

  it('handles regex special characters in the query (brackets)', () => {
    const { container } = render(
      <HighlightText text="array[0] is first" highlight="[0]" />,
    );
    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBe(1);
    expect(marks[0]!.textContent).toBe('[0]');
  });

  it('handles asterisk in query', () => {
    const { container } = render(
      <HighlightText text="a * b = c" highlight="*" />,
    );
    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBe(1);
    expect(marks[0]!.textContent).toBe('*');
  });

  it('handles plus sign in query', () => {
    const { container } = render(
      <HighlightText text="a + b = c" highlight="+" />,
    );
    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBe(1);
    expect(marks[0]!.textContent).toBe('+');
  });

  // -------------------------------------------------------------------------
  // className prop
  // -------------------------------------------------------------------------
  it('applies className to the outer span', () => {
    const { container } = render(
      <HighlightText text="styled" highlight="" className="text-sm" />,
    );
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.className).toContain('text-sm');
  });

  it('applies className when highlights are present', () => {
    const { container } = render(
      <HighlightText text="styled match" highlight="match" className="font-bold" />,
    );
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.className).toContain('font-bold');
  });

  // -------------------------------------------------------------------------
  // Mark styling
  // -------------------------------------------------------------------------
  it('applies highlight styling classes to <mark> elements', () => {
    const { container } = render(
      <HighlightText text="Find me" highlight="me" />,
    );
    const mark = container.querySelector('mark');
    expect(mark).not.toBeNull();
    expect(mark?.className).toContain('bg-yellow-500/30');
    expect(mark?.className).toContain('text-inherit');
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------
  it('highlights the entire text when query matches the full string', () => {
    const { container } = render(
      <HighlightText text="exact" highlight="exact" />,
    );
    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBe(1);
    expect(marks[0]!.textContent).toBe('exact');
    expect(container.textContent).toBe('exact');
  });

  it('highlights single character matches', () => {
    const { container } = render(
      <HighlightText text="abcabc" highlight="a" />,
    );
    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBe(2);
  });
});
