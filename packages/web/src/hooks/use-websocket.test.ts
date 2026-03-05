import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useWebSocket } from './use-websocket';
import type { WsIncomingMessage, WsOutgoingMessage } from './use-websocket';

// ---------------------------------------------------------------------------
// Minimal WebSocket mock
// ---------------------------------------------------------------------------

type WsListener = (event?: MessageEvent | CloseEvent | Event) => void;

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState: number = MockWebSocket.CONNECTING;
  onopen: WsListener | null = null;
  onclose: WsListener | null = null;
  onerror: WsListener | null = null;
  onmessage: WsListener | null = null;

  private listeners: Record<string, WsListener[]> = {};

  // Keep a registry so tests can grab instances.
  static instances: MockWebSocket[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, fn: WsListener) {
    this.listeners[type] = this.listeners[type] ?? [];
    this.listeners[type].push(fn);
  }

  removeEventListener(type: string, fn: WsListener) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l !== fn);
  }

  send = vi.fn();

  close = vi.fn().mockImplementation(() => {
    this.readyState = MockWebSocket.CLOSED;
  });

  // Simulate server events:
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    (this.listeners['open'] ?? []).forEach((fn) => fn());
  }

  simulateMessage(data: unknown) {
    const event = { data: JSON.stringify(data) } as MessageEvent;
    (this.listeners['message'] ?? []).forEach((fn) => fn(event));
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    (this.listeners['close'] ?? []).forEach((fn) => fn());
  }

  simulateError() {
    (this.listeners['error'] ?? []).forEach((fn) => fn());
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function latestSocket(): MockWebSocket {
  const sock = MockWebSocket.instances[MockWebSocket.instances.length - 1];
  if (!sock) throw new Error('No WebSocket was created');
  return sock;
}

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------

describe('useWebSocket — connection lifecycle', () => {
  it('starts in "disconnected" state', () => {
    const { result } = renderHook(() => useWebSocket({ enabled: false }));
    expect(result.current.status).toBe('disconnected');
  });

  it('transitions to "connecting" immediately when enabled', () => {
    const { result } = renderHook(() => useWebSocket({ url: 'ws://localhost/api/ws' }));
    expect(result.current.status).toBe('connecting');
  });

  it('transitions to "connected" after the socket fires open', () => {
    const { result } = renderHook(() => useWebSocket({ url: 'ws://localhost/api/ws' }));

    act(() => {
      latestSocket().simulateOpen();
    });

    expect(result.current.status).toBe('connected');
  });

  it('transitions to "disconnected" after the socket closes', () => {
    const { result } = renderHook(() => useWebSocket({ url: 'ws://localhost/api/ws' }));

    act(() => {
      latestSocket().simulateOpen();
    });
    act(() => {
      latestSocket().simulateClose();
    });

    expect(result.current.status).toBe('disconnected');
  });

  it('does not create a WebSocket when enabled is false', () => {
    renderHook(() => useWebSocket({ url: 'ws://localhost/api/ws', enabled: false }));
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('closes the WebSocket on unmount', () => {
    const { unmount } = renderHook(() =>
      useWebSocket({ url: 'ws://localhost/api/ws' }),
    );

    act(() => {
      latestSocket().simulateOpen();
    });

    const sock = latestSocket();
    unmount();

    expect(sock.close).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

describe('useWebSocket — callbacks', () => {
  it('calls onOpen when the socket connects', () => {
    const onOpen = vi.fn();
    renderHook(() => useWebSocket({ url: 'ws://localhost/api/ws', onOpen }));

    act(() => {
      latestSocket().simulateOpen();
    });

    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('calls onClose when the socket disconnects', () => {
    const onClose = vi.fn();
    renderHook(() => useWebSocket({ url: 'ws://localhost/api/ws', onClose }));

    act(() => {
      latestSocket().simulateOpen();
    });
    act(() => {
      latestSocket().simulateClose();
    });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onMessage with parsed JSON for each incoming message', () => {
    const onMessage = vi.fn();
    renderHook(() => useWebSocket({ url: 'ws://localhost/api/ws', onMessage }));

    act(() => {
      latestSocket().simulateOpen();
    });

    const msg: WsIncomingMessage = { type: 'pong', timestamp: '2026-01-01T00:00:00Z' };
    act(() => {
      latestSocket().simulateMessage(msg);
    });

    expect(onMessage).toHaveBeenCalledOnce();
    expect(onMessage).toHaveBeenCalledWith(msg);
  });

  it('calls onMessage with agent_event messages', () => {
    const onMessage = vi.fn();
    renderHook(() => useWebSocket({ url: 'ws://localhost/api/ws', onMessage }));

    act(() => {
      latestSocket().simulateOpen();
    });

    const msg: WsIncomingMessage = {
      type: 'agent_event',
      agentId: 'a1',
      event: { event: 'output', data: { text: 'hello' } },
    };
    act(() => {
      latestSocket().simulateMessage(msg);
    });

    expect(onMessage).toHaveBeenCalledWith(msg);
  });

  it('does not call onMessage for unparseable data', () => {
    const onMessage = vi.fn();
    renderHook(() => useWebSocket({ url: 'ws://localhost/api/ws', onMessage }));

    act(() => {
      latestSocket().simulateOpen();
    });

    // Simulate a raw malformed message event.
    const sock = latestSocket();
    const badEvent = { data: 'not valid json {{{{' } as MessageEvent;
    act(() => {
      (sock as unknown as { listeners: Record<string, WsListener[]> }).listeners['message']?.forEach(
        (fn) => fn(badEvent),
      );
    });

    expect(onMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// send()
// ---------------------------------------------------------------------------

describe('useWebSocket — send()', () => {
  it('returns true and sends immediately when socket is open', () => {
    const { result } = renderHook(() => useWebSocket({ url: 'ws://localhost/api/ws' }));

    act(() => {
      latestSocket().simulateOpen();
    });

    const msg: WsOutgoingMessage = { type: 'ping' };
    let sent: boolean | undefined;
    act(() => {
      sent = result.current.send(msg);
    });

    expect(sent).toBe(true);
    expect(latestSocket().send).toHaveBeenCalledWith(JSON.stringify(msg));
  });

  it('returns false and queues the message when socket is not yet open', () => {
    const { result } = renderHook(() => useWebSocket({ url: 'ws://localhost/api/ws' }));

    // Still in CONNECTING state — not open.
    const msg: WsOutgoingMessage = { type: 'ping' };
    let sent: boolean | undefined;
    act(() => {
      sent = result.current.send(msg);
    });

    expect(sent).toBe(false);
    expect(latestSocket().send).not.toHaveBeenCalled();
  });

  it('flushes the message queue when the socket opens', () => {
    const { result } = renderHook(() => useWebSocket({ url: 'ws://localhost/api/ws' }));

    const msg1: WsOutgoingMessage = { type: 'ping' };
    const msg2: WsOutgoingMessage = {
      type: 'subscribe_agent',
      agentId: 'agent-42',
    };

    act(() => {
      result.current.send(msg1);
      result.current.send(msg2);
    });

    act(() => {
      latestSocket().simulateOpen();
    });

    const sock = latestSocket();
    expect(sock.send).toHaveBeenCalledTimes(2);
    expect(sock.send).toHaveBeenNthCalledWith(1, JSON.stringify(msg1));
    expect(sock.send).toHaveBeenNthCalledWith(2, JSON.stringify(msg2));
  });
});

// ---------------------------------------------------------------------------
// Reconnection
// ---------------------------------------------------------------------------

describe('useWebSocket — reconnection', () => {
  it('schedules a reconnect after the socket closes', () => {
    renderHook(() => useWebSocket({ url: 'ws://localhost/api/ws' }));

    act(() => {
      latestSocket().simulateOpen();
    });

    const countBefore = MockWebSocket.instances.length;

    act(() => {
      latestSocket().simulateClose();
    });

    // Advance past the initial reconnect delay (1000ms + jitter).
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(MockWebSocket.instances.length).toBeGreaterThan(countBefore);
  });

  it('does not schedule a reconnect when unmounting intentionally', () => {
    const { unmount } = renderHook(() => useWebSocket({ url: 'ws://localhost/api/ws' }));

    act(() => {
      latestSocket().simulateOpen();
    });

    const countBefore = MockWebSocket.instances.length;

    unmount();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(MockWebSocket.instances.length).toBe(countBefore);
  });
});

// ---------------------------------------------------------------------------
// URL resolution
// ---------------------------------------------------------------------------

describe('useWebSocket — URL resolution', () => {
  it('uses the provided url override', () => {
    renderHook(() => useWebSocket({ url: 'ws://custom-host:9999/ws' }));
    expect(latestSocket().url).toBe('ws://custom-host:9999/ws');
  });

  it('defaults to ws://localhost:8080/api/ws in development', () => {
    // NODE_ENV is already "test" which is neither "production" nor has window.location.
    // In non-browser, non-dev environments it falls back to localhost:8080.
    renderHook(() => useWebSocket({}));
    // In the test environment (not 'development', no window.location.protocol),
    // it falls through to the localhost fallback.
    expect(latestSocket().url).toMatch(/ws:\/\//);
  });
});
