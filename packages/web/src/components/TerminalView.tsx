'use client';

import { ClipboardCopy, Terminal as TerminalIcon } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTerminalResize } from '@/hooks/use-terminal-resize';
import { TERMINAL_FONT_FAMILY, TERMINAL_THEME } from '@/lib/terminal-theme';
import { COPY_FEEDBACK_MS } from '@/lib/ui-constants';
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
        fontFamily: TERMINAL_FONT_FAMILY,
        theme: TERMINAL_THEME,
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

  // Shared resize handling
  useTerminalResize(fitAddonRef, containerRef);

  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    // Select all content in the terminal buffer
    terminal.selectAll();
    const text = terminal.getSelection();
    terminal.clearSelection();
    if (text) {
      void navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
      });
    }
  }, []);

  return (
    <section aria-label="Terminal output" className={cn('relative flex-1 min-h-0', className)}>
      <div ref={containerRef} className="absolute inset-0 bg-[#0a0a0a]" />
      {rawOutput.length > 0 && (
        <div className="absolute top-2 right-3 flex items-center gap-1.5 z-10">
          {isActive && (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              <span className="text-[9px] font-semibold text-green-500 mr-2">Live</span>
            </>
          )}
          <button
            type="button"
            onClick={handleCopy}
            className="px-1.5 py-0.5 text-[9px] font-medium text-zinc-400 bg-zinc-800/80 border border-zinc-700/50 rounded hover:bg-zinc-700/80 hover:text-zinc-200 transition-colors cursor-pointer"
            aria-label="Copy terminal output"
          >
            {copied ? (
              'Copied!'
            ) : (
              <span className="flex items-center gap-1">
                <ClipboardCopy size={10} />
                Copy
              </span>
            )}
          </button>
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
