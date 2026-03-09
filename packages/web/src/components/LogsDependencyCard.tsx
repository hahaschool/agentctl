'use client';

import type React from 'react';
import { useState } from 'react';

import { cn } from '@/lib/utils';

import { StatusBadge } from './StatusBadge';

export type DependencyInfo = {
  status: 'ok' | 'error';
  latencyMs: number;
  error?: string;
};

export type LogsDependencyCardProps = {
  name: string;
  dep: DependencyInfo;
};

export function LogsDependencyCard({ name, dep }: LogsDependencyCardProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const latencyWarning = dep.latencyMs > 500;
  const latencyCritical = dep.latencyMs > 2000;

  return (
    <div
      className={cn(
        'px-3.5 py-3 bg-card border rounded transition-colors',
        'hover:border-border',
        dep.status === 'error'
          ? 'border-red-500/40'
          : latencyCritical
            ? 'border-yellow-500/40'
            : 'border-border/50',
      )}
    >
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-[13px] font-medium capitalize">{name}</span>
        <StatusBadge status={dep.status} />
      </div>
      <div
        className={cn(
          'text-[11px] font-mono',
          latencyCritical
            ? 'text-red-500'
            : latencyWarning
              ? 'text-yellow-500'
              : 'text-muted-foreground',
        )}
      >
        Latency: {dep.latencyMs?.toFixed(0) ?? '-'}ms
        {latencyWarning && !latencyCritical && ' (slow)'}
        {latencyCritical && ' (critical)'}
      </div>
      {dep.error && (
        <>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            className="text-[11px] text-red-500 mt-1 cursor-pointer hover:underline focus-visible:outline-none focus-visible:underline bg-transparent border-none p-0 text-left"
          >
            {expanded ? 'Hide error' : 'Show error'}
          </button>
          {expanded && (
            <div className="text-[11px] text-red-500 mt-1 break-all bg-red-500/5 rounded px-2 py-1.5 font-mono">
              {dep.error}
            </div>
          )}
        </>
      )}
    </div>
  );
}
