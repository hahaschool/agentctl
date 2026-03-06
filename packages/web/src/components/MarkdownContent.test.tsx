import { render, screen } from '@testing-library/react';

import { MarkdownContent } from './MarkdownContent';

describe('MarkdownContent', () => {
  it('renders basic text content', () => {
    render(<MarkdownContent>Hello world</MarkdownContent>);
    expect(screen.getByText('Hello world')).toBeDefined();
  });

  it('renders h1 with proper classes', () => {
    const { container } = render(<MarkdownContent># Heading 1</MarkdownContent>);
    const h1 = container.querySelector('h1');
    expect(h1).toBeDefined();
    expect(h1?.textContent).toBe('Heading 1');
    expect(h1?.className).toContain('text-sm');
    expect(h1?.className).toContain('font-bold');
  });

  it('renders h2 with proper classes', () => {
    const { container } = render(<MarkdownContent>## Heading 2</MarkdownContent>);
    const h2 = container.querySelector('h2');
    expect(h2).toBeDefined();
    expect(h2?.textContent).toBe('Heading 2');
    expect(h2?.className).toContain('text-[13px]');
    expect(h2?.className).toContain('font-bold');
  });

  it('renders h3 with proper classes', () => {
    const { container } = render(<MarkdownContent>### Heading 3</MarkdownContent>);
    const h3 = container.querySelector('h3');
    expect(h3).toBeDefined();
    expect(h3?.textContent).toBe('Heading 3');
    expect(h3?.className).toContain('text-xs');
    expect(h3?.className).toContain('font-bold');
  });

  it('renders h4 with proper classes', () => {
    const { container } = render(<MarkdownContent>#### Heading 4</MarkdownContent>);
    const h4 = container.querySelector('h4');
    expect(h4).toBeDefined();
    expect(h4?.textContent).toBe('Heading 4');
    expect(h4?.className).toContain('text-xs');
    expect(h4?.className).toContain('font-semibold');
  });

  it('renders links with target="_blank" and rel="noopener noreferrer"', () => {
    render(<MarkdownContent>[Click here](https://example.com)</MarkdownContent>);
    const link = screen.getByRole('link', { name: /Click here/i });
    expect(link).toBeDefined();
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('href')).toBe('https://example.com');
  });

  it('shows URL inline when link text differs from href', () => {
    const { container } = render(
      <MarkdownContent>[Click here](https://example.com)</MarkdownContent>,
    );
    // The URL should appear in a span after the link text
    const urlSpan = container.querySelector('a span');
    expect(urlSpan).toBeDefined();
    expect(urlSpan?.textContent).toContain('https://example.com');
  });

  it('does not show inline URL when link text matches href', () => {
    const { container } = render(
      <MarkdownContent>[https://example.com](https://example.com)</MarkdownContent>,
    );
    const urlSpan = container.querySelector('a span');
    expect(urlSpan).toBeNull();
  });

  it('renders unordered lists with proper classes', () => {
    const { container } = render(
      <MarkdownContent>{'- Item A\n- Item B\n- Item C'}</MarkdownContent>,
    );
    const ul = container.querySelector('ul');
    expect(ul).toBeDefined();
    expect(ul?.className).toContain('list-disc');
    expect(ul?.className).toContain('pl-4');
    expect(screen.getByText('Item A')).toBeDefined();
    expect(screen.getByText('Item B')).toBeDefined();
    expect(screen.getByText('Item C')).toBeDefined();
  });

  it('renders ordered lists with proper classes', () => {
    const { container } = render(
      <MarkdownContent>{'1. First\n2. Second\n3. Third'}</MarkdownContent>,
    );
    const ol = container.querySelector('ol');
    expect(ol).toBeDefined();
    expect(ol?.className).toContain('list-decimal');
    expect(ol?.className).toContain('pl-4');
    expect(screen.getByText('First')).toBeDefined();
    expect(screen.getByText('Second')).toBeDefined();
  });

  it('renders inline code with proper styling classes', () => {
    const { container } = render(<MarkdownContent>Use the `console.log` function</MarkdownContent>);
    const code = container.querySelector('code');
    expect(code).toBeDefined();
    expect(code?.textContent).toBe('console.log');
    expect(code?.className).toContain('font-mono');
    expect(code?.className).toContain('bg-muted');
    expect(code?.className).toContain('text-[11px]');
  });

  it('renders fenced code blocks with proper styling', () => {
    const { container } = render(<MarkdownContent>{'```js\nconst x = 1;\n```'}</MarkdownContent>);
    const pre = container.querySelector('pre');
    expect(pre).toBeDefined();
    const code = pre?.querySelector('code');
    expect(code).toBeDefined();
    expect(code?.className).toContain('block');
    expect(code?.className).toContain('font-mono');
    expect(code?.className).toContain('overflow-x-auto');
    expect(code?.textContent).toContain('const x = 1;');
  });

  it('renders tables with proper structure', () => {
    const md = '| Name | Age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |';
    const { container } = render(<MarkdownContent>{md}</MarkdownContent>);
    const table = container.querySelector('table');
    expect(table).toBeDefined();
    expect(table?.className).toContain('border-collapse');

    const ths = container.querySelectorAll('th');
    expect(ths.length).toBe(2);
    expect(ths[0]?.textContent).toBe('Name');
    expect(ths[1]?.textContent).toBe('Age');
    expect(ths[0]?.className).toContain('font-semibold');

    const tds = container.querySelectorAll('td');
    expect(tds.length).toBe(4);
    expect(tds[0]?.textContent).toBe('Alice');
    expect(tds[0]?.className).toContain('border');
  });

  it('renders bold text', () => {
    const { container } = render(<MarkdownContent>This is **bold** text</MarkdownContent>);
    const strong = container.querySelector('strong');
    expect(strong).toBeDefined();
    expect(strong?.textContent).toBe('bold');
    expect(strong?.className).toContain('font-bold');
  });

  it('renders italic text', () => {
    const { container } = render(<MarkdownContent>This is *italic* text</MarkdownContent>);
    const em = container.querySelector('em');
    expect(em).toBeDefined();
    expect(em?.textContent).toBe('italic');
    expect(em?.className).toContain('italic');
  });

  it('renders strikethrough text', () => {
    const { container } = render(<MarkdownContent>This is ~~deleted~~ text</MarkdownContent>);
    const del = container.querySelector('del');
    expect(del).toBeDefined();
    expect(del?.textContent).toBe('deleted');
    expect(del?.className).toContain('line-through');
    expect(del?.className).toContain('opacity-60');
  });

  it('renders blockquotes', () => {
    const { container } = render(<MarkdownContent>{'> A wise quote'}</MarkdownContent>);
    const bq = container.querySelector('blockquote');
    expect(bq).toBeDefined();
    expect(bq?.className).toContain('border-l-2');
    expect(bq?.className).toContain('italic');
    expect(bq?.textContent).toContain('A wise quote');
  });

  it('renders task lists with checkboxes', () => {
    const md = '- [x] Done task\n- [ ] Pending task';
    const { container } = render(<MarkdownContent>{md}</MarkdownContent>);
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBe(2);
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(true);
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(false);
    // Checkboxes should be readOnly
    expect((checkboxes[0] as HTMLInputElement).readOnly).toBe(true);
  });

  it('handles empty string content', () => {
    const { container } = render(<MarkdownContent>{''}</MarkdownContent>);
    const wrapper = container.querySelector('.markdown-content');
    expect(wrapper).toBeDefined();
    // No paragraph or other block elements should be rendered
    expect(container.querySelector('p')).toBeNull();
  });

  it('applies custom className prop', () => {
    const { container } = render(
      <MarkdownContent className="custom-class">Some text</MarkdownContent>,
    );
    const wrapper = container.querySelector('.markdown-content');
    expect(wrapper).toBeDefined();
    expect(wrapper?.className).toContain('markdown-content');
    expect(wrapper?.className).toContain('custom-class');
  });

  it('renders horizontal rules', () => {
    const { container } = render(<MarkdownContent>{'Above\n\n---\n\nBelow'}</MarkdownContent>);
    const hr = container.querySelector('hr');
    expect(hr).toBeDefined();
    expect(hr?.className).toContain('border-border');
  });
});
