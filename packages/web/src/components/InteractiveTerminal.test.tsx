import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the component under test
// ---------------------------------------------------------------------------

const mockWrite = vi.fn();
const mockOpen = vi.fn();
const mockLoadAddon = vi.fn();
const mockDispose = vi.fn();
const mockFocus = vi.fn();
const mockSelectAll = vi.fn();
const mockGetSelection = vi.fn().mockReturnValue('selected text');
const mockClearSelection = vi.fn();

let mockOnDataHandler: ((data: string) => void) | null = null;
let mockOnResizeHandler: ((size: { cols: number; rows: number }) => void) | null = null;

const mockOnData = vi.fn().mockImplementation((handler: (data: string) => void) => {
  mockOnDataHandler = handler;
});
const mockOnResize = vi
  .fn()
  .mockImplementation((handler: (size: { cols: number; rows: number }) => void) => {
    mockOnResizeHandler = handler;
  });

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    write: mockWrite,
    open: mockOpen,
    loadAddon: mockLoadAddon,
    dispose: mockDispose,
    focus: mockFocus,
    selectAll: mockSelectAll,
    getSelection: mockGetSelection,
    clearSelection: mockClearSelection,
    onData: mockOnData,
    onResize: mockOnResize,
    cols: 80,
    rows: 24,
  })),
}));

const mockFit = vi.fn();

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: mockFit,
  })),
}));

vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@/hooks/use-terminal-resize', () => ({
  useTerminalResize: vi.fn(),
}));

vi.mock('@/lib/terminal-theme', () => ({
  TERMINAL_FONT_FAMILY:
    'ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Code", Consolas, monospace',
  TERMINAL_THEME: {
    background: '#0a0a0a',
    foreground: '#e4e4e7',
    cursor: '#e4e4e7',
  },
}));

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

type MockWebSocket = {
  url: string;
  readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

let mockWsInstance: MockWebSocket | null = null;

const MockWebSocketClass = vi.fn().mockImplementation((url: string) => {
  const ws: MockWebSocket = {
    url,
    readyState: 0, // CONNECTING
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send: vi.fn(),
    close: vi.fn(),
  };
  mockWsInstance = ws;
  return ws;
});

// Attach static constants
(MockWebSocketClass as Record<string, unknown>).CONNECTING = 0;
(MockWebSocketClass as Record<string, unknown>).OPEN = 1;
(MockWebSocketClass as Record<string, unknown>).CLOSING = 2;
(MockWebSocketClass as Record<string, unknown>).CLOSED = 3;

vi.stubGlobal('WebSocket', MockWebSocketClass);

// ---------------------------------------------------------------------------
// Mock navigator.clipboard
// ---------------------------------------------------------------------------

const mockClipboardWriteText = vi.fn().mockResolvedValue(undefined);

Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: mockClipboardWriteText },
  writable: true,
  configurable: true,
});

// ---------------------------------------------------------------------------
// Component import (after mocks)
// ---------------------------------------------------------------------------

import { useTerminalResize as mockUseTerminalResize } from '@/hooks/use-terminal-resize';
import { InteractiveTerminal } from './InteractiveTerminal';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wait for the async dynamic import() inside the component's useEffect to
 * resolve so that xterm Terminal is created and opened.
 */
async function flushAsyncInit(): Promise<void> {
  await vi.waitFor(() => {
    expect(mockOpen).toHaveBeenCalled();
  });
}

/** Simulate the WebSocket opening after init. */
function simulateWsOpen(): void {
  act(() => {
    if (mockWsInstance) {
      mockWsInstance.readyState = 1; // WebSocket.OPEN
      mockWsInstance.onopen?.(new Event('open'));
    }
  });
}

/** Simulate receiving a WebSocket message. */
function simulateWsMessage(data: Record<string, unknown>): void {
  act(() => {
    if (mockWsInstance) {
      mockWsInstance.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
    }
  });
}

/** Simulate the WebSocket closing. */
function simulateWsClose(): void {
  act(() => {
    if (mockWsInstance) {
      mockWsInstance.readyState = 3; // WebSocket.CLOSED
      mockWsInstance.onclose?.(new CloseEvent('close'));
    }
  });
}

