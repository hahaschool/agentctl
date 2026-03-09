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
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md transition-opacity" />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Keyboard shortcuts"
        className={cn(
          'relative bg-card border border-border rounded-xl shadow-2xl',
          'max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto',
          'animate-fade-in',
        )}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-card border-b border-border px-6 py-4 rounded-t-xl">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">Keyboard Shortcuts</h2>
            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors text-sm"
              aria-label="Close"
            >
              <kbd className="bg-muted border border-border rounded px-1.5 py-0.5 font-mono text-[11px]">
                Esc
              </kbd>
            </button>
          </div>
        </div>

        {/* Shortcut groups */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-6 p-6">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3 pb-1.5 border-b border-border/50">
                {group.title}
              </h3>
              <div className="space-y-2">
                {group.shortcuts.map((s) => (
                  <div key={s.desc} className="flex justify-between items-center gap-4">
                    <span className="text-[13px] text-foreground/80">{s.desc}</span>
                    <div className="flex gap-1 shrink-0">
                      {s.keys.map((k) => (
                        <kbd
                          key={k}
                          className={cn(
                            'inline-flex items-center justify-center',
                            'bg-muted border border-border rounded px-1.5 py-0.5',
                            'font-mono text-[11px] text-foreground/70',
                            'min-w-[24px] text-center shadow-sm',
                          )}
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

        {/* Footer */}
        <div className="border-t border-border/50 px-6 py-3">
          <p className="text-[11px] text-muted-foreground">
            Press{' '}
            <kbd className="bg-muted border border-border rounded px-1.5 py-0.5 font-mono text-[10px]">
              ?
            </kbd>{' '}
            or{' '}
            <kbd className="bg-muted border border-border rounded px-1.5 py-0.5 font-mono text-[10px]">
              Esc
            </kbd>{' '}
            to close
          </p>
        </div>
      </div>
    </div>
  );
}
