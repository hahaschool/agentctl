'use client';

import type React from 'react';
import { useEffect, useRef } from 'react';

import { SHORTCUT_GROUPS } from '@/lib/keyboard-shortcuts';
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
          'relative bg-card border border-border rounded-lg shadow-xl p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto',
          'animate-fade-in',
        )}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-[15px] font-semibold mb-5">Keyboard Shortcuts</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">
                {group.title}
              </h3>
              <div className="space-y-1.5">
                {group.shortcuts.map((s) => (
                  <div key={s.desc} className="flex justify-between items-center gap-3">
                    <span className="text-[13px] text-muted-foreground">{s.desc}</span>
                    <div className="flex gap-1 shrink-0">
                      {s.keys.map((k, i) => (
                        <kbd
                          key={`${k}-${i}`}
                          className="inline-block px-2 py-0.5 text-[11px] font-mono bg-muted border border-border rounded-sm min-w-[24px] text-center"
                        >
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-muted-foreground mt-5">
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
