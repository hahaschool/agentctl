'use client';

import type React from 'react';
import { useCallback, useState } from 'react';
import { COPY_FEEDBACK_MS } from '@/lib/ui-constants';
import { cn } from '@/lib/utils';
import { useToast } from './Toast';

export function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  const handleCopy = useCallback(() => {
    if (!mono || value === '-') return;
    void navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
      })
      .catch(() => toast.error('Failed to copy'));
  }, [mono, value, toast]);

  return (
    <div className="group py-0.5">
      <span className="text-muted-foreground/70 text-[10px] font-medium">{label}</span>
      <div
        className={cn(
          'text-xs break-all flex items-start gap-1 mt-0.5 text-foreground/90',
          mono && 'font-mono',
        )}
      >
        <span className="flex-1">{value}</span>
        {mono && value !== '-' && (
          <button
            type="button"
            onClick={handleCopy}
            title={copied ? 'Copied!' : 'Copy to clipboard'}
            className={cn(
              'shrink-0 px-1 py-px text-[10px] border-0 rounded-md cursor-pointer transition-opacity duration-150',
              copied
                ? 'text-green-500 bg-muted opacity-100'
                : 'text-muted-foreground bg-transparent opacity-0 group-hover:opacity-70 hover:!opacity-100',
            )}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>
    </div>
  );
}
