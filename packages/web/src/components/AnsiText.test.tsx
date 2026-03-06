import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock ansi-to-react — render children inside a span with data-testid so we
// can verify the raw text passed through, and capture what the component receives
// ---------------------------------------------------------------------------
const ansiCalls: string[] = [];
vi.mock('ansi-to-react', () => ({
  default: ({ children }: { children: string }) => {
    ansiCalls.push(children);
    return <span data-testid="ansi-output">{children}</span>;
  },
}));

import { AnsiSpan, AnsiText } from './AnsiText';

// Clear call tracking between tests
import { beforeEach } from 'vitest';
beforeEach(() => {
  ansiCalls.length = 0;
});

// ===========================================================================
// AnsiText (pre-based variant)
// ===========================================================================
describe('AnsiText', () => {
  it('renders plain text through the Ansi component', () => {
    render(<AnsiText>Hello world</AnsiText>);
    expect(screen.getByText('Hello world')).toBeDefined();
  });

  it('wraps content in a <pre> element', () => {
    const { container } = render(<AnsiText>test</AnsiText>);
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
  });

  it('passes children string to the Ansi component', () => {
    render(<AnsiText>Some ANSI text</AnsiText>);
    expect(ansiCalls).toContain('Some ANSI text');
  });

  it('renders the ansi-to-react output element', () => {
    render(<AnsiText>colored text</AnsiText>);
    expect(screen.getByTestId('ansi-output')).toBeDefined();
  });

  it('applies custom className to the pre wrapper', () => {
    const { container } = render(<AnsiText className="font-mono text-sm">code</AnsiText>);
    const pre = container.querySelector('pre');
    expect(pre?.className).toContain('font-mono');
    expect(pre?.className).toContain('text-sm');
  });

  it('renders without className prop', () => {
    const { container } = render(<AnsiText>no class</AnsiText>);
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
  });

  it('passes text containing ANSI escape sequences to the Ansi component', () => {
    const ansiString = '\u001b[31mred text\u001b[0m';
    render(<AnsiText>{ansiString}</AnsiText>);
    expect(ansiCalls).toContain(ansiString);
  });

  it('handles empty string', () => {
    const { container } = render(<AnsiText>{''}</AnsiText>);
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(screen.getByTestId('ansi-output').textContent).toBe('');
  });

  it('handles multi-line content', () => {
    const multiLine = 'line 1\nline 2\nline 3';
    render(<AnsiText>{multiLine}</AnsiText>);
    expect(screen.getByTestId('ansi-output').textContent).toBe(multiLine);
  });

  it('handles text with mixed ANSI codes', () => {
    const mixed = '\u001b[1mbold\u001b[0m normal \u001b[32mgreen\u001b[0m';
    render(<AnsiText>{mixed}</AnsiText>);
    expect(ansiCalls).toContain(mixed);
  });
});

// ===========================================================================
// AnsiSpan (inline variant)
// ===========================================================================
describe('AnsiSpan', () => {
  it('renders plain text through the Ansi component', () => {
    render(<AnsiSpan>inline text</AnsiSpan>);
    expect(screen.getByText('inline text')).toBeDefined();
  });

  it('wraps content in a <span> element, not <pre>', () => {
    const { container } = render(<AnsiSpan>test</AnsiSpan>);
    const pre = container.querySelector('pre');
    expect(pre).toBeNull();
    // The outermost element should be a span
    const outer = container.firstElementChild;
    expect(outer?.tagName).toBe('SPAN');
  });

  it('passes children to the Ansi component', () => {
    render(<AnsiSpan>span content</AnsiSpan>);
    expect(ansiCalls).toContain('span content');
  });

  it('applies custom className to the span wrapper', () => {
    const { container } = render(
      <AnsiSpan className="whitespace-pre-wrap">styled</AnsiSpan>,
    );
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.className).toContain('whitespace-pre-wrap');
  });

  it('renders the ansi-to-react output element', () => {
    render(<AnsiSpan>test</AnsiSpan>);
    expect(screen.getByTestId('ansi-output')).toBeDefined();
  });

  it('handles ANSI escape sequences', () => {
    const ansiStr = '\u001b[34mblue\u001b[0m';
    render(<AnsiSpan>{ansiStr}</AnsiSpan>);
    expect(ansiCalls).toContain(ansiStr);
  });

  it('handles empty string', () => {
    render(<AnsiSpan>{''}</AnsiSpan>);
    expect(screen.getByTestId('ansi-output').textContent).toBe('');
  });
});
