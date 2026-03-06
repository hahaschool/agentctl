'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

type MarkdownContentProps = {
  children: string;
  className?: string;
};

/**
 * Renders markdown content with clickable links, GFM support (tables, strikethrough,
 * task lists), and styling that blends with the session message UI.
 *
 * For tool output / code blocks we keep monospace. For assistant messages we render
 * full markdown with styled headings, lists, links, etc.
 */
export function MarkdownContent({ children, className }: MarkdownContentProps): React.JSX.Element {
  return (
    <div className={cn('markdown-content', className)}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children: linkChildren }) => {
          // Show URL inline when link text differs from the href
          const linkText = String(linkChildren ?? '');
          const isUrlVisible = href && (linkText === href || linkText === href.replace(/^https?:\/\//, ''));
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              title={href}
              className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 underline underline-offset-2 break-all"
            >
              {linkChildren}
              {!isUrlVisible && href && (
                <span className="text-[10px] text-blue-600/60 dark:text-blue-400/60 ml-1 no-underline">({href})</span>
              )}
            </a>
          );
        },
        p: ({ children: pChildren }) => <p className="mb-1.5 last:mb-0">{pChildren}</p>,
        h1: ({ children: h }) => <h1 className="text-sm font-bold mt-3 mb-1.5">{h}</h1>,
        h2: ({ children: h }) => <h2 className="text-[13px] font-bold mt-2.5 mb-1">{h}</h2>,
        h3: ({ children: h }) => <h3 className="text-xs font-bold mt-2 mb-1">{h}</h3>,
        h4: ({ children: h }) => <h4 className="text-xs font-semibold mt-1.5 mb-0.5">{h}</h4>,
        ul: ({ children: items }) => <ul className="list-disc pl-4 mb-1.5 space-y-0.5">{items}</ul>,
        ol: ({ children: items }) => <ol className="list-decimal pl-4 mb-1.5 space-y-0.5">{items}</ol>,
        li: ({ children: item }) => <li className="text-xs">{item}</li>,
        hr: () => <hr className="border-border my-2" />,
        blockquote: ({ children: bq }) => (
          <blockquote className="border-l-2 border-muted-foreground/30 pl-2.5 my-1.5 text-muted-foreground italic">
            {bq}
          </blockquote>
        ),
        code: ({ className: codeClass, children: codeChildren, ...props }) => {
          const isInline = !codeClass;
          if (isInline) {
            return (
              <code className="px-1 py-0.5 bg-muted rounded text-[11px] font-mono text-orange-600 dark:text-orange-300/90">
                {codeChildren}
              </code>
            );
          }
          return (
            <code className={cn('block bg-muted/50 rounded-md px-2.5 py-2 text-[11px] font-mono overflow-x-auto my-1.5', codeClass)} {...props}>
              {codeChildren}
            </code>
          );
        },
        pre: ({ children: preChildren }) => <pre className="my-1.5">{preChildren}</pre>,
        table: ({ children: tChildren }) => (
          <div className="overflow-x-auto my-1.5">
            <table className="text-[11px] border-collapse w-full">{tChildren}</table>
          </div>
        ),
        th: ({ children: thChildren }) => (
          <th className="border border-border px-2 py-1 text-left font-semibold bg-muted/50">{thChildren}</th>
        ),
        td: ({ children: tdChildren }) => (
          <td className="border border-border px-2 py-1">{tdChildren}</td>
        ),
        strong: ({ children: s }) => <strong className="font-bold">{s}</strong>,
        em: ({ children: e }) => <em className="italic">{e}</em>,
        del: ({ children: d }) => <del className="line-through opacity-60">{d}</del>,
        input: ({ checked, ...props }) => (
          <input
            type="checkbox"
            checked={checked}
            readOnly
            className="mr-1.5 align-middle"
            {...props}
          />
        ),
      }}
    >
      {children}
    </ReactMarkdown>
    </div>
  );
}
