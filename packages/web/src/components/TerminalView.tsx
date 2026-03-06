'use client';

import { Terminal as TerminalIcon } from 'lucide-react';
import React, { useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import '@xterm/xterm/css/xterm.css';

// Dynamic import for xterm — it accesses DOM globals and cannot be imported at SSR time.
// We lazy-load both Terminal and FitAddon inside useEffect.

type TerminalViewProps = {
  /** Raw output chunks to write into the terminal. */
  rawOutput: string[];
  /** Whether the session is actively streaming. */
  isActive?: boolean;
  /** CSS class for the outer wrapper. */
  className?: string;
};

export const TerminalView = React.memo(function TerminalView({
  rawOutput,
  isActive,
  className,
}: TerminalViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<import('@xterm/xterm').Terminal | null>(null);
  const fitAddonRef = useRef<import('@xterm/addon-fit').FitAddon | null>(null);
  const writtenCountRef = useRef(0);

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;

    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);

      if (disposed || !containerRef.current) return;

      const fitAddon = new FitAddon();
      const terminal = new Terminal({
        cursorBlink: false,
        disableStdin: true,
        convertEol: true,
        scrollback: 10_000,
        fontSize: 12,
        fontFamily: 'ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Code", Consolas, monospace',
        theme: {
          background: '#0a0a0a',
          foreground: '#e4e4e7',
          cursor: '#e4e4e7',
          selectionBackground: '#3f3f46',
          black: '#09090b',
          red: '#ef4444',
          green: '#22c55e',
          yellow: '#eab308',
          blue: '#3b82f6',
          magenta: '#a855f7',
          cyan: '#06b6d4',
          white: '#e4e4e7',
          brightBlack: '#52525b',
          brightRed: '#f87171',
          brightGreen: '#4ade80',
          brightYellow: '#facc15',
          brightBlue: '#60a5fa',
          brightMagenta: '#c084fc',
          brightCyan: '#22d3ee',
          brightWhite: '#fafafa',
        },
      });

      terminal.loadAddon(fitAddon);
      terminal.open(containerRef.current);
      fitAddon.fit();

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
      writtenCountRef.current = 0;
    })();

    return () => {
      disposed = true;
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      writtenCountRef.current = 0;
    };
  }, []);

  // Write new raw output chunks
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    const start = writtenCountRef.current;
    if (start < rawOutput.length) {
      for (let i = start; i < rawOutput.length; i++) {
        const chunk = rawOutput[i];
        if (chunk) terminal.write(chunk);
      }
      writtenCountRef.current = rawOutput.length;
    }
  }, [rawOutput]);

  // Handle resize
  const handleResize = useCallback(() => {
    try {
      fitAddonRef.current?.fit();
    } catch {
      // Terminal may not be ready yet
    }
  }, []);

  useEffect(() => {
    window.addEventListener('resize', handleResize);
    // Also fit when the component first gets rawOutput
    const timer = setTimeout(handleResize, 100);
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timer);
    };
  }, [handleResize]);

  // Re-fit when parent layout might change
  useEffect(() => {
    const observer = new ResizeObserver(() => handleResize());
    if (containerRef.current?.parentElement) {
      observer.observe(containerRef.current.parentElement);
    }
    return () => observer.disconnect();
  }, [handleResize]);

  return (
    <section aria-label="Terminal output" className={cn('relative flex-1 min-h-0', className)}>
      <div ref={containerRef} className="absolute inset-0 bg-[#0a0a0a]" />
      {isActive && rawOutput.length > 0 && (
        <div className="absolute top-2 right-3 flex items-center gap-1.5 z-10">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          <span className="text-[9px] font-semibold text-green-500">Live</span>
        </div>
      )}
      {rawOutput.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none gap-3">
          <TerminalIcon
            className={cn('w-8 h-8 text-zinc-600', isActive && 'animate-pulse')}
            aria-hidden="true"
          />
          <span className={cn('text-base text-zinc-500', isActive && 'animate-pulse')}>
            {isActive ? 'Waiting for terminal output...' : 'No terminal output'}
          </span>
        </div>
      )}
    </section>
  );
});
