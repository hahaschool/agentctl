import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

type Props = {
  /** Full text to copy to clipboard. */
  value: string;
  /** Max characters to display (rest is truncated). Defaults to 8. */
  maxDisplay?: number;
  /** Optional label shown instead of truncated value. */
  label?: string;
  /** Font size in pixels. Defaults to 11. */
  fontSize?: number;
};

/**
 * Inline button that copies text on click with brief "Copied!" feedback.
 */
export function CopyableText({
  value,
  maxDisplay = 8,
  label,
  fontSize = 11,
}: Props): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      void navigator.clipboard.writeText(value).then(() => {
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), 1500);
      });
    },
    [value],
  );

  const display = label ?? (value.length > maxDisplay ? value.slice(0, maxDisplay) : value);

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? 'Copied!' : `Click to copy: ${value}`}
      style={{
        fontSize,
        fontFamily: 'var(--font-mono)',
        color: copied ? 'var(--green)' : 'var(--text-muted)',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        cursor: 'pointer',
        padding: '1px 4px',
        borderRadius: 'var(--radius-sm)',
        transition: 'color 0.2s, background-color 0.2s',
        backgroundColor: copied ? 'var(--bg-tertiary)' : 'transparent',
        border: 'none',
        font: 'inherit',
        lineHeight: 'inherit',
      }}
    >
      {copied ? 'Copied!' : display}
    </button>
  );
}
