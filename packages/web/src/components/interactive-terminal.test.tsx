import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock xterm Terminal class
const mockWrite = vi.fn();
const mockOpen = vi.fn();
const mockLoadAddon = vi.fn();
const mockDispose = vi.fn();
const mockFocus = vi.fn();
const mockOnData = vi.fn();
const mockOnResize = vi.fn();

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    write: mockWrite,
    open: mockOpen,
    loadAddon: mockLoadAddon,
    dispose: mockDispose,
    focus: mockFocus,
    onData: mockOnData,
    onResize: mockOnResize,
    cols: 80,
    rows: 24,
  })),
}));

// Mock FitAddon
const mockFit = vi.fn();

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: mockFit,
  })),
}));

// Mock the CSS import
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

// Mock WebSocket
class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  static instances: MockWebSocket[] = [];
  readyState = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  send = vi.fn();
  close = vi.fn();
  url: string;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  simulateMessage(data: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
  }

  simulateClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close'));
  }
}

vi.stubGlobal('WebSocket', MockWebSocket);

import { InteractiveTerminal } from './InteractiveTerminal';

/** Helper to get the first MockWebSocket instance, throwing if not created yet. */
function getWs(): MockWebSocket {
  const ws = MockWebSocket.instances[0];
  if (!ws) throw new Error('No WebSocket instance created');
  return ws;
}

/** Helper to get the Nth MockWebSocket instance (0-indexed), throwing if not found. */
function getWsAt(index: number): MockWebSocket {
  const ws = MockWebSocket.instances[index];
  if (!ws) throw new Error(`No WebSocket instance at index ${String(index)}`);
  return ws;
}

