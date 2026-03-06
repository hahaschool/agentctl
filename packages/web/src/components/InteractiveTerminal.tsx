'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import '@xterm/xterm/css/xterm.css';

// Dynamic import for xterm — it accesses DOM globals and cannot be imported at SSR time.
// We lazy-load both Terminal and FitAddon inside useEffect.

type InteractiveTerminalProps = {
  /** Machine ID to connect to. */
  machineId: string;
  /** Terminal session ID (from spawn). */
  terminalId: string;
  /** Called when the terminal process exits. */
  onExit?: (code: number) => void;
  /** Called on connection error. */
  onError?: (message: string) => void;
  /** CSS class for the outer wrapper. */
  className?: string;
};

export function InteractiveTerminal({
  machineId,
  terminalId,
  onExit,
  onError,
  className,
}: InteractiveTerminalProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<import('@xterm/xterm').Terminal | null>(null);
  const fitAddonRef = useRef<import('@xterm/addon-fit').FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  // Store callbacks in refs so the effect always uses the latest version
  // without re-triggering.
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

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
        cursorBlink: true,
        disableStdin: false,
        convertEol: true,
        scrollback: 10_000,
        fontSize: 13,
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

      // Connect WebSocket — in dev, Next.js rewrites do not cover WebSocket
      // so connect directly to the control plane backend like use-websocket.ts.
      let wsUrl: string;
      if (process.env.NODE_ENV === 'development') {
        wsUrl = `ws://localhost:8080/api/machines/${encodeURIComponent(machineId)}/terminal/${encodeURIComponent(terminalId)}/ws`;
      } else {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        wsUrl = `${protocol}//${window.location.host}/api/machines/${encodeURIComponent(machineId)}/terminal/${encodeURIComponent(terminalId)}/ws`;
      }

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) return;
        setConnected(true);
        terminal.focus();
        // Send initial size
        ws.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
      };

      ws.onmessage = (event) => {
        if (disposed) return;
        try {
          const msg = JSON.parse(event.data as string) as {
            type: string;
            data?: string;
            code?: number;
            message?: string;
          };
          if (msg.type === 'output' && msg.data) {
            terminal.write(msg.data);
          } else if (msg.type === 'exit') {
            terminal.write(
              `\r\n\x1b[33m[Process exited with code ${String(msg.code ?? 0)}]\x1b[0m\r\n`,
            );
            onExitRef.current?.(msg.code ?? 0);
          } else if (msg.type === 'error') {
            terminal.write(
              `\r\n\x1b[31m[Error: ${msg.message ?? 'Unknown error'}]\x1b[0m\r\n`,
            );
            onErrorRef.current?.(msg.message ?? 'Unknown error');
          }
        } catch {
          /* ignore parse errors */
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        setConnected(false);
        terminal.write('\r\n\x1b[33m[Connection closed]\x1b[0m\r\n');
      };

      ws.onerror = () => {
        if (disposed) return;
        onErrorRef.current?.('WebSocket connection failed');
      };

      // Send keyboard input to WebSocket
      terminal.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data }));
        }
      });

      // Send resize events
      terminal.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols, rows }));
        }
      });
    })();

    return () => {
      disposed = true;
      wsRef.current?.close();
      wsRef.current = null;
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [machineId, terminalId]);

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
    <div className={cn('relative flex-1 min-h-0', className)}>
      <div ref={containerRef} className="absolute inset-0 bg-[#0a0a0a]" />
      <div className="absolute top-2 right-3 flex items-center gap-1.5 z-10">
        <span
          className={cn('w-1.5 h-1.5 rounded-full', connected ? 'bg-green-500' : 'bg-red-500')}
        />
        <span
          className={cn(
            'text-[9px] font-semibold',
            connected ? 'text-green-500' : 'text-red-500',
          )}
        >
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>
    </div>
  );
}
