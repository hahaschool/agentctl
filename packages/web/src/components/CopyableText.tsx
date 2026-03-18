'use client';

import { Check, Copy } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { COPY_FEEDBACK_MS } from '@/lib/ui-constants';
import { cn } from '@/lib/utils';
import { useToast } from './Toast';

type Props = {
  value: string;
  maxDisplay?: number;
  label?: string;
  className?: string;
  as?: 'button' | 'span';
};

function CopyableTextBase({
  value,
  maxDisplay = 8,
  label,
  className,
  as = 'button',
}: Props): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useToast();

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const copyValue = useCallback(() => {
    return navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    });
  }, [value]);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      void copyValue().catch(() => toast.error('Failed to copy'));
    },
    [copyValue, toast],
  );

  const handleSpanKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLSpanElement>) => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      void copyValue().catch(() => toast.error('Failed to copy'));
    },
    [copyValue, toast],
  );

  const display =
    label ?? (value && value.length > maxDisplay ? value.slice(0, maxDisplay) : (value ?? ''));
  const accessibleLabel = label ? `Copy ${label}` : `Copy value: ${value}`;

  const baseClassName = cn(
    'inline-flex items-center gap-1 rounded-md px-1 py-0.5',
    'font-mono text-[11px] whitespace-nowrap shrink-0 cursor-pointer',
    'transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    copied ? 'text-green-500 bg-muted' : 'text-muted-foreground bg-transparent hover:bg-muted/50',
    className,
  );

  const content = (
    <>
      {copied ? (
        <Check size={10} className="text-green-500" aria-hidden="true" />
      ) : (
        <Copy size={10} className="opacity-40" aria-hidden="true" />
      )}
      {copied ? 'Copied!' : display}
    </>
  );

  if (as === 'span') {
    return (
      // biome-ignore lint/a11y/useSemanticElements: span variant needed when nesting inside interactive elements where button would be invalid HTML
      <span
        role="button"
        tabIndex={0}
        aria-label={accessibleLabel}
        onClick={handleCopy}
        onKeyDown={handleSpanKeyDown}
        title={copied ? 'Copied!' : `Click to copy: ${value}`}
        className={baseClassName}
      >
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={accessibleLabel}
      title={copied ? 'Copied!' : `Click to copy: ${value}`}
      className={baseClassName}
    >
      {content}
    </button>
  );
}

export const CopyableText = React.memo(CopyableTextBase);
