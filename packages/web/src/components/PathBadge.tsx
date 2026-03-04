'use client';

import type React from 'react';
import { useCallback } from 'react';

import { cn } from '@/lib/utils';
import { shortenPath } from '../lib/format-utils';
import { SimpleTooltip } from './SimpleTooltip';
import { useToast } from './Toast';

type Props = {
  path: string | null | undefined;
  /** Fallback text when path is empty */
  fallback?: string;
  className?: string;
};

/**
 * Displays a shortened path with tooltip showing the full path.
 * Click to copy the full path to clipboard.
 */
export function PathBadge({ path, fallback = '-', className }: Props): React.JSX.Element {
  const toast = useToast();
  const short = shortenPath(path);

  const handleCopy = useCallback(() => {
    if (!path) return;
    void navigator.clipboard.writeText(path).then(
      () => toast.success('Path copied'),
      () => toast.error('Failed to copy'),
    );
  }, [path, toast]);

  if (!path) {
    return <span className={cn('text-xs text-muted-foreground', className)}>{fallback}</span>;
  }

  return (
    <SimpleTooltip content={path}>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={`Copy path: ${path}`}
        className={cn(
          'font-mono text-xs text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap cursor-pointer bg-transparent border-none p-0 text-left hover:text-foreground transition-colors',
          className,
        )}
      >
        {short}
      </button>
    </SimpleTooltip>
  );
}
