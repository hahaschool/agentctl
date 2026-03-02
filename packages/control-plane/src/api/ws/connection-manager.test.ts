import type { WsServerMessage } from '@agentctl/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';

import { WsConnectionManager } from './connection-manager.js';

// ---------------------------------------------------------------------------
// Mock WebSocket factory
// ---------------------------------------------------------------------------

function createMockSocket(overrides?: Partial<WebSocket>): WebSocket {
  const OPEN = 1;
  const mock = {
    OPEN,
    readyState: OPEN,
    send: vi.fn(),
    ping: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
    ...overrides,
  };
  return mock as unknown as WebSocket;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WsConnectionManager', () => {
  let manager: WsConnectionManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new WsConnectionManager({
      heartbeatIntervalMs: 1000,
      heartbeatTimeoutMs: 500,
    });
  });

  afterEach(() => {
    manager.shutdown();
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // Add / Remove connections
  // -----------------------------------------------------------------------

  describe('add and remove', () => {
    it('adds a connection and lists its ID', () => {
      const socket = createMockSocket();
      manager.add('conn-1', socket);

      expect(manager.getConnectionIds()).toEqual(['conn-1']);
    });

    it('adds multiple connections', () => {
      manager.add('c1', createMockSocket());
      manager.add('c2', createMockSocket());
      manager.add('c3', createMockSocket());

      expect(manager.getConnectionIds()).toHaveLength(3);
      expect(manager.getConnectionIds()).toContain('c1');
      expect(manager.getConnectionIds()).toContain('c2');
      expect(manager.getConnectionIds()).toContain('c3');
    });

    it('removes a connection', () => {
      manager.add('conn-1', createMockSocket());
      manager.add('conn-2', createMockSocket());
      manager.remove('conn-1');

      expect(manager.getConnectionIds()).toEqual(['conn-2']);
    });

    it('removing a non-existent connection is a no-op', () => {
      manager.add('conn-1', createMockSocket());
      manager.remove('conn-999');

      expect(manager.getConnectionIds()).toEqual(['conn-1']);
    });

    it('returns an empty array when no connections exist', () => {
      expect(manager.getConnectionIds()).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Subscribe / Unsubscribe
  // -----------------------------------------------------------------------

  describe('subscribe and unsubscribe', () => {
    it('subscribes a connection to an agent', () => {
      manager.add('conn-1', createMockSocket());
      manager.subscribe('conn-1', 'agent-a');

      expect(manager.getSubscribers('agent-a')).toEqual(['conn-1']);
    });

    it('subscribes multiple connections to the same agent', () => {
      manager.add('c1', createMockSocket());
      manager.add('c2', createMockSocket());
      manager.subscribe('c1', 'agent-a');
      manager.subscribe('c2', 'agent-a');

      const subs = manager.getSubscribers('agent-a');
      expect(subs).toHaveLength(2);
      expect(subs).toContain('c1');
      expect(subs).toContain('c2');
    });

    it('subscribes a connection to multiple agents', () => {
      manager.add('conn-1', createMockSocket());
      manager.subscribe('conn-1', 'agent-a');
      manager.subscribe('conn-1', 'agent-b');

      expect(manager.getSubscribers('agent-a')).toEqual(['conn-1']);
      expect(manager.getSubscribers('agent-b')).toEqual(['conn-1']);
    });

    it('unsubscribes a connection from an agent', () => {
      manager.add('conn-1', createMockSocket());
      manager.subscribe('conn-1', 'agent-a');
      manager.unsubscribe('conn-1', 'agent-a');

      expect(manager.getSubscribers('agent-a')).toEqual([]);
    });

    it('unsubscribing from an agent the connection is not subscribed to is a no-op', () => {
      manager.add('conn-1', createMockSocket());
      manager.subscribe('conn-1', 'agent-a');
      manager.unsubscribe('conn-1', 'agent-b');

      expect(manager.getSubscribers('agent-a')).toEqual(['conn-1']);
    });

    it('subscribing a non-existent connection is a no-op', () => {
      manager.subscribe('ghost', 'agent-a');
      expect(manager.getSubscribers('agent-a')).toEqual([]);
    });

    it('unsubscribing a non-existent connection is a no-op', () => {
      manager.unsubscribe('ghost', 'agent-a');
      expect(manager.getSubscribers('agent-a')).toEqual([]);
    });

    it('returns empty subscribers for an agent nobody is subscribed to', () => {
      manager.add('conn-1', createMockSocket());
      expect(manager.getSubscribers('unrelated-agent')).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Broadcast
  // -----------------------------------------------------------------------

  describe('broadcast', () => {
    it('sends a message only to connections subscribed to the agent', () => {
      const sock1 = createMockSocket();
      const sock2 = createMockSocket();
      const sock3 = createMockSocket();

      manager.add('c1', sock1);
      manager.add('c2', sock2);
      manager.add('c3', sock3);

      manager.subscribe('c1', 'agent-a');
      manager.subscribe('c2', 'agent-a');
      // c3 is NOT subscribed to agent-a

      const msg: WsServerMessage = {
        type: 'agent:output',
        agentId: 'agent-a',
        data: 'hello',
        stream: 'stdout',
      };

      manager.broadcast('agent-a', msg);

      const expected = JSON.stringify(msg);
      expect(sock1.send).toHaveBeenCalledWith(expected);
      expect(sock2.send).toHaveBeenCalledWith(expected);
      expect(sock3.send).not.toHaveBeenCalled();
    });

    it('does not send to connections with closed sockets', () => {
      const openSock = createMockSocket();
      const closedSock = createMockSocket({ readyState: 3 }); // CLOSED = 3

      manager.add('c1', openSock);
      manager.add('c2', closedSock);

      manager.subscribe('c1', 'agent-a');
      manager.subscribe('c2', 'agent-a');

      const msg: WsServerMessage = { type: 'agent:status', agentId: 'agent-a', status: 'running' };
      manager.broadcast('agent-a', msg);

      expect(openSock.send).toHaveBeenCalledTimes(1);
      expect(closedSock.send).not.toHaveBeenCalled();
    });

    it('broadcasting to an agent with no subscribers sends nothing', () => {
      const sock = createMockSocket();
      manager.add('c1', sock);
      manager.subscribe('c1', 'agent-a');

      manager.broadcast('agent-b', { type: 'pong' });

      expect(sock.send).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Send (to specific connection)
  // -----------------------------------------------------------------------

  describe('send', () => {
    it('sends a message to a specific connection', () => {
      const sock1 = createMockSocket();
      const sock2 = createMockSocket();

      manager.add('c1', sock1);
      manager.add('c2', sock2);

      const msg: WsServerMessage = { type: 'pong' };
      manager.send('c1', msg);

      expect(sock1.send).toHaveBeenCalledWith(JSON.stringify(msg));
      expect(sock2.send).not.toHaveBeenCalled();
    });

    it('does not throw when sending to a non-existent connection', () => {
      expect(() => {
        manager.send('ghost', { type: 'pong' });
      }).not.toThrow();
    });

    it('does not send to a connection whose socket is closed', () => {
      const sock = createMockSocket({ readyState: 3 });
      manager.add('c1', sock);

      manager.send('c1', { type: 'pong' });

      expect(sock.send).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Heartbeat
  // -----------------------------------------------------------------------

  describe('heartbeat', () => {
    it('pings all open connections on each interval tick', () => {
      const sock1 = createMockSocket();
      const sock2 = createMockSocket();

      manager.add('c1', sock1);
      manager.add('c2', sock2);

      manager.startHeartbeat();
      vi.advanceTimersByTime(1000);

      expect(sock1.ping).toHaveBeenCalledTimes(1);
      expect(sock2.ping).toHaveBeenCalledTimes(1);
    });

    it('marks connections as not alive after a ping', () => {
      const sock = createMockSocket();
      manager.add('c1', sock);

      manager.startHeartbeat();
      vi.advanceTimersByTime(1000);

      const conn = manager.getConnection('c1');
      expect(conn?.isAlive).toBe(false);
    });

    it('terminates connections that do not respond within the timeout', () => {
      const sock = createMockSocket();
      manager.add('c1', sock);

      manager.startHeartbeat();

      // First tick: sets isAlive = false, sends ping
      vi.advanceTimersByTime(1000);
      expect(sock.ping).toHaveBeenCalledTimes(1);
      expect(manager.getConnection('c1')?.isAlive).toBe(false);

      // Second tick: isAlive is still false, timeout exceeded → terminate
      vi.advanceTimersByTime(1000);
      expect(sock.terminate).toHaveBeenCalledTimes(1);
      expect(manager.getConnectionIds()).not.toContain('c1');
    });

    it('keeps alive connections that respond between heartbeats', () => {
      const sock = createMockSocket();
      manager.add('c1', sock);

      manager.startHeartbeat();

      // First tick: marks as not alive
      vi.advanceTimersByTime(1000);
      expect(manager.getConnection('c1')?.isAlive).toBe(false);

      // Simulate pong response
      manager.markAlive('c1');
      expect(manager.getConnection('c1')?.isAlive).toBe(true);

      // Second tick: should NOT terminate because isAlive was reset
      vi.advanceTimersByTime(1000);
      expect(sock.terminate).not.toHaveBeenCalled();
      expect(manager.getConnectionIds()).toContain('c1');
    });

    it('does not start multiple heartbeat intervals', () => {
      const sock = createMockSocket();
      manager.add('c1', sock);

      manager.startHeartbeat();
      manager.startHeartbeat(); // second call should be ignored

      vi.advanceTimersByTime(1000);

      // Should only have been pinged once, not twice
      expect(sock.ping).toHaveBeenCalledTimes(1);
    });

    it('does not ping closed sockets', () => {
      const sock = createMockSocket({ readyState: 3 });
      manager.add('c1', sock);

      manager.startHeartbeat();
      vi.advanceTimersByTime(1000);

      expect(sock.ping).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Shutdown
  // -----------------------------------------------------------------------

  describe('shutdown', () => {
    it('closes all connections', () => {
      const sock1 = createMockSocket();
      const sock2 = createMockSocket();

      manager.add('c1', sock1);
      manager.add('c2', sock2);

      manager.shutdown();

      expect(sock1.close).toHaveBeenCalledTimes(1);
      expect(sock2.close).toHaveBeenCalledTimes(1);
      expect(manager.getConnectionIds()).toEqual([]);
    });

    it('stops the heartbeat timer', () => {
      const sock = createMockSocket();
      manager.add('c1', sock);

      manager.startHeartbeat();
      manager.shutdown();

      // Advance timers — no more pings should be sent after shutdown
      vi.advanceTimersByTime(5000);
      expect(sock.ping).not.toHaveBeenCalled();
    });

    it('can be called multiple times without error', () => {
      manager.add('c1', createMockSocket());

      expect(() => {
        manager.shutdown();
        manager.shutdown();
      }).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // Multi-agent, multi-connection scenarios
  // -----------------------------------------------------------------------

  describe('multi-agent and multi-connection', () => {
    it('routes messages to correct subscribers across agents', () => {
      const sock1 = createMockSocket();
      const sock2 = createMockSocket();
      const sock3 = createMockSocket();

      manager.add('c1', sock1);
      manager.add('c2', sock2);
      manager.add('c3', sock3);

      manager.subscribe('c1', 'agent-a');
      manager.subscribe('c2', 'agent-a');
      manager.subscribe('c2', 'agent-b');
      manager.subscribe('c3', 'agent-b');

      const msgA: WsServerMessage = {
        type: 'agent:output',
        agentId: 'agent-a',
        data: 'from A',
        stream: 'stdout',
      };
      const msgB: WsServerMessage = {
        type: 'agent:output',
        agentId: 'agent-b',
        data: 'from B',
        stream: 'stderr',
      };

      manager.broadcast('agent-a', msgA);
      manager.broadcast('agent-b', msgB);

      // c1: subscribed to agent-a only
      expect(sock1.send).toHaveBeenCalledTimes(1);
      expect(sock1.send).toHaveBeenCalledWith(JSON.stringify(msgA));

      // c2: subscribed to both
      expect(sock2.send).toHaveBeenCalledTimes(2);
      expect(sock2.send).toHaveBeenCalledWith(JSON.stringify(msgA));
      expect(sock2.send).toHaveBeenCalledWith(JSON.stringify(msgB));

      // c3: subscribed to agent-b only
      expect(sock3.send).toHaveBeenCalledTimes(1);
      expect(sock3.send).toHaveBeenCalledWith(JSON.stringify(msgB));
    });

    it('removing a connection clears it from all agent subscriber lists', () => {
      manager.add('c1', createMockSocket());
      manager.subscribe('c1', 'agent-a');
      manager.subscribe('c1', 'agent-b');

      manager.remove('c1');

      expect(manager.getSubscribers('agent-a')).toEqual([]);
      expect(manager.getSubscribers('agent-b')).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Default options
  // -----------------------------------------------------------------------

  describe('default options', () => {
    it('constructs with default heartbeat settings when no options provided', () => {
      const defaultManager = new WsConnectionManager();

      // Should not throw when starting heartbeat with defaults
      expect(() => {
        defaultManager.startHeartbeat();
        defaultManager.shutdown();
      }).not.toThrow();
    });
  });
});
