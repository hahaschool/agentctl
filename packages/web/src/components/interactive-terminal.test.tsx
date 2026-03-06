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

describe('InteractiveTerminal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockWebSocket.instances = [];
  });

  it('renders the container div', () => {
    const { container } = render(
      <InteractiveTerminal machineId="m1" terminalId="t1" />,
    );
    expect(container.firstChild).toBeDefined();
  });

  it('has the terminal container with bg-[#0a0a0a] class', () => {
    const { container } = render(
      <InteractiveTerminal machineId="m1" terminalId="t1" />,
    );
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
      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'resize', cols: 80, rows: 24 }),
      );
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
    render(
      <InteractiveTerminal machineId="m1" terminalId="t1" onExit={onExit} />,
    );

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
    render(
      <InteractiveTerminal machineId="m1" terminalId="t1" onError={onError} />,
    );

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
});
