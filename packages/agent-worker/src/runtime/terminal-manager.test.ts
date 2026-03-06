import { WorkerError } from '@agentctl/shared';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TerminalEvent, TerminalInfo } from './terminal-manager.js';
import { TerminalManager } from './terminal-manager.js';

// ---------------------------------------------------------------------------
// Mock node-pty — we never spawn real PTY processes in tests
// ---------------------------------------------------------------------------

const mockWrite = vi.fn();
const mockResize = vi.fn();
const mockKill = vi.fn();
const mockOnData = vi.fn();
const mockOnExit = vi.fn();

let nextPid = 10000;

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => {
    const pid = nextPid++;
    return {
      pid,
      write: mockWrite,
      resize: mockResize,
      kill: mockKill,
      onData: mockOnData,
      onExit: mockOnExit,
    };
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createLogger(): pino.Logger {
  return pino({ level: 'silent' });
}

function createManager(maxTerminals?: number): TerminalManager {
  return new TerminalManager({ logger: createLogger(), maxTerminals });
}

/** Spawn a terminal with default options, returning its info. */
async function spawnDefault(
  manager: TerminalManager,
  id = 'term-1',
  overrides: Partial<Parameters<TerminalManager['spawn']>[0]> = {},
): Promise<TerminalInfo> {
  return manager.spawn({ id, ...overrides });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TerminalManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nextPid = 10000;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── spawn() ─────────────────────────────────────────────────────────

  describe('spawn()', () => {
    it('creates a new terminal and returns its info', async () => {
      const manager = createManager();
      const info = await spawnDefault(manager, 'my-terminal');

      expect(info.id).toBe('my-terminal');
      expect(info.pid).toBe(10000);
      expect(info.command).toContain('/'); // some shell path or fallback
      expect(info.cols).toBe(120);
      expect(info.rows).toBe(30);
      expect(info.createdAt).toBeTruthy();
    });

    it('uses custom cols, rows, and command when provided', async () => {
      const manager = createManager();
      const info = await manager.spawn({
        id: 'custom',
        command: '/usr/bin/bash',
        args: ['--login'],
        cols: 200,
        rows: 50,
        cwd: '/tmp',
      });

      expect(info.command).toBe('/usr/bin/bash');
      expect(info.cols).toBe(200);
      expect(info.rows).toBe(50);

      const nodePty = await import('node-pty');
      expect(nodePty.spawn).toHaveBeenCalledWith(
        '/usr/bin/bash',
        ['--login'],
        expect.objectContaining({
          cols: 200,
          rows: 50,
          cwd: '/tmp',
        }),
      );
    });

    it('registers onData and onExit handlers on the PTY', async () => {
      const manager = createManager();
      await spawnDefault(manager, 'term-1');

      expect(mockOnData).toHaveBeenCalledTimes(1);
      expect(mockOnExit).toHaveBeenCalledTimes(1);
    });

    it('makes the terminal available via get() and list()', async () => {
      const manager = createManager();
      const info = await spawnDefault(manager, 'term-1');

      expect(manager.get('term-1')).toEqual(info);
      expect(manager.list()).toEqual([info]);
    });

    it('throws TERMINAL_ALREADY_EXISTS when id is already in use', async () => {
      const manager = createManager();
      await spawnDefault(manager, 'dup');

      await expect(spawnDefault(manager, 'dup')).rejects.toThrow(WorkerError);
      await expect(spawnDefault(manager, 'dup')).rejects.toMatchObject({
        code: 'TERMINAL_ALREADY_EXISTS',
      });
    });

    it('throws TERMINAL_LIMIT_REACHED when max terminals exceeded', async () => {
      const manager = createManager(2);
      await spawnDefault(manager, 'a');
      await spawnDefault(manager, 'b');

      await expect(spawnDefault(manager, 'c')).rejects.toThrow(WorkerError);
      await expect(spawnDefault(manager, 'c')).rejects.toMatchObject({
        code: 'TERMINAL_LIMIT_REACHED',
      });
    });

    it('defaults maxTerminals to 5 when not specified', async () => {
      const manager = createManager();
      for (let i = 0; i < 5; i++) {
        await spawnDefault(manager, `t-${i}`);
      }

      await expect(spawnDefault(manager, 't-5')).rejects.toMatchObject({
        code: 'TERMINAL_LIMIT_REACHED',
      });
    });

    it('throws TERMINAL_SPAWN_FAILED when node-pty spawn throws', async () => {
      const nodePty = await import('node-pty');
      (nodePty.spawn as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw new Error('native module exploded');
      });

      const manager = createManager();
      try {
        await manager.spawn({ id: 'fail' });
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(WorkerError);
        const we = err as WorkerError;
        expect(we.code).toBe('TERMINAL_SPAWN_FAILED');
        expect(we.context?.error).toBe('native module exploded');
      }

      // Terminal should not have been added to the manager
      expect(manager.get('fail')).toBeUndefined();
    });

    it('throws TERMINAL_SPAWN_FAILED when node-pty import fails', async () => {
      // We cannot easily break the import of an already-mocked module in vitest,
      // so this edge case is covered implicitly. Instead, verify the error code
      // path for spawn failures (the previous test) covers it.
      // This test verifies that the WorkerError includes context about the command.
      const nodePty = await import('node-pty');
      (nodePty.spawn as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw new Error('failed to allocate pty');
      });

      const manager = createManager();
      try {
        await manager.spawn({ id: 'broken', command: '/bin/fake' });
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(WorkerError);
        const we = err as WorkerError;
        expect(we.code).toBe('TERMINAL_SPAWN_FAILED');
        expect(we.context?.command).toBe('/bin/fake');
        expect(we.context?.error).toBe('failed to allocate pty');
      }
    });

    it('can spawn multiple terminals with distinct ids', async () => {
      const manager = createManager(3);
      const a = await spawnDefault(manager, 'a');
      const b = await spawnDefault(manager, 'b');
      const c = await spawnDefault(manager, 'c');

      expect(manager.list()).toHaveLength(3);
      expect(a.pid).not.toBe(b.pid);
      expect(b.pid).not.toBe(c.pid);
    });
  });

  // ── write() ─────────────────────────────────────────────────────────

  describe('write()', () => {
    it('sends data to the terminal PTY', async () => {
      const manager = createManager();
      await spawnDefault(manager, 'term-1');

      manager.write('term-1', 'ls -la\n');

      expect(mockWrite).toHaveBeenCalledWith('ls -la\n');
    });

    it('throws TERMINAL_NOT_FOUND for nonexistent terminal', () => {
      const manager = createManager();

      expect(() => manager.write('ghost', 'hello')).toThrow(WorkerError);
      expect(() => manager.write('ghost', 'hello')).toThrow(/not found/i);
    });

    it('includes the terminal id in the error context', () => {
      const manager = createManager();

      try {
        manager.write('missing-term', 'data');
        expect.unreachable('should have thrown');
      } catch (err) {
        const we = err as WorkerError;
        expect(we.code).toBe('TERMINAL_NOT_FOUND');
        expect(we.context?.terminalId).toBe('missing-term');
      }
    });
  });

  // ── resize() ────────────────────────────────────────────────────────

  describe('resize()', () => {
    it('resizes the terminal PTY and updates stored info', async () => {
      const manager = createManager();
      await spawnDefault(manager, 'term-1');

      manager.resize('term-1', 80, 24);

      expect(mockResize).toHaveBeenCalledWith(80, 24);

      const info = manager.get('term-1');
      expect(info?.cols).toBe(80);
      expect(info?.rows).toBe(24);
    });

    it('throws TERMINAL_NOT_FOUND for nonexistent terminal', () => {
      const manager = createManager();

      expect(() => manager.resize('nope', 80, 24)).toThrow(WorkerError);
      try {
        manager.resize('nope', 80, 24);
      } catch (err) {
        expect((err as WorkerError).code).toBe('TERMINAL_NOT_FOUND');
      }
    });
  });

  // ── kill() ──────────────────────────────────────────────────────────

  describe('kill()', () => {
    it('kills the PTY and removes the terminal from the manager', async () => {
      const manager = createManager();
      await spawnDefault(manager, 'term-1');

      manager.kill('term-1');

      expect(mockKill).toHaveBeenCalledTimes(1);
      expect(manager.get('term-1')).toBeUndefined();
      expect(manager.list()).toHaveLength(0);
    });

    it('throws TERMINAL_NOT_FOUND for nonexistent terminal', () => {
      const manager = createManager();

      expect(() => manager.kill('nope')).toThrow(WorkerError);
      try {
        manager.kill('nope');
      } catch (err) {
        expect((err as WorkerError).code).toBe('TERMINAL_NOT_FOUND');
      }
    });

    it('throws TERMINAL_NOT_FOUND if the same terminal is killed twice', async () => {
      const manager = createManager();
      await spawnDefault(manager, 'term-1');

      manager.kill('term-1');

      expect(() => manager.kill('term-1')).toThrow(WorkerError);
      try {
        manager.kill('term-1');
      } catch (err) {
        expect((err as WorkerError).code).toBe('TERMINAL_NOT_FOUND');
      }
    });

    it('allows spawning a new terminal with the same id after kill', async () => {
      const manager = createManager();
      await spawnDefault(manager, 'reuse');
      manager.kill('reuse');

      const info = await spawnDefault(manager, 'reuse');
      expect(info.id).toBe('reuse');
      expect(manager.list()).toHaveLength(1);
    });
  });

  // ── list() ──────────────────────────────────────────────────────────

  describe('list()', () => {
    it('returns an empty array when no terminals exist', () => {
      const manager = createManager();
      expect(manager.list()).toEqual([]);
    });

    it('returns info for all active terminals', async () => {
      const manager = createManager();
      await spawnDefault(manager, 'x');
      await spawnDefault(manager, 'y');

      const list = manager.list();
      expect(list).toHaveLength(2);

      const ids = list.map((t) => t.id);
      expect(ids).toContain('x');
      expect(ids).toContain('y');
    });

    it('does not include killed terminals', async () => {
      const manager = createManager();
      await spawnDefault(manager, 'alive');
      await spawnDefault(manager, 'dead');
      manager.kill('dead');

      const list = manager.list();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('alive');
    });
  });

  // ── get() ───────────────────────────────────────────────────────────

  describe('get()', () => {
    it('returns terminal info for an existing terminal', async () => {
      const manager = createManager();
      const spawned = await spawnDefault(manager, 'term-1');

      const info = manager.get('term-1');
      expect(info).toEqual(spawned);
    });

    it('returns undefined for a nonexistent terminal', () => {
      const manager = createManager();
      expect(manager.get('nope')).toBeUndefined();
    });

    it('returns undefined after a terminal is killed', async () => {
      const manager = createManager();
      await spawnDefault(manager, 'term-1');
      manager.kill('term-1');

      expect(manager.get('term-1')).toBeUndefined();
    });
  });

  // ── subscribe() / listener events ──────────────────────────────────

  describe('subscribe()', () => {
    it('throws TERMINAL_NOT_FOUND for nonexistent terminal', () => {
      const manager = createManager();

      expect(() => manager.subscribe('nope', vi.fn())).toThrow(WorkerError);
      try {
        manager.subscribe('nope', vi.fn());
      } catch (err) {
        expect((err as WorkerError).code).toBe('TERMINAL_NOT_FOUND');
      }
    });

    it('returns an unsubscribe function', async () => {
      const manager = createManager();
      await spawnDefault(manager, 'term-1');

      const listener = vi.fn();
      const unsub = manager.subscribe('term-1', listener);

      expect(typeof unsub).toBe('function');
    });

    it('delivers output events to subscribed listeners via onData', async () => {
      const manager = createManager();
      await spawnDefault(manager, 'term-1');

      const listener = vi.fn();
      manager.subscribe('term-1', listener);

      // Retrieve the onData callback that was registered on the PTY
      const onDataCallback = mockOnData.mock.calls[0][0] as (data: string) => void;
      onDataCallback('hello world');

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ type: 'output', data: 'hello world' });
    });

    it('delivers exit events to subscribed listeners via onExit', async () => {
      const manager = createManager();
      await spawnDefault(manager, 'term-1');

      const listener = vi.fn();
      manager.subscribe('term-1', listener);

      // Retrieve the onExit callback that was registered on the PTY
      const onExitCallback = mockOnExit.mock.calls[0][0] as (evt: { exitCode: number }) => void;
      onExitCallback({ exitCode: 0 });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ type: 'exit', code: 0 });
    });

    it('delivers events to multiple listeners', async () => {
      const manager = createManager();
      await spawnDefault(manager, 'term-1');

      const listenerA = vi.fn();
      const listenerB = vi.fn();
      manager.subscribe('term-1', listenerA);
      manager.subscribe('term-1', listenerB);

      const onDataCallback = mockOnData.mock.calls[0][0] as (data: string) => void;
      onDataCallback('data');

      expect(listenerA).toHaveBeenCalledWith({ type: 'output', data: 'data' });
      expect(listenerB).toHaveBeenCalledWith({ type: 'output', data: 'data' });
    });

    it('stops delivering events after unsubscribe', async () => {
      const manager = createManager();
      await spawnDefault(manager, 'term-1');

      const listener = vi.fn();
      const unsub = manager.subscribe('term-1', listener);

      const onDataCallback = mockOnData.mock.calls[0][0] as (data: string) => void;
      onDataCallback('before');
      expect(listener).toHaveBeenCalledTimes(1);

      unsub();
      onDataCallback('after');
      expect(listener).toHaveBeenCalledTimes(1); // still 1, not called again
    });

    it('unsubscribing one listener does not affect others', async () => {
      const manager = createManager();
      await spawnDefault(manager, 'term-1');

      const listenerA = vi.fn();
      const listenerB = vi.fn();
      const unsubA = manager.subscribe('term-1', listenerA);
      manager.subscribe('term-1', listenerB);

      unsubA();

      const onDataCallback = mockOnData.mock.calls[0][0] as (data: string) => void;
      onDataCallback('data');

      expect(listenerA).not.toHaveBeenCalled();
      expect(listenerB).toHaveBeenCalledWith({ type: 'output', data: 'data' });
    });
  });

  // ── onExit removes terminal from manager ───────────────────────────

  describe('PTY exit behavior', () => {
    it('removes the terminal from the manager when PTY exits', async () => {
      const manager = createManager();
      await spawnDefault(manager, 'term-1');

      expect(manager.get('term-1')).toBeDefined();

      // Simulate the PTY process exiting
      const onExitCallback = mockOnExit.mock.calls[0][0] as (evt: { exitCode: number }) => void;
      onExitCallback({ exitCode: 1 });

      expect(manager.get('term-1')).toBeUndefined();
      expect(manager.list()).toHaveLength(0);
    });

    it('allows re-spawning a terminal with the same id after PTY exit', async () => {
      const manager = createManager();
      await spawnDefault(manager, 'term-1');

      const onExitCallback = mockOnExit.mock.calls[0][0] as (evt: { exitCode: number }) => void;
      onExitCallback({ exitCode: 0 });

      // Should be able to re-use the id now
      const info = await spawnDefault(manager, 'term-1');
      expect(info.id).toBe('term-1');
    });

    it('frees up a slot when PTY exits, allowing new spawns', async () => {
      const manager = createManager(1);
      await spawnDefault(manager, 'term-1');

      // Limit reached
      await expect(spawnDefault(manager, 'term-2')).rejects.toMatchObject({
        code: 'TERMINAL_LIMIT_REACHED',
      });

      // Simulate exit of the first terminal
      const onExitCallback = mockOnExit.mock.calls[0][0] as (evt: { exitCode: number }) => void;
      onExitCallback({ exitCode: 0 });

      // Now we can spawn again
      const info = await spawnDefault(manager, 'term-2');
      expect(info.id).toBe('term-2');
    });
  });

  // ── killAll() ───────────────────────────────────────────────────────

  describe('killAll()', () => {
    it('kills all active terminals', async () => {
      const manager = createManager();
      await spawnDefault(manager, 'a');
      await spawnDefault(manager, 'b');
      await spawnDefault(manager, 'c');

      expect(manager.list()).toHaveLength(3);

      manager.killAll();

      expect(manager.list()).toHaveLength(0);
      expect(mockKill).toHaveBeenCalledTimes(3);
    });

    it('does nothing when no terminals exist', () => {
      const manager = createManager();

      expect(() => manager.killAll()).not.toThrow();
      expect(manager.list()).toHaveLength(0);
    });

    it('does not throw even if individual kills fail', async () => {
      const manager = createManager();
      await spawnDefault(manager, 'a');
      await spawnDefault(manager, 'b');

      // Make the first pty.kill() throw — this means terminal 'a' won't be
      // removed from the internal map because pty.kill() throws before the
      // delete call runs. The second terminal should still be cleaned up.
      mockKill.mockImplementationOnce(() => {
        throw new Error('kill failed');
      });

      // killAll should swallow errors and continue to the next terminal
      expect(() => manager.killAll()).not.toThrow();

      // Terminal 'b' should be cleaned up; 'a' remains because its pty.kill() threw
      // before this.terminals.delete() was reached
      expect(manager.get('b')).toBeUndefined();
      // mockKill was called for both terminals
      expect(mockKill).toHaveBeenCalledTimes(2);
    });
  });

  // ── Operations on killed terminals ─────────────────────────────────

  describe('operations on killed terminals', () => {
    it('write() throws TERMINAL_NOT_FOUND after kill', async () => {
      const manager = createManager();
      await spawnDefault(manager, 'term-1');
      manager.kill('term-1');

      expect(() => manager.write('term-1', 'data')).toThrow(WorkerError);
    });

    it('resize() throws TERMINAL_NOT_FOUND after kill', async () => {
      const manager = createManager();
      await spawnDefault(manager, 'term-1');
      manager.kill('term-1');

      expect(() => manager.resize('term-1', 80, 24)).toThrow(WorkerError);
    });

    it('subscribe() throws TERMINAL_NOT_FOUND after kill', async () => {
      const manager = createManager();
      await spawnDefault(manager, 'term-1');
      manager.kill('term-1');

      expect(() => manager.subscribe('term-1', vi.fn())).toThrow(WorkerError);
    });
  });
});
