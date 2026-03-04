'use client';

import type React from 'react';

type Props = {
  text: string;
  highlight: string;
  className?: string;
};

/**
 * Renders text with matching substrings highlighted in yellow.
 * Case-insensitive matching. Returns plain text if no highlight or no match.
 */
export function HighlightText({ text, highlight, className }: Props): React.JSX.Element {
  if (!highlight.trim()) {
    return <span className={className}>{text}</span>;
  }

  const regex = new RegExp(`(${escapeRegExp(highlight)})`, 'gi');
  const parts = text.split(regex);

  return (
    <span className={className}>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={`hl-${String(i)}`} className="bg-yellow-500/30 text-inherit rounded-sm px-px">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </span>
  );
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
