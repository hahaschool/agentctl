'use client';

import Ansi from 'ansi-to-react';

type AnsiTextProps = {
  children: string;
  className?: string;
};

export function AnsiText({ children, className }: AnsiTextProps): React.JSX.Element {
  return (
    <pre className={className}>
      <Ansi>{children}</Ansi>
    </pre>
  );
}

/**
 * Inline variant that renders inside a <span> rather than <pre>.
 * Useful for message bubbles that already apply whitespace-pre-wrap via CSS.
 */
export function AnsiSpan({ children, className }: AnsiTextProps): React.JSX.Element {
  return (
    <span className={className}>
      <Ansi>{children}</Ansi>
    </span>
  );
}