describe('InteractiveTerminal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockWebSocket.instances = [];
  });

  it('renders the container div', () => {
    const { container } = render(<InteractiveTerminal machineId="m1" terminalId="t1" />);
    expect(container.firstChild).toBeDefined();
  });

  it('has the terminal container with bg-[#0a0a0a] class', () => {
    const { container } = render(<InteractiveTerminal machineId="m1" terminalId="t1" />);
    const termDiv = container.querySelector('.bg-\\[\\#0a0a0a\\]');
    expect(termDiv).toBeDefined();
    expect(termDiv).not.toBeNull();
  });

  it('shows "Disconnected" indicator initially', () => {
    render(<InteractiveTerminal machineId="m1" terminalId="t1" />);
    expect(screen.getByText('Disconnected')).toBeDefined();
  });

  it('shows "Connected" indicator when WebSocket opens', async () => {
    render(<InteractiveTerminal machineId="m1" terminalId="t1" />);

    // Wait for the async xterm import and WebSocket creation
    await vi.waitFor(() => {
      expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    });

    const ws = getWs();
    ws.simulateOpen();

    await vi.waitFor(() => {
      expect(screen.getByText('Connected')).toBeDefined();
    });
  });

  it('shows "Disconnected" when WebSocket closes', async () => {
    render(<InteractiveTerminal machineId="m1" terminalId="t1" />);

    await vi.waitFor(() => {
      expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    });

    const ws = getWs();
    ws.simulateOpen();

    await vi.waitFor(() => {
      expect(screen.getByText('Connected')).toBeDefined();
    });

    ws.simulateClose();

    await vi.waitFor(() => {
      expect(screen.getByText('Disconnected')).toBeDefined();
    });
  });

  it('sends initial resize message on WebSocket open', async () => {
    render(<InteractiveTerminal machineId="m1" terminalId="t1" />);

    await vi.waitFor(() => {
      expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    });

    const ws = getWs();
    ws.simulateOpen();

    await vi.waitFor(() => {
      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'resize', cols: 80, rows: 24 }));
    });
  });

  it('writes output messages to the terminal', async () => {
    render(<InteractiveTerminal machineId="m1" terminalId="t1" />);

    await vi.waitFor(() => {
      expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    });

    const ws = getWs();
    ws.simulateOpen();
    ws.simulateMessage({ type: 'output', data: 'hello world' });

    await vi.waitFor(() => {
      expect(mockWrite).toHaveBeenCalledWith('hello world');
    });
  });

  it('calls onExit when exit message is received', async () => {
    const onExit = vi.fn();
    render(<InteractiveTerminal machineId="m1" terminalId="t1" onExit={onExit} />);

    await vi.waitFor(() => {
      expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    });

    const ws = getWs();
    ws.simulateOpen();
    ws.simulateMessage({ type: 'exit', code: 0 });

    await vi.waitFor(() => {
      expect(onExit).toHaveBeenCalledWith(0);
    });
  });

  it('calls onError when error message is received', async () => {
    const onError = vi.fn();
    render(<InteractiveTerminal machineId="m1" terminalId="t1" onError={onError} />);

    await vi.waitFor(() => {
      expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    });

    const ws = getWs();
    ws.simulateOpen();
    ws.simulateMessage({ type: 'error', message: 'something broke' });

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith('something broke');
    });
  });

  it('applies custom className to outer wrapper', () => {
    const { container } = render(
      <InteractiveTerminal machineId="m1" terminalId="t1" className="my-custom" />,
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('my-custom');
  });

  it('constructs the correct WebSocket URL in development', async () => {
    render(<InteractiveTerminal machineId="m1" terminalId="t1" />);

    await vi.waitFor(() => {
      expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    });

    const ws = getWs();
    expect(ws.url).toContain('/api/machines/m1/terminal/t1/ws');
  });

  // ---------------------------------------------------------------------------
  // WebSocket reconnection on prop changes
  // ---------------------------------------------------------------------------
  describe('WebSocket reconnection on prop changes', () => {
    it('creates a new WebSocket when machineId changes', async () => {
      const { rerender } = render(<InteractiveTerminal machineId="m1" terminalId="t1" />);

      await vi.waitFor(() => {
        expect(MockWebSocket.instances).toHaveLength(1);
      });

      const firstWs = getWs();
      firstWs.simulateOpen();

      rerender(<InteractiveTerminal machineId="m2" terminalId="t1" />);

      await vi.waitFor(() => {
        expect(MockWebSocket.instances).toHaveLength(2);
      });

      expect(firstWs.close).toHaveBeenCalled();
      const secondWs = getWsAt(1);
      expect(secondWs.url).toContain('/api/machines/m2/terminal/t1/ws');
    });

    it('creates a new WebSocket when terminalId changes', async () => {
      const { rerender } = render(<InteractiveTerminal machineId="m1" terminalId="t1" />);

      await vi.waitFor(() => {
        expect(MockWebSocket.instances).toHaveLength(1);
      });

      const firstWs = getWs();
      firstWs.simulateOpen();

      rerender(<InteractiveTerminal machineId="m1" terminalId="t2" />);

      await vi.waitFor(() => {
        expect(MockWebSocket.instances).toHaveLength(2);
      });

      expect(firstWs.close).toHaveBeenCalled();
      const secondWs = getWsAt(1);
      expect(secondWs.url).toContain('/api/machines/m1/terminal/t2/ws');
    });

    it('disposes previous terminal instance on prop change', async () => {
      const { rerender } = render(<InteractiveTerminal machineId="m1" terminalId="t1" />);

      await vi.waitFor(() => {
        expect(MockWebSocket.instances).toHaveLength(1);
      });

      getWs().simulateOpen();
      mockDispose.mockClear();

      rerender(<InteractiveTerminal machineId="m1" terminalId="t2" />);

      await vi.waitFor(() => {
        expect(mockDispose).toHaveBeenCalled();
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Terminal resize handling
  // ---------------------------------------------------------------------------
  describe('terminal resize handling', () => {
    it('calls fitAddon.fit on window resize', async () => {
      render(<InteractiveTerminal machineId="m1" terminalId="t1" />);

      await vi.waitFor(() => {
        expect(MockWebSocket.instances).toHaveLength(1);
      });

      mockFit.mockClear();

      window.dispatchEvent(new Event('resize'));

      await vi.waitFor(() => {
        expect(mockFit).toHaveBeenCalled();
      });
    });

    it('performs an initial fit after mounting (delayed setTimeout)', async () => {
      render(<InteractiveTerminal machineId="m1" terminalId="t1" />);

      // The component schedules a setTimeout(handleResize, 100) on mount.
      // Together with the immediate fit() inside the async init, fit should
      // be called at least twice (once on init, once from the delayed timer).
      await vi.waitFor(() => {
        // At least 2 calls: initial fit() + delayed setTimeout fit()
        expect(mockFit.mock.calls.length).toBeGreaterThanOrEqual(2);
      });
    });

    it('sends resize event over WebSocket when terminal.onResize fires', async () => {
      render(<InteractiveTerminal machineId="m1" terminalId="t1" />);

      await vi.waitFor(() => {
        expect(MockWebSocket.instances).toHaveLength(1);
      });

      const ws = getWs();
      ws.simulateOpen();

      // The component calls terminal.onResize(callback). Grab that callback.
      await vi.waitFor(() => {
        expect(mockOnResize).toHaveBeenCalled();
      });

      const resizeCallback = mockOnResize.mock.calls[0]?.[0] as (size: {
        cols: number;
        rows: number;
      }) => void;

      ws.send.mockClear();
      resizeCallback({ cols: 120, rows: 40 });

      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }));
    });

    it('does not send resize event when WebSocket is not open', async () => {
      render(<InteractiveTerminal machineId="m1" terminalId="t1" />);

      await vi.waitFor(() => {
        expect(MockWebSocket.instances).toHaveLength(1);
      });

      // Do NOT open the WebSocket — leave it in CONNECTING state
      await vi.waitFor(() => {
        expect(mockOnResize).toHaveBeenCalled();
      });

      const resizeCallback = mockOnResize.mock.calls[0]?.[0] as (size: {
        cols: number;
        rows: number;
      }) => void;

      const ws = getWs();
      ws.send.mockClear();
      resizeCallback({ cols: 100, rows: 30 });

      expect(ws.send).not.toHaveBeenCalled();
    });

    it('does not throw when fitAddon.fit fails', async () => {
      render(<InteractiveTerminal machineId="m1" terminalId="t1" />);

      await vi.waitFor(() => {
        expect(MockWebSocket.instances).toHaveLength(1);
      });

      mockFit.mockImplementationOnce(() => {
        throw new Error('Terminal not ready');
      });

      // Should not throw
      expect(() => {
        window.dispatchEvent(new Event('resize'));
      }).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Input forwarding to WebSocket
  // ---------------------------------------------------------------------------
  describe('input forwarding to WebSocket', () => {
    it('sends keyboard input data to WebSocket when connected', async () => {
      render(<InteractiveTerminal machineId="m1" terminalId="t1" />);

      await vi.waitFor(() => {
        expect(MockWebSocket.instances).toHaveLength(1);
      });

      const ws = getWs();
      ws.simulateOpen();

      await vi.waitFor(() => {
        expect(mockOnData).toHaveBeenCalled();
      });

      const dataCallback = mockOnData.mock.calls[0]?.[0] as (data: string) => void;

      ws.send.mockClear();
      dataCallback('ls -la\r');

      expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'input', data: 'ls -la\r' }));
    });

    it('does not send input when WebSocket is not open', async () => {
      render(<InteractiveTerminal machineId="m1" terminalId="t1" />);

      await vi.waitFor(() => {
        expect(MockWebSocket.instances).toHaveLength(1);
      });

      // WebSocket stays in CONNECTING state
      await vi.waitFor(() => {
        expect(mockOnData).toHaveBeenCalled();
      });

      const dataCallback = mockOnData.mock.calls[0]?.[0] as (data: string) => void;

      const ws = getWs();
      ws.send.mockClear();
      dataCallback('hello');

      expect(ws.send).not.toHaveBeenCalled();
    });

    it('does not send input after WebSocket closes', async () => {
      render(<InteractiveTerminal machineId="m1" terminalId="t1" />);

      await vi.waitFor(() => {
        expect(MockWebSocket.instances).toHaveLength(1);
      });

      const ws = getWs();
      ws.simulateOpen();

      await vi.waitFor(() => {
        expect(mockOnData).toHaveBeenCalled();
      });

      const dataCallback = mockOnData.mock.calls[0]?.[0] as (data: string) => void;

      ws.simulateClose();
      ws.send.mockClear();
      dataCallback('should not send');

      expect(ws.send).not.toHaveBeenCalled();
    });

    it('forwards multiple sequential inputs', async () => {
      render(<InteractiveTerminal machineId="m1" terminalId="t1" />);

      await vi.waitFor(() => {
        expect(MockWebSocket.instances).toHaveLength(1);
      });

      const ws = getWs();
      ws.simulateOpen();

      await vi.waitFor(() => {
        expect(mockOnData).toHaveBeenCalled();
      });

      const dataCallback = mockOnData.mock.calls[0]?.[0] as (data: string) => void;

      ws.send.mockClear();
      dataCallback('a');
      dataCallback('b');
      dataCallback('c');

      expect(ws.send).toHaveBeenCalledTimes(3);
      expect(ws.send).toHaveBeenNthCalledWith(1, JSON.stringify({ type: 'input', data: 'a' }));
      expect(ws.send).toHaveBeenNthCalledWith(2, JSON.stringify({ type: 'input', data: 'b' }));
      expect(ws.send).toHaveBeenNthCalledWith(3, JSON.stringify({ type: 'input', data: 'c' }));
    });
  });

  // ---------------------------------------------------------------------------
  // Connection status display changes
  // ---------------------------------------------------------------------------
  describe('connection status display', () => {
    it('shows red indicator dot when disconnected', () => {
      const { container } = render(<InteractiveTerminal machineId="m1" terminalId="t1" />);
      const dot = container.querySelector('.bg-red-500.rounded-full');
      expect(dot).not.toBeNull();
    });

    it('shows green indicator dot when connected', async () => {
      const { container } = render(<InteractiveTerminal machineId="m1" terminalId="t1" />);

      await vi.waitFor(() => {
        expect(MockWebSocket.instances).toHaveLength(1);
      });

      getWs().simulateOpen();

      await vi.waitFor(() => {
        const dot = container.querySelector('.bg-green-500.rounded-full');
        expect(dot).not.toBeNull();
      });
    });

    it('status text has correct color class when disconnected', () => {
      render(<InteractiveTerminal machineId="m1" terminalId="t1" />);
      const label = screen.getByText('Disconnected');
      expect(label.className).toContain('text-red-500');
    });

    it('status text has correct color class when connected', async () => {
      render(<InteractiveTerminal machineId="m1" terminalId="t1" />);

      await vi.waitFor(() => {
        expect(MockWebSocket.instances).toHaveLength(1);
      });

      getWs().simulateOpen();

      await vi.waitFor(() => {
        const label = screen.getByText('Connected');
        expect(label.className).toContain('text-green-500');
      });
    });

    it('reverts to disconnected after connection then close', async () => {
      const { container } = render(<InteractiveTerminal machineId="m1" terminalId="t1" />);

      await vi.waitFor(() => {
        expect(MockWebSocket.instances).toHaveLength(1);
      });

      const ws = getWs();
      ws.simulateOpen();

      await vi.waitFor(() => {
        expect(screen.getByText('Connected')).toBeDefined();
      });

      ws.simulateClose();

      await vi.waitFor(() => {
        expect(screen.getByText('Disconnected')).toBeDefined();
        const dot = container.querySelector('.bg-red-500.rounded-full');
        expect(dot).not.toBeNull();
      });
    });
  });

  // ---------------------------------------------------------------------------
  // WebSocket error handling
  // ---------------------------------------------------------------------------
  describe('WebSocket error handling', () => {
    it('calls onError when WebSocket fires onerror', async () => {
      const onError = vi.fn();
      render(<InteractiveTerminal machineId="m1" terminalId="t1" onError={onError} />);

      await vi.waitFor(() => {
        expect(MockWebSocket.instances).toHaveLength(1);
      });

      const ws = getWs();
      ws.onerror?.(new Event('error'));

      await vi.waitFor(() => {
        expect(onError).toHaveBeenCalledWith('WebSocket connection failed');
      });
    });

    it('writes connection closed message to terminal on ws close', async () => {
      render(<InteractiveTerminal machineId="m1" terminalId="t1" />);

      await vi.waitFor(() => {
        expect(MockWebSocket.instances).toHaveLength(1);
      });

      const ws = getWs();
      ws.simulateOpen();
      mockWrite.mockClear();
      ws.simulateClose();

      await vi.waitFor(() => {
        expect(mockWrite).toHaveBeenCalledWith(expect.stringContaining('[Connection closed]'));
      });
    });

    it('handles exit message with no code (defaults to 0)', async () => {
      const onExit = vi.fn();
      render(<InteractiveTerminal machineId="m1" terminalId="t1" onExit={onExit} />);

      await vi.waitFor(() => {
        expect(MockWebSocket.instances).toHaveLength(1);
      });

      const ws = getWs();
      ws.simulateOpen();
      ws.simulateMessage({ type: 'exit' });

      await vi.waitFor(() => {
        expect(onExit).toHaveBeenCalledWith(0);
      });
    });

    it('handles error message with no message text', async () => {
      const onError = vi.fn();
      render(<InteractiveTerminal machineId="m1" terminalId="t1" onError={onError} />);

      await vi.waitFor(() => {
        expect(MockWebSocket.instances).toHaveLength(1);
      });

      const ws = getWs();
      ws.simulateOpen();
      ws.simulateMessage({ type: 'error' });

      await vi.waitFor(() => {
        expect(onError).toHaveBeenCalledWith('Unknown error');
      });
    });

    it('writes error text to terminal', async () => {
      render(<InteractiveTerminal machineId="m1" terminalId="t1" />);

      await vi.waitFor(() => {
        expect(MockWebSocket.instances).toHaveLength(1);
      });

      const ws = getWs();
      ws.simulateOpen();
      mockWrite.mockClear();
      ws.simulateMessage({ type: 'error', message: 'disk full' });

      await vi.waitFor(() => {
        expect(mockWrite).toHaveBeenCalledWith(expect.stringContaining('[Error: disk full]'));
      });
    });

    it('writes exit message to terminal with exit code', async () => {
      render(<InteractiveTerminal machineId="m1" terminalId="t1" />);

      await vi.waitFor(() => {
        expect(MockWebSocket.instances).toHaveLength(1);
      });

      const ws = getWs();
      ws.simulateOpen();
      mockWrite.mockClear();
      ws.simulateMessage({ type: 'exit', code: 137 });

      await vi.waitFor(() => {
        expect(mockWrite).toHaveBeenCalledWith(
          expect.stringContaining('Process exited with code 137'),
        );
      });
    });

    it('silently ignores malformed JSON messages', async () => {
      render(<InteractiveTerminal machineId="m1" terminalId="t1" />);

      await vi.waitFor(() => {
        expect(MockWebSocket.instances).toHaveLength(1);
      });

      const ws = getWs();
      ws.simulateOpen();
      mockWrite.mockClear();

      // Send raw non-JSON string directly via onmessage
      ws.onmessage?.(new MessageEvent('message', { data: 'not valid json{{{' }));

      // Should not throw and should not write anything
      expect(mockWrite).not.toHaveBeenCalled();
    });

    it('ignores messages with unknown type', async () => {
      render(<InteractiveTerminal machineId="m1" terminalId="t1" />);

      await vi.waitFor(() => {
        expect(MockWebSocket.instances).toHaveLength(1);
      });

      const ws = getWs();
      ws.simulateOpen();
      mockWrite.mockClear();

      ws.simulateMessage({ type: 'unknown_type', data: 'test' });

      // Unknown types should be silently ignored — no write
      expect(mockWrite).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Cleanup on unmount
  // ---------------------------------------------------------------------------
  describe('cleanup on unmount', () => {
    it('closes WebSocket on unmount', async () => {
      const { unmount } = render(<InteractiveTerminal machineId="m1" terminalId="t1" />);

      await vi.waitFor(() => {
        expect(MockWebSocket.instances).toHaveLength(1);
      });

      const ws = getWs();
      ws.simulateOpen();

      unmount();

      expect(ws.close).toHaveBeenCalled();
    });

    it('disposes terminal on unmount', async () => {
      const { unmount } = render(<InteractiveTerminal machineId="m1" terminalId="t1" />);

      await vi.waitFor(() => {
        expect(MockWebSocket.instances).toHaveLength(1);
      });

      getWs().simulateOpen();
      mockDispose.mockClear();

      unmount();

      expect(mockDispose).toHaveBeenCalled();
    });

    it('removes window resize listener on unmount', async () => {
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

      const { unmount } = render(<InteractiveTerminal machineId="m1" terminalId="t1" />);

      await vi.waitFor(() => {
        expect(MockWebSocket.instances).toHaveLength(1);
      });

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function));

      removeEventListenerSpy.mockRestore();
    });

    it('does not process WebSocket events after unmount', async () => {
      const onExit = vi.fn();
      const onError = vi.fn();
      const { unmount } = render(
        <InteractiveTerminal machineId="m1" terminalId="t1" onExit={onExit} onError={onError} />,
      );

      await vi.waitFor(() => {
        expect(MockWebSocket.instances).toHaveLength(1);
      });

      const ws = getWs();
      ws.simulateOpen();

      unmount();

      // These should be silently ignored because `disposed` is true
      mockWrite.mockClear();
      ws.onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'output', data: 'late' }),
        }),
      );
      ws.onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'exit', code: 1 }),
        }),
      );
      ws.onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'error', message: 'late error' }),
        }),
      );
      ws.onclose?.(new CloseEvent('close'));

      expect(mockWrite).not.toHaveBeenCalled();
      expect(onExit).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    });

    it('does not call setConnected after unmount (no state update warnings)', async () => {
      const { unmount } = render(<InteractiveTerminal machineId="m1" terminalId="t1" />);

      await vi.waitFor(() => {
        expect(MockWebSocket.instances).toHaveLength(1);
      });

      const ws = getWs();
      unmount();

      // Triggering open/close after unmount should not throw
      // (the disposed flag prevents setConnected calls)
      expect(() => {
        ws.onopen?.(new Event('open'));
        ws.onclose?.(new CloseEvent('close'));
      }).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Terminal initialization
  // ---------------------------------------------------------------------------
  describe('terminal initialization', () => {
    it('loads FitAddon into the terminal', async () => {
      render(<InteractiveTerminal machineId="m1" terminalId="t1" />);

      await vi.waitFor(() => {
        expect(mockLoadAddon).toHaveBeenCalled();
      });
    });

    it('opens terminal into the container div', async () => {
      render(<InteractiveTerminal machineId="m1" terminalId="t1" />);

      await vi.waitFor(() => {
        expect(mockOpen).toHaveBeenCalled();
      });
    });

    it('fits the terminal after opening', async () => {
      render(<InteractiveTerminal machineId="m1" terminalId="t1" />);

      await vi.waitFor(() => {
        expect(mockFit).toHaveBeenCalled();
      });
    });

    it('focuses the terminal on WebSocket open', async () => {
      render(<InteractiveTerminal machineId="m1" terminalId="t1" />);

      await vi.waitFor(() => {
        expect(MockWebSocket.instances).toHaveLength(1);
      });

      mockFocus.mockClear();
      getWs().simulateOpen();

      await vi.waitFor(() => {
        expect(mockFocus).toHaveBeenCalled();
      });
    });

    it('encodes special characters in machineId and terminalId for URL', async () => {
      render(<InteractiveTerminal machineId="m/1" terminalId="t 2" />);

      await vi.waitFor(() => {
        expect(MockWebSocket.instances).toHaveLength(1);
      });

      const ws = getWs();
      expect(ws.url).toContain('/api/machines/m%2F1/terminal/t%202/ws');
    });
  });

  // ---------------------------------------------------------------------------
  // Callback ref stability
  // ---------------------------------------------------------------------------
  describe('callback ref stability', () => {
    it('uses latest onExit callback without re-creating WebSocket', async () => {
      const onExit1 = vi.fn();
      const onExit2 = vi.fn();

      const { rerender } = render(
        <InteractiveTerminal machineId="m1" terminalId="t1" onExit={onExit1} />,
      );

      await vi.waitFor(() => {
        expect(MockWebSocket.instances).toHaveLength(1);
      });

      const ws = getWs();
      ws.simulateOpen();

      // Re-render with a new onExit — should NOT create a new WebSocket
      rerender(<InteractiveTerminal machineId="m1" terminalId="t1" onExit={onExit2} />);

      // Still only 1 WebSocket instance (no reconnection)
      expect(MockWebSocket.instances).toHaveLength(1);

      ws.simulateMessage({ type: 'exit', code: 42 });

      await vi.waitFor(() => {
        expect(onExit2).toHaveBeenCalledWith(42);
      });

      // Old callback should NOT have been called
      expect(onExit1).not.toHaveBeenCalled();
    });

    it('uses latest onError callback without re-creating WebSocket', async () => {
      const onError1 = vi.fn();
      const onError2 = vi.fn();

      const { rerender } = render(
        <InteractiveTerminal machineId="m1" terminalId="t1" onError={onError1} />,
      );

      await vi.waitFor(() => {
        expect(MockWebSocket.instances).toHaveLength(1);
      });

      const ws = getWs();
      ws.simulateOpen();

      rerender(<InteractiveTerminal machineId="m1" terminalId="t1" onError={onError2} />);

      expect(MockWebSocket.instances).toHaveLength(1);

      ws.simulateMessage({ type: 'error', message: 'oops' });

      await vi.waitFor(() => {
        expect(onError2).toHaveBeenCalledWith('oops');
      });

      expect(onError1).not.toHaveBeenCalled();
    });
  });
});
