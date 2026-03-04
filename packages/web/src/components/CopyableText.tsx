'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

type Props = {
  value: string;
  maxDisplay?: number;
  label?: string;
  className?: string;
};

export function CopyableText({
  value,
  maxDisplay = 8,
  label,
  className,
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

  const display = label ?? (value && value.length > maxDisplay ? value.slice(0, maxDisplay) : value ?? '');

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? 'Copied!' : `Click to copy: ${value}`}
      className={cn(
        'inline-flex items-center gap-1 rounded-sm px-1 py-0.5',
        'font-mono text-[11px] whitespace-nowrap shrink-0 cursor-pointer',
        'transition-colors duration-200',
        copied
          ? 'text-green-500 bg-muted'
          : 'text-muted-foreground bg-transparent hover:bg-muted/50',
        className,
      )}
    >
      {copied ? 'Copied!' : display}
    </button>
  );
}