/** Simulate a WebSocket error. */
function simulateWsError(): void {
  act(() => {
    if (mockWsInstance) {
      mockWsInstance.onerror?.(new Event('error'));
    }
  });
}

const defaultProps = {
  machineId: 'machine-1',
  terminalId: 'term-abc',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InteractiveTerminal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockWsInstance = null;
    mockOnDataHandler = null;
    mockOnResizeHandler = null;
    mockGetSelection.mockReturnValue('selected text');
    mockClipboardWriteText.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // =========================================================================
  // 1. Rendering
  // =========================================================================
  describe('rendering', () => {
    it('renders the outer container div', () => {
      const { container } = render(<InteractiveTerminal {...defaultProps} />);
      expect(container.firstChild).toBeDefined();
    });

    it('renders the terminal container with bg-[#0a0a0a]', () => {
      const { container } = render(<InteractiveTerminal {...defaultProps} />);
      const termDiv = container.querySelector('.bg-\\[\\#0a0a0a\\]');
      expect(termDiv).not.toBeNull();
    });

    it('shows "Disconnected" status by default', () => {
      render(<InteractiveTerminal {...defaultProps} />);
      expect(screen.getByText('Disconnected')).toBeDefined();
    });

    it('shows red status dot when disconnected', () => {
      const { container } = render(<InteractiveTerminal {...defaultProps} />);
      const dot = container.querySelector('.bg-red-500.rounded-full');
      expect(dot).not.toBeNull();
    });

    it('shows "Connected" status after WebSocket opens', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      simulateWsOpen();

      expect(screen.getByText('Connected')).toBeDefined();
    });

    it('shows green status dot when connected', async () => {
      const { container } = render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      simulateWsOpen();

      const dot = container.querySelector('.bg-green-500.rounded-full');
      expect(dot).not.toBeNull();
    });

    it('applies custom className to the outer wrapper', () => {
      const { container } = render(<InteractiveTerminal {...defaultProps} className="my-custom" />);
      const outer = container.firstChild as HTMLElement;
      expect(outer.className).toContain('my-custom');
    });

    it('preserves default classes when custom className is added', () => {
      const { container } = render(<InteractiveTerminal {...defaultProps} className="extra" />);
      const outer = container.firstChild as HTMLElement;
      expect(outer.className).toContain('relative');
      expect(outer.className).toContain('flex-1');
      expect(outer.className).toContain('min-h-0');
      expect(outer.className).toContain('extra');
    });

    it('works without className prop', () => {
      const { container } = render(<InteractiveTerminal {...defaultProps} />);
      const outer = container.firstChild as HTMLElement;
      expect(outer.className).toContain('relative');
    });

    it('renders the Copy button', () => {
      render(<InteractiveTerminal {...defaultProps} />);
      const btn = screen.getByLabelText('Copy terminal output');
      expect(btn).toBeDefined();
    });

    it('renders "Copy" text inside the button by default', () => {
      render(<InteractiveTerminal {...defaultProps} />);
      expect(screen.getByText('Copy')).toBeDefined();
    });
  });

  // =========================================================================
  // 2. Terminal initialization
  // =========================================================================
  describe('terminal initialization', () => {
    it('dynamically imports @xterm/xterm and @xterm/addon-fit', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      expect(mockOpen).toHaveBeenCalled();
      expect(mockLoadAddon).toHaveBeenCalled();
    });

    it('loads FitAddon into the terminal before opening', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      const loadAddonOrder = mockLoadAddon.mock.invocationCallOrder[0] ?? 0;
      const openOrder = mockOpen.mock.invocationCallOrder[0] ?? 0;
      expect(loadAddonOrder).toBeLessThan(openOrder);
    });

    it('calls fitAddon.fit() after opening the terminal', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      expect(mockFit).toHaveBeenCalled();
    });

    it('opens terminal into the container div element', async () => {
      const { container } = render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      const termDiv = container.querySelector('.bg-\\[\\#0a0a0a\\]');
      expect(mockOpen).toHaveBeenCalledWith(termDiv);
    });

    it('registers onData and onResize handlers', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      expect(mockOnData).toHaveBeenCalledWith(expect.any(Function));
      expect(mockOnResize).toHaveBeenCalledWith(expect.any(Function));
    });

    it('creates a WebSocket connection after terminal init', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      expect(MockWebSocketClass).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 3. WebSocket connection — URL construction
  // =========================================================================
  describe('WebSocket connection', () => {
    it('constructs dev URL with localhost:8080 in development mode', async () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();

      expect(MockWebSocketClass).toHaveBeenCalledWith(
        'ws://localhost:8080/api/machines/machine-1/terminal/term-abc/ws',
      );

      process.env.NODE_ENV = origEnv;
    });

    it('encodes machineId and terminalId in the URL', async () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      render(<InteractiveTerminal machineId="machine/special" terminalId="term&id" />);
      await flushAsyncInit();

      const url = MockWebSocketClass.mock.calls[0]?.[0] as string | undefined;
      expect(url).toContain(encodeURIComponent('machine/special'));
      expect(url).toContain(encodeURIComponent('term&id'));

      process.env.NODE_ENV = origEnv;
    });

    it('constructs production URL using window.location', async () => {
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      // window.location in jsdom defaults to http://localhost
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();

      const url = MockWebSocketClass.mock.calls[0]?.[0] as string | undefined;
      expect(url).toContain('ws://');
      expect(url).toContain('/api/machines/machine-1/terminal/term-abc/ws');

      process.env.NODE_ENV = origEnv;
    });

    it('sends initial resize on WebSocket open', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      simulateWsOpen();

      expect(mockWsInstance?.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'resize', cols: 80, rows: 24 }),
      );
    });

    it('focuses the terminal on WebSocket open', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      simulateWsOpen();

      expect(mockFocus).toHaveBeenCalled();
    });

    it('sets connected state to true on open', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      simulateWsOpen();

      expect(screen.getByText('Connected')).toBeDefined();
    });

    it('sets connected state to false on close', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      simulateWsOpen();

      expect(screen.getByText('Connected')).toBeDefined();

      simulateWsClose();

      expect(screen.getByText('Disconnected')).toBeDefined();
    });

    it('writes "[Connection closed]" to terminal on close', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      simulateWsOpen();
      simulateWsClose();

      expect(mockWrite).toHaveBeenCalledWith(expect.stringContaining('[Connection closed]'));
    });

    it('creates a new WebSocket when machineId changes', async () => {
      const { rerender } = render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();

      MockWebSocketClass.mockClear();
      mockOpen.mockClear();

      rerender(<InteractiveTerminal machineId="machine-2" terminalId="term-abc" />);

      await vi.waitFor(() => {
        expect(MockWebSocketClass).toHaveBeenCalled();
      });
    });

    it('creates a new WebSocket when terminalId changes', async () => {
      const { rerender } = render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();

      MockWebSocketClass.mockClear();
      mockOpen.mockClear();

      rerender(<InteractiveTerminal machineId="machine-1" terminalId="term-xyz" />);

      await vi.waitFor(() => {
        expect(MockWebSocketClass).toHaveBeenCalled();
      });
    });
  });

  // =========================================================================
  // 4. WebSocket message handling
  // =========================================================================
  describe('WebSocket message handling', () => {
    it('writes output data to terminal on "output" message', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      simulateWsOpen();

      simulateWsMessage({ type: 'output', data: 'hello world' });

      expect(mockWrite).toHaveBeenCalledWith('hello world');
    });

    it('does not write when "output" message has no data field', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      simulateWsOpen();
      mockWrite.mockClear();

      simulateWsMessage({ type: 'output' });

      expect(mockWrite).not.toHaveBeenCalled();
    });

    it('writes exit message to terminal on "exit" message', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      simulateWsOpen();

      simulateWsMessage({ type: 'exit', code: 1 });

      expect(mockWrite).toHaveBeenCalledWith(
        expect.stringContaining('[Process exited with code 1]'),
      );
    });

    it('defaults exit code to 0 when code is not provided', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      simulateWsOpen();

      simulateWsMessage({ type: 'exit' });

      expect(mockWrite).toHaveBeenCalledWith(
        expect.stringContaining('[Process exited with code 0]'),
      );
    });

    it('writes error message to terminal on "error" message', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      simulateWsOpen();

      simulateWsMessage({ type: 'error', message: 'Something went wrong' });

      expect(mockWrite).toHaveBeenCalledWith(
        expect.stringContaining('[Error: Something went wrong]'),
      );
    });

    it('defaults error message to "Unknown error" when message is not provided', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      simulateWsOpen();

      simulateWsMessage({ type: 'error' });

      expect(mockWrite).toHaveBeenCalledWith(expect.stringContaining('[Error: Unknown error]'));
    });

    it('ignores unknown message types', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      simulateWsOpen();
      mockWrite.mockClear();

      simulateWsMessage({ type: 'unknown', data: 'mystery' });

      expect(mockWrite).not.toHaveBeenCalled();
    });

    it('ignores invalid JSON messages without crashing', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      simulateWsOpen();
      mockWrite.mockClear();

      // Send non-JSON data directly
      if (mockWsInstance) {
        mockWsInstance.onmessage?.(new MessageEvent('message', { data: 'not valid json {{{' }));
      }

      expect(mockWrite).not.toHaveBeenCalled();
    });

    it('handles multiple output messages in sequence', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      simulateWsOpen();

      simulateWsMessage({ type: 'output', data: 'line1\n' });
      simulateWsMessage({ type: 'output', data: 'line2\n' });
      simulateWsMessage({ type: 'output', data: 'line3\n' });

      expect(mockWrite).toHaveBeenCalledWith('line1\n');
      expect(mockWrite).toHaveBeenCalledWith('line2\n');
      expect(mockWrite).toHaveBeenCalledWith('line3\n');
    });

    it('handles ANSI escape sequences in output', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      simulateWsOpen();

      const ansi = '\x1b[32mgreen\x1b[0m';
      simulateWsMessage({ type: 'output', data: ansi });

      expect(mockWrite).toHaveBeenCalledWith(ansi);
    });
  });

  // =========================================================================
  // 5. Keyboard input — terminal.onData sends to WebSocket
  // =========================================================================
  describe('keyboard input', () => {
    it('sends input data to WebSocket when user types', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      simulateWsOpen();

      // Trigger the onData handler
      mockOnDataHandler?.('hello');

      expect(mockWsInstance?.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'input', data: 'hello' }),
      );
    });

    it('does not send input when WebSocket is not open', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      // WebSocket is still CONNECTING (readyState = 0), do not call simulateWsOpen

      mockOnDataHandler?.('hello');

      // The initial send should not include an input message
      const calls = mockWsInstance?.send.mock.calls ?? [];
      const inputCalls = calls.filter((call: unknown[]) => {
        try {
          const parsed = JSON.parse(call[0] as string) as Record<string, unknown>;
          return parsed.type === 'input';
        } catch {
          return false;
        }
      });
      expect(inputCalls).toHaveLength(0);
    });

    it('sends special characters (Enter, Tab, etc.)', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      simulateWsOpen();

      mockOnDataHandler?.('\r');

      expect(mockWsInstance?.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'input', data: '\r' }),
      );
    });

    it('sends multi-character input', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      simulateWsOpen();

      mockOnDataHandler?.('ls -la\r');

      expect(mockWsInstance?.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'input', data: 'ls -la\r' }),
      );
    });
  });

  // =========================================================================
  // 6. Resize events — terminal.onResize sends to WebSocket
  // =========================================================================
  describe('resize events', () => {
    it('sends resize event to WebSocket when terminal resizes', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      simulateWsOpen();

      // Clear the initial resize sent on open
      mockWsInstance?.send.mockClear();

      mockOnResizeHandler?.({ cols: 120, rows: 40 });

      expect(mockWsInstance?.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'resize', cols: 120, rows: 40 }),
      );
    });

    it('does not send resize when WebSocket is not open', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      // WebSocket is still CONNECTING

      mockOnResizeHandler?.({ cols: 120, rows: 40 });

      const calls = mockWsInstance?.send.mock.calls ?? [];
      const resizeCalls = calls.filter((call: unknown[]) => {
        try {
          const parsed = JSON.parse(call[0] as string) as Record<string, unknown>;
          return parsed.type === 'resize';
        } catch {
          return false;
        }
      });
      expect(resizeCalls).toHaveLength(0);
    });

    it('sends different resize dimensions', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      simulateWsOpen();
      mockWsInstance?.send.mockClear();

      mockOnResizeHandler?.({ cols: 200, rows: 50 });

      expect(mockWsInstance?.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'resize', cols: 200, rows: 50 }),
      );
    });

    it('calls useTerminalResize hook with correct refs', () => {
      render(<InteractiveTerminal {...defaultProps} />);
      expect(mockUseTerminalResize).toHaveBeenCalledTimes(1);
      const args = vi.mocked(mockUseTerminalResize).mock.calls[0];
      // fitAddonRef — has { current } property (null initially, set after async init)
      expect(args?.[0]).toHaveProperty('current');
      // containerRef — has { current } pointing to the terminal container div
      expect(args?.[1]).toHaveProperty('current');
    });
  });

  // =========================================================================
  // 7. Copy button
  // =========================================================================
  describe('copy button', () => {
    it('renders a button with aria-label "Copy terminal output"', () => {
      render(<InteractiveTerminal {...defaultProps} />);
      const btn = screen.getByLabelText('Copy terminal output');
      expect(btn.tagName).toBe('BUTTON');
    });

    it('calls selectAll, getSelection, clearSelection, clipboard.writeText on click', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();

      const btn = screen.getByLabelText('Copy terminal output');
      await act(async () => {
        fireEvent.click(btn);
      });

      expect(mockSelectAll).toHaveBeenCalled();
      expect(mockGetSelection).toHaveBeenCalled();
      expect(mockClearSelection).toHaveBeenCalled();
      expect(mockClipboardWriteText).toHaveBeenCalledWith('selected text');
    });

    it('shows "Copied!" text after successful copy', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();

      const btn = screen.getByLabelText('Copy terminal output');
      await act(async () => {
        fireEvent.click(btn);
      });

      expect(screen.getByText('Copied!')).toBeDefined();
    });

    it('reverts "Copied!" back to "Copy" after 2000ms', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();

      const btn = screen.getByLabelText('Copy terminal output');
      await act(async () => {
        fireEvent.click(btn);
      });

      expect(screen.getByText('Copied!')).toBeDefined();

      await act(async () => {
        vi.advanceTimersByTime(2000);
      });

      expect(screen.getByText('Copy')).toBeDefined();
    });

    it('does not call clipboard.writeText when selection is empty', async () => {
      mockGetSelection.mockReturnValueOnce('');

      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();

      const btn = screen.getByLabelText('Copy terminal output');
      fireEvent.click(btn);

      expect(mockClipboardWriteText).not.toHaveBeenCalled();
    });

    it('does not crash when terminal is not initialized', () => {
      render(<InteractiveTerminal {...defaultProps} />);
      // Click before async init completes
      const btn = screen.getByLabelText('Copy terminal output');

      expect(() => {
        fireEvent.click(btn);
      }).not.toThrow();
    });

    it('calls selectAll before getSelection', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();

      const btn = screen.getByLabelText('Copy terminal output');
      await act(async () => {
        fireEvent.click(btn);
      });

      const selectAllOrder = mockSelectAll.mock.invocationCallOrder[0] ?? 0;
      const getSelectionOrder = mockGetSelection.mock.invocationCallOrder[0] ?? 0;
      expect(selectAllOrder).toBeLessThan(getSelectionOrder);
    });

    it('calls clearSelection after getSelection', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();

      const btn = screen.getByLabelText('Copy terminal output');
      await act(async () => {
        fireEvent.click(btn);
      });

      const getSelectionOrder = mockGetSelection.mock.invocationCallOrder[0] ?? 0;
      const clearSelectionOrder = mockClearSelection.mock.invocationCallOrder[0] ?? 0;
      expect(getSelectionOrder).toBeLessThan(clearSelectionOrder);
    });
  });

  // =========================================================================
  // 8. Callbacks — onExit and onError
  // =========================================================================
  describe('callbacks', () => {
    it('calls onExit with exit code when "exit" message is received', async () => {
      const onExit = vi.fn();
      render(<InteractiveTerminal {...defaultProps} onExit={onExit} />);
      await flushAsyncInit();
      simulateWsOpen();

      simulateWsMessage({ type: 'exit', code: 42 });

      expect(onExit).toHaveBeenCalledWith(42);
    });

    it('calls onExit with 0 when exit code is not provided', async () => {
      const onExit = vi.fn();
      render(<InteractiveTerminal {...defaultProps} onExit={onExit} />);
      await flushAsyncInit();
      simulateWsOpen();

      simulateWsMessage({ type: 'exit' });

      expect(onExit).toHaveBeenCalledWith(0);
    });

    it('calls onError with message when "error" message is received', async () => {
      const onError = vi.fn();
      render(<InteractiveTerminal {...defaultProps} onError={onError} />);
      await flushAsyncInit();
      simulateWsOpen();

      simulateWsMessage({ type: 'error', message: 'Something broke' });

      expect(onError).toHaveBeenCalledWith('Something broke');
    });

    it('calls onError with "Unknown error" when error message field is missing', async () => {
      const onError = vi.fn();
      render(<InteractiveTerminal {...defaultProps} onError={onError} />);
      await flushAsyncInit();
      simulateWsOpen();

      simulateWsMessage({ type: 'error' });

      expect(onError).toHaveBeenCalledWith('Unknown error');
    });

    it('calls onError with "WebSocket connection failed" on ws error', async () => {
      const onError = vi.fn();
      render(<InteractiveTerminal {...defaultProps} onError={onError} />);
      await flushAsyncInit();

      simulateWsError();

      expect(onError).toHaveBeenCalledWith('WebSocket connection failed');
    });

    it('uses the latest onExit callback via ref', async () => {
      const onExit1 = vi.fn();
      const onExit2 = vi.fn();
      const { rerender } = render(<InteractiveTerminal {...defaultProps} onExit={onExit1} />);
      await flushAsyncInit();
      simulateWsOpen();

      // Update the callback
      rerender(<InteractiveTerminal {...defaultProps} onExit={onExit2} />);

      simulateWsMessage({ type: 'exit', code: 5 });

      expect(onExit1).not.toHaveBeenCalled();
      expect(onExit2).toHaveBeenCalledWith(5);
    });

    it('uses the latest onError callback via ref', async () => {
      const onError1 = vi.fn();
      const onError2 = vi.fn();
      const { rerender } = render(<InteractiveTerminal {...defaultProps} onError={onError1} />);
      await flushAsyncInit();
      simulateWsOpen();

      // Update the callback
      rerender(<InteractiveTerminal {...defaultProps} onError={onError2} />);

      simulateWsMessage({ type: 'error', message: 'fail' });

      expect(onError1).not.toHaveBeenCalled();
      expect(onError2).toHaveBeenCalledWith('fail');
    });

    it('does not crash when onExit is not provided', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      simulateWsOpen();

      expect(() => {
        simulateWsMessage({ type: 'exit', code: 0 });
      }).not.toThrow();
    });

    it('does not crash when onError is not provided', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      simulateWsOpen();

      expect(() => {
        simulateWsMessage({ type: 'error', message: 'oops' });
      }).not.toThrow();
    });

    it('does not crash when onError is not provided and ws errors', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();

      expect(() => {
        simulateWsError();
      }).not.toThrow();
    });
  });

  // =========================================================================
  // 9. Cleanup on unmount
  // =========================================================================
  describe('cleanup on unmount', () => {
    it('disposes the xterm terminal on unmount', async () => {
      const { unmount } = render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      mockDispose.mockClear();

      unmount();

      expect(mockDispose).toHaveBeenCalled();
    });

    it('closes the WebSocket on unmount', async () => {
      const { unmount } = render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();

      const ws = mockWsInstance;
      unmount();

      expect(ws?.close).toHaveBeenCalled();
    });

    it('sets disposed flag to prevent terminal init after unmount', async () => {
      const { unmount } = render(<InteractiveTerminal {...defaultProps} />);
      // Unmount immediately before async init completes
      unmount();

      // Wait for the async import to resolve
      await vi.advanceTimersByTimeAsync(0);

      // No error should be thrown. The disposed flag prevents calling
      // terminal.open on an unmounted component.
    });

    it('does not set connected state after unmount', async () => {
      const { unmount } = render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();

      const ws = mockWsInstance;
      unmount();

      // Simulate open after unmount — should not throw
      expect(() => {
        ws?.onopen?.(new Event('open'));
      }).not.toThrow();
    });

    it('does not process messages after unmount', async () => {
      const onExit = vi.fn();
      const { unmount } = render(<InteractiveTerminal {...defaultProps} onExit={onExit} />);
      await flushAsyncInit();
      simulateWsOpen();
      mockWrite.mockClear();

      const ws = mockWsInstance;
      unmount();

      // Simulate message after unmount — disposed flag should prevent processing
      ws?.onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'exit', code: 1 }),
        }),
      );

      // onExit should not be called after unmount due to disposed flag
      expect(onExit).not.toHaveBeenCalled();
    });

    it('does not update connected state on close after unmount', async () => {
      const { unmount } = render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      simulateWsOpen();

      const ws = mockWsInstance;
      unmount();

      // Should not throw
      expect(() => {
        ws?.onclose?.(new CloseEvent('close'));
      }).not.toThrow();
    });

    it('does not call onError on ws error after unmount', async () => {
      const onError = vi.fn();
      const { unmount } = render(<InteractiveTerminal {...defaultProps} onError={onError} />);
      await flushAsyncInit();

      const ws = mockWsInstance;
      unmount();

      ws?.onerror?.(new Event('error'));

      expect(onError).not.toHaveBeenCalled();
    });

    it('cleans up on re-mount with different props', async () => {
      const { rerender, unmount } = render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();

      const firstWs = mockWsInstance;
      mockDispose.mockClear();

      // Change props triggers effect cleanup + re-run
      rerender(<InteractiveTerminal machineId="machine-2" terminalId="term-xyz" />);

      // First WebSocket should be closed
      expect(firstWs?.close).toHaveBeenCalled();
      // First terminal should be disposed
      expect(mockDispose).toHaveBeenCalled();

      unmount();
    });
  });

  // =========================================================================
  // 10. Edge cases
  // =========================================================================
  describe('edge cases', () => {
    it('handles rapid mount/unmount/mount cycles', async () => {
      const { unmount: unmount1 } = render(<InteractiveTerminal {...defaultProps} />);
      // Unmount immediately before async init completes
      unmount1();

      // Allow the first mount's async init to settle
      await vi.advanceTimersByTimeAsync(0);

      // Reset call counts but keep implementations
      mockOpen.mockClear();
      MockWebSocketClass.mockClear();

      // Second mount should work normally
      const { unmount: unmount2 } = render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      simulateWsOpen();

      expect(screen.getByText('Connected')).toBeDefined();
      unmount2();
    });

    it('does not crash when containerRef is null', () => {
      // This tests the early return in useEffect when containerRef.current is null.
      // Since we can't easily force ref to be null with RTL, this is a safety check
      // that the component mounts without error.
      expect(() => {
        render(<InteractiveTerminal {...defaultProps} />);
      }).not.toThrow();
    });

    it('handles empty string output data', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      simulateWsOpen();
      mockWrite.mockClear();

      simulateWsMessage({ type: 'output', data: '' });

      // Empty string is falsy, so write is not called
      expect(mockWrite).not.toHaveBeenCalled();
    });

    it('handles output with unicode characters', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      simulateWsOpen();

      const unicode = '\u2603 snowman \u2764 heart';
      simulateWsMessage({ type: 'output', data: unicode });

      expect(mockWrite).toHaveBeenCalledWith(unicode);
    });

    it('handles output with newlines and tabs', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      simulateWsOpen();

      const special = 'line1\nline2\ttab\r\nwindows';
      simulateWsMessage({ type: 'output', data: special });

      expect(mockWrite).toHaveBeenCalledWith(special);
    });

    it('transitions from Connected to Disconnected back to Connected', async () => {
      const { rerender } = render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();

      simulateWsOpen();
      expect(screen.getByText('Connected')).toBeDefined();

      simulateWsClose();
      expect(screen.getByText('Disconnected')).toBeDefined();

      // Re-render with different terminal ID triggers new connection
      vi.clearAllMocks();
      rerender(<InteractiveTerminal machineId="machine-1" terminalId="term-new" />);

      await vi.waitFor(() => {
        expect(mockOpen).toHaveBeenCalled();
      });

      simulateWsOpen();
      expect(screen.getByText('Connected')).toBeDefined();
    });

    it('does not send input after WebSocket closes', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      simulateWsOpen();
      simulateWsClose();

      mockWsInstance?.send.mockClear();

      mockOnDataHandler?.('should not send');

      expect(mockWsInstance?.send).not.toHaveBeenCalled();
    });

    it('does not send resize after WebSocket closes', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();
      simulateWsOpen();
      simulateWsClose();

      mockWsInstance?.send.mockClear();

      mockOnResizeHandler?.({ cols: 100, rows: 30 });

      expect(mockWsInstance?.send).not.toHaveBeenCalled();
    });

    it('handles copy when getSelection returns null-like value', async () => {
      mockGetSelection.mockReturnValueOnce('');

      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();

      const btn = screen.getByLabelText('Copy terminal output');
      fireEvent.click(btn);

      expect(mockClipboardWriteText).not.toHaveBeenCalled();
      // Should not show "Copied!" since nothing was copied
      expect(screen.queryByText('Copied!')).toBeNull();
    });

    it('handles multiple copy clicks', async () => {
      render(<InteractiveTerminal {...defaultProps} />);
      await flushAsyncInit();

      const btn = screen.getByLabelText('Copy terminal output');

      await act(async () => {
        fireEvent.click(btn);
      });
      expect(screen.getByText('Copied!')).toBeDefined();

      await act(async () => {
        fireEvent.click(btn);
      });
      expect(mockSelectAll).toHaveBeenCalledTimes(2);
    });

    it('handles exit code 0 (success)', async () => {
      const onExit = vi.fn();
      render(<InteractiveTerminal {...defaultProps} onExit={onExit} />);
      await flushAsyncInit();
      simulateWsOpen();

      simulateWsMessage({ type: 'exit', code: 0 });

      expect(onExit).toHaveBeenCalledWith(0);
      expect(mockWrite).toHaveBeenCalledWith(
        expect.stringContaining('[Process exited with code 0]'),
      );
    });

    it('handles negative exit code', async () => {
      const onExit = vi.fn();
      render(<InteractiveTerminal {...defaultProps} onExit={onExit} />);
      await flushAsyncInit();
      simulateWsOpen();

      simulateWsMessage({ type: 'exit', code: -1 });

      expect(onExit).toHaveBeenCalledWith(-1);
    });

    it('handles exit code 137 (SIGKILL)', async () => {
      const onExit = vi.fn();
      render(<InteractiveTerminal {...defaultProps} onExit={onExit} />);
      await flushAsyncInit();
      simulateWsOpen();

      simulateWsMessage({ type: 'exit', code: 137 });

      expect(onExit).toHaveBeenCalledWith(137);
      expect(mockWrite).toHaveBeenCalledWith(
        expect.stringContaining('[Process exited with code 137]'),
      );
    });
  });
});
