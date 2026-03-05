'use client';

import type React from 'react';
import { useEffect, useRef } from 'react';

import { CONDENSED_SHORTCUTS } from '@/lib/keyboard-shortcuts';
import { cn } from '@/lib/utils';

type Props = {
  open: boolean;
  onClose: () => void;
};

export function KeyboardHelpOverlay({ open, onClose }: Props): React.JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
      aria-hidden="true"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Keyboard shortcuts"
        className={cn(
          'relative bg-card border border-border rounded-lg shadow-xl p-6 max-w-sm w-full mx-4',
          'animate-fade-in',
        )}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-[15px] font-semibold mb-4">Keyboard Shortcuts</h2>
        <div className="space-y-2">
          {CONDENSED_SHORTCUTS.map((s) => (
            <div key={s.desc} className="flex justify-between items-center">
              <span className="text-[13px] text-muted-foreground">{s.desc}</span>
              <div className="flex gap-1">
                {s.keys.map((k) => (
                  <kbd
                    key={k}
                    className="inline-block px-2 py-0.5 text-[11px] font-mono bg-muted border border-border rounded-sm min-w-[24px] text-center"
                  >
                    {k}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-4">
          Press{' '}
          <kbd className="px-1 py-0.5 text-[10px] font-mono bg-muted border border-border rounded-sm">
            ?
          </kbd>{' '}
          or{' '}
          <kbd className="px-1 py-0.5 text-[10px] font-mono bg-muted border border-border rounded-sm">
            Esc
          </kbd>{' '}
          to close
        </p>
      </div>
    </div>
  );
}
