import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from 'pino';

import { ControlPlaneError } from '@agentctl/shared';

import { MemoryInjector } from './memory-injector.js';
import type { Mem0Client, MemoryEntry } from './mem0-client.js';

const logger = {
  child: () => logger,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
} as unknown as Logger;

function createMockMem0Client(overrides: Partial<Mem0Client> = {}): Mem0Client {
  return {
    add: vi.fn().mockResolvedValue({ results: [] }),
    search: vi.fn().mockResolvedValue({ results: [] }),
    getAll: vi.fn().mockResolvedValue({ results: [] }),
    get: vi.fn(),
    delete: vi.fn(),
    deleteAll: vi.fn(),
    health: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as unknown as Mem0Client;
}

function makeMemoryEntry(memory: string): MemoryEntry {
  return {
    id: `mem-${Math.random().toString(36).slice(2, 8)}`,
    memory,
    userId: 'user-1',
    agentId: 'agent-1',
    metadata: {},
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  };
}

describe('MemoryInjector', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('buildMemoryContext()', () => {
    it('returns formatted memory section', async () => {
      const mem0Client = createMockMem0Client({
        search: vi.fn().mockResolvedValue({
          results: [
            makeMemoryEntry('User prefers TypeScript'),
            makeMemoryEntry('Project uses pnpm workspaces'),
          ],
        }),
      });

      const injector = new MemoryInjector({ mem0Client, logger });
      const context = await injector.buildMemoryContext('agent-1', 'Set up the project');

      expect(context).toBe(
        '## Relevant Memories\n- User prefers TypeScript\n- Project uses pnpm workspaces',
      );

      expect(mem0Client.search).toHaveBeenCalledWith({
        query: 'Set up the project',
        agentId: 'agent-1',
        limit: 10,
      });
    });

    it('returns empty string when no memories found', async () => {
      const mem0Client = createMockMem0Client({
        search: vi.fn().mockResolvedValue({ results: [] }),
      });

      const injector = new MemoryInjector({ mem0Client, logger });
      const context = await injector.buildMemoryContext('agent-1', 'Some prompt');

      expect(context).toBe('');
    });

    it('returns empty string when Mem0 is down (graceful degradation)', async () => {
      const mem0Client = createMockMem0Client({
        search: vi.fn().mockRejectedValue(
          new ControlPlaneError('MEM0_CONNECTION_ERROR', 'Connection refused', {}),
        ),
      });

      const injector = new MemoryInjector({ mem0Client, logger });
      const context = await injector.buildMemoryContext('agent-1', 'Some prompt');

      expect(context).toBe('');
    });
  });

  describe('syncAfterRun()', () => {
    it('calls mem0Client.add() with correct args', async () => {
      const mem0Client = createMockMem0Client();

      const injector = new MemoryInjector({ mem0Client, logger });
      await injector.syncAfterRun('agent-1', 'Completed feature X', { taskId: 'task-42' });

      expect(mem0Client.add).toHaveBeenCalledOnce();
      const callArgs = vi.mocked(mem0Client.add).mock.calls[0][0];
      expect(callArgs.messages).toEqual([{ role: 'assistant', content: 'Completed feature X' }]);
      expect(callArgs.agentId).toBe('agent-1');
      expect(callArgs.metadata).toMatchObject({
        source: 'agent-run',
        taskId: 'task-42',
      });
      expect(callArgs.metadata?.syncedAt).toBeDefined();
    });

    it('swallows ControlPlaneError (does not throw)', async () => {
      const mem0Client = createMockMem0Client({
        add: vi.fn().mockRejectedValue(
          new ControlPlaneError('MEM0_CONNECTION_ERROR', 'Connection refused', {}),
        ),
      });

      const injector = new MemoryInjector({ mem0Client, logger });

      // Should not throw
      await expect(
        injector.syncAfterRun('agent-1', 'Summary'),
      ).resolves.toBeUndefined();
    });
  });
});
