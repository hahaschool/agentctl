import { AgentError } from '@agentctl/shared';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../test-helpers.js';
import type { AgentInstanceOptions } from './agent-instance.js';
import { AgentPool } from './agent-pool.js';

// Mock the sdk-runner so AgentInstance.start() falls back to stub simulation.
vi.mock('./sdk-runner.js', () => ({
  runWithSdk: vi.fn().mockResolvedValue(null),
}));

vi.mock('./workdir-safety.js', () => ({
  checkWorkdirSafety: vi.fn().mockResolvedValue({
    tier: 'safe',
    isGitRepo: true,
    hasUncommittedChanges: false,
    parallelTaskCount: 1,
  }),
  createSandbox: vi.fn(),
}));

const mockLogger = createMockLogger();

function makeAgentOptions(id: string): AgentInstanceOptions {
  return {
    agentId: id,
    machineId: 'machine-1',
    config: {},
    projectPath: '/tmp/test-project',
    logger: mockLogger,
  };
}

describe('AgentPool', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('createAgent adds agent to pool', async () => {
    const pool = new AgentPool({ logger: mockLogger });

    const agent = await pool.createAgent(makeAgentOptions('agent-1'));

    expect(agent).toBeDefined();
    expect(pool.size).toBe(1);
    expect(pool.getAgent('agent-1')).toBe(agent);
  });

  it('createAgent throws POOL_FULL when max concurrent reached', async () => {
    const pool = new AgentPool({ maxConcurrent: 1, logger: mockLogger });

    // Create and start an agent so it counts as running
    const agent = await pool.createAgent(makeAgentOptions('agent-1'));
    const startPromise = agent.start('test');
    await vi.advanceTimersByTimeAsync(0);

    expect(pool.getRunningCount()).toBe(1);

    // Creating a second agent should throw POOL_FULL
    await expect(pool.createAgent(makeAgentOptions('agent-2'))).rejects.toThrow(AgentError);

    try {
      await pool.createAgent(makeAgentOptions('agent-3'));
    } catch (err) {
      expect((err as AgentError).code).toBe('POOL_FULL');
    }

    // Clean up
    await agent.stop(false);
    vi.runAllTimers();
    await startPromise;
  });

  it('getAgent returns agent by id', async () => {
    const pool = new AgentPool({ logger: mockLogger });

    await pool.createAgent(makeAgentOptions('agent-1'));

    expect(pool.getAgent('agent-1')).toBeDefined();
    expect(pool.getAgent('nonexistent')).toBeUndefined();
  });

  it('listAgents returns all agents as JSON', async () => {
    const pool = new AgentPool({ logger: mockLogger });

    await pool.createAgent(makeAgentOptions('agent-1'));
    await pool.createAgent(makeAgentOptions('agent-2'));

    const list = pool.listAgents();

    expect(list).toHaveLength(2);
    expect(list[0].agentId).toBe('agent-1');
    expect(list[1].agentId).toBe('agent-2');
    expect(list[0]).toHaveProperty('status');
    expect(list[0]).toHaveProperty('machineId');
    expect(list[0]).toHaveProperty('projectPath');
  });

  it('removeAgent removes stopped agent', async () => {
    const pool = new AgentPool({ logger: mockLogger });
    await pool.createAgent(makeAgentOptions('agent-1'));

    // Agent is in 'registered' state (not running), so it can be removed
    const removed = await pool.removeAgent('agent-1');

    expect(removed).toBe(true);
    expect(pool.size).toBe(0);
    expect(pool.getAgent('agent-1')).toBeUndefined();
  });

  it('removeAgent throws AGENT_STILL_RUNNING for running agents', async () => {
    const pool = new AgentPool({ logger: mockLogger });
    const agent = await pool.createAgent(makeAgentOptions('agent-1'));

    // Start the agent so it transitions to running
    const startPromise = agent.start('test');
    await vi.advanceTimersByTimeAsync(0);

    expect(agent.getStatus()).toBe('running');

    await expect(pool.removeAgent('agent-1')).rejects.toThrow(AgentError);

    try {
      await pool.removeAgent('agent-1');
    } catch (err) {
      expect((err as AgentError).code).toBe('AGENT_STILL_RUNNING');
    }

    // Clean up
    await agent.stop(false);
    vi.runAllTimers();
    await startPromise;
  });

  it('getTotalAgentsStarted increments on each createAgent call', async () => {
    const pool = new AgentPool({ logger: mockLogger });

    expect(pool.getTotalAgentsStarted()).toBe(0);

    await pool.createAgent(makeAgentOptions('agent-1'));
    expect(pool.getTotalAgentsStarted()).toBe(1);

    await pool.createAgent(makeAgentOptions('agent-2'));
    expect(pool.getTotalAgentsStarted()).toBe(2);

    // Removing an agent does not decrement the lifetime counter
    await pool.removeAgent('agent-1');
    expect(pool.getTotalAgentsStarted()).toBe(2);
  });

  it('getWorktreeCount returns zero when no worktree manager is configured', async () => {
    const pool = new AgentPool({ logger: mockLogger });

    await pool.createAgent(makeAgentOptions('agent-1'));

    expect(pool.getWorktreeCount()).toBe(0);
  });

  it('getAgentStats returns correct aggregate statistics', async () => {
    const pool = new AgentPool({ maxConcurrent: 5, logger: mockLogger });

    // Empty pool
    const emptyStats = pool.getAgentStats();
    expect(emptyStats.poolSize).toBe(0);
    expect(emptyStats.byStatus).toEqual({});
    expect(emptyStats.totalCostUsd).toBe(0);
    expect(emptyStats.oldestAgent).toBeNull();

    // Add agents in different states
    const agent1 = await pool.createAgent(makeAgentOptions('agent-1'));
    await pool.createAgent(makeAgentOptions('agent-2'));

    // Both are in 'registered' state
    const registeredStats = pool.getAgentStats();
    expect(registeredStats.poolSize).toBe(2);
    expect(registeredStats.byStatus).toEqual({ registered: 2 });
    expect(registeredStats.totalCostUsd).toBe(0);
    expect(registeredStats.oldestAgent).toBeNull();

    // Start one agent so it becomes running
    const p1 = agent1.start('test');
    await vi.advanceTimersByTimeAsync(0);

    const runningStats = pool.getAgentStats();
    expect(runningStats.byStatus.running).toBe(1);
    expect(runningStats.byStatus.registered).toBe(1);
    expect(runningStats.oldestAgent).not.toBeNull();
    expect(runningStats.oldestAgent?.agentId).toBe('agent-1');

    await agent1.stop(false);
    vi.runAllTimers();
    await p1;
  });

  it('getRunningCount returns correct count', async () => {
    const pool = new AgentPool({ maxConcurrent: 5, logger: mockLogger });

    const agent1 = await pool.createAgent(makeAgentOptions('agent-1'));
    const agent2 = await pool.createAgent(makeAgentOptions('agent-2'));
    await pool.createAgent(makeAgentOptions('agent-3'));

    expect(pool.getRunningCount()).toBe(0);

    const p1 = agent1.start('test1');
    const p2 = agent2.start('test2');
    await vi.advanceTimersByTimeAsync(0);

    expect(pool.getRunningCount()).toBe(2);

    await agent1.stop(false);

    expect(pool.getRunningCount()).toBe(1);

    await agent2.stop(false);

    expect(pool.getRunningCount()).toBe(0);

    vi.runAllTimers();
    await Promise.all([p1, p2]);
  });

  // ── Edge case tests ──────────────────────────────────────────────

  it('createAgent throws AGENT_EXISTS for duplicate agent ID', async () => {
    const pool = new AgentPool({ logger: mockLogger });

    await pool.createAgent(makeAgentOptions('agent-1'));

    try {
      await pool.createAgent(makeAgentOptions('agent-1'));
      expect.fail('Expected AGENT_EXISTS error');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe('AGENT_EXISTS');
    }
  });

  it('stopAgent throws AGENT_NOT_FOUND for non-existent agent', async () => {
    const pool = new AgentPool({ logger: mockLogger });

    try {
      await pool.stopAgent('nonexistent', true);
      expect.fail('Expected AGENT_NOT_FOUND error');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe('AGENT_NOT_FOUND');
    }
  });

  it('removeAgent returns false for non-existent agent', async () => {
    const pool = new AgentPool({ logger: mockLogger });

    const result = await pool.removeAgent('does-not-exist');

    expect(result).toBe(false);
  });

  it('stopAll with no agents completes without error', async () => {
    const pool = new AgentPool({ logger: mockLogger });

    await expect(pool.stopAll()).resolves.toBeUndefined();
  });

  it('stopAll stops all running agents', async () => {
    const pool = new AgentPool({ maxConcurrent: 5, logger: mockLogger });

    const agent1 = await pool.createAgent(makeAgentOptions('agent-1'));
    const agent2 = await pool.createAgent(makeAgentOptions('agent-2'));

    const p1 = agent1.start('test1');
    const p2 = agent2.start('test2');
    await vi.advanceTimersByTimeAsync(0);

    expect(pool.getRunningCount()).toBe(2);

    await pool.stopAll(false);

    expect(agent1.getStatus()).toBe('stopped');
    expect(agent2.getStatus()).toBe('stopped');
    expect(pool.getRunningCount()).toBe(0);

    vi.runAllTimers();
    await Promise.all([p1, p2]);
  });

  it('stopAll skips agents that are already stopped', async () => {
    const pool = new AgentPool({ maxConcurrent: 5, logger: mockLogger });

    const agent1 = await pool.createAgent(makeAgentOptions('agent-1'));
    await pool.createAgent(makeAgentOptions('agent-2')); // stays in 'registered'

    const p1 = agent1.start('test1');
    await vi.advanceTimersByTimeAsync(0);

    await agent1.stop(false);

    // stopAll should not throw even though agent-1 is already stopped
    // and agent-2 was never started
    await expect(pool.stopAll()).resolves.toBeUndefined();

    vi.runAllTimers();
    await p1;
  });

  it('getMaxConcurrent returns configured value', () => {
    const pool = new AgentPool({ maxConcurrent: 7, logger: mockLogger });

    expect(pool.getMaxConcurrent()).toBe(7);
  });

  it('getMaxConcurrent defaults to 3 when not specified', () => {
    const pool = new AgentPool({ logger: mockLogger });

    expect(pool.getMaxConcurrent()).toBe(3);
  });

  it('size reflects current pool count after add and remove', async () => {
    const pool = new AgentPool({ logger: mockLogger });

    expect(pool.size).toBe(0);

    await pool.createAgent(makeAgentOptions('agent-1'));
    expect(pool.size).toBe(1);

    await pool.createAgent(makeAgentOptions('agent-2'));
    expect(pool.size).toBe(2);

    await pool.removeAgent('agent-1');
    expect(pool.size).toBe(1);

    await pool.removeAgent('agent-2');
    expect(pool.size).toBe(0);
  });

  it('pool emits agent-event with agentId when agent emits events', async () => {
    const pool = new AgentPool({ maxConcurrent: 5, logger: mockLogger });
    const poolEvents: Array<{ agentId: string; event: unknown }> = [];

    pool.on('agent-event', (payload) => {
      poolEvents.push(payload);
    });

    const agent = await pool.createAgent(makeAgentOptions('agent-1'));
    const startPromise = agent.start('test prompt');
    await vi.advanceTimersByTimeAsync(0);

    // The agent will have emitted at least 'starting' and 'running' status events
    expect(poolEvents.length).toBeGreaterThanOrEqual(2);
    expect(poolEvents[0].agentId).toBe('agent-1');
    expect(poolEvents[0].event).toBeDefined();

    await agent.stop(false);
    vi.runAllTimers();
    await startPromise;
  });

  it('listAgents returns empty array for empty pool', () => {
    const pool = new AgentPool({ logger: mockLogger });

    expect(pool.listAgents()).toEqual([]);
  });

  it('removeAgent throws AGENT_STILL_RUNNING for starting agents', async () => {
    const pool = new AgentPool({ maxConcurrent: 5, logger: mockLogger });
    const agent = await pool.createAgent(makeAgentOptions('agent-1'));

    // Start and catch the status at 'starting' by checking immediately
    // after start transitions. The stub simulation puts it into 'running'
    // quickly, so we verify via the status after start.
    const startPromise = agent.start('test');
    await vi.advanceTimersByTimeAsync(0);

    // Agent is now 'running' which also qualifies as AGENT_STILL_RUNNING
    try {
      await pool.removeAgent('agent-1');
      expect.fail('Expected AGENT_STILL_RUNNING error');
    } catch (err) {
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).code).toBe('AGENT_STILL_RUNNING');
    }

    await agent.stop(false);
    vi.runAllTimers();
    await startPromise;
  });

  describe('with worktree manager', () => {
    function makeWorktreeManager() {
      return {
        create: vi.fn().mockResolvedValue({
          path: '/tmp/worktrees/agent-test',
          branch: 'agent-test/work',
          head: 'abc123',
          isLocked: false,
        }),
        remove: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([]),
        get: vi.fn().mockResolvedValue(null),
        lock: vi.fn().mockResolvedValue(undefined),
        unlock: vi.fn().mockResolvedValue(undefined),
        exists: vi.fn().mockResolvedValue(false),
        getWorktreePath: vi.fn().mockReturnValue('/tmp/worktrees/agent-test'),
      };
    }

    it('createAgent creates a worktree when worktreeManager is configured', async () => {
      const wm = makeWorktreeManager();
      const pool = new AgentPool({
        logger: mockLogger,
        worktreeManager: wm as never,
      });

      await pool.createAgent(makeAgentOptions('agent-1'));

      expect(wm.create).toHaveBeenCalledWith({
        agentId: 'agent-1',
        projectPath: '/tmp/test-project',
        description: 'work',
      });
      expect(pool.getWorktreeCount()).toBe(1);
    });

    it('createAgent injects tier bootstrap instructions when the worktree exposes an env loader', async () => {
      const wm = makeWorktreeManager();
      wm.create.mockResolvedValue({
        path: '/tmp/worktrees/agent-test',
        branch: 'agent-test/work',
        head: 'abc123',
        isLocked: false,
        tier: 'dev-1',
        envFilePath: '/tmp/worktrees/agent-test/.env.dev-1',
        envLoadCommand: 'source ./.agentctl/source-tier-env.sh',
      });

      const pool = new AgentPool({
        logger: mockLogger,
        worktreeManager: wm as never,
      });

      const agent = await pool.createAgent({
        ...makeAgentOptions('agent-1'),
        config: { systemPrompt: 'Keep edits minimal.' },
      });

      expect(agent.projectPath).toBe('/tmp/worktrees/agent-test');
      expect(agent.config.systemPrompt).toContain('Assigned development tier: dev-1.');
      expect(agent.config.systemPrompt).toContain('source ./.agentctl/source-tier-env.sh');
      expect(agent.config.systemPrompt).toContain('Keep edits minimal.');
    });

    it('createAgent falls back to original projectPath when worktree creation fails', async () => {
      const wm = makeWorktreeManager();
      wm.create.mockRejectedValue(new Error('disk full'));

      const pool = new AgentPool({
        logger: mockLogger,
        worktreeManager: wm as never,
      });

      const agent = await pool.createAgent(makeAgentOptions('agent-1'));

      expect(agent).toBeDefined();
      // Worktree count should remain 0 since creation failed
      expect(pool.getWorktreeCount()).toBe(0);
    });

    it('removeAgent cleans up worktree', async () => {
      const wm = makeWorktreeManager();
      const pool = new AgentPool({
        logger: mockLogger,
        worktreeManager: wm as never,
      });

      await pool.createAgent(makeAgentOptions('agent-1'));
      expect(pool.getWorktreeCount()).toBe(1);

      await pool.removeAgent('agent-1');

      expect(wm.remove).toHaveBeenCalledWith('agent-1');
      expect(pool.getWorktreeCount()).toBe(0);
    });

    it('removeAgent proceeds even if worktree removal fails', async () => {
      const wm = makeWorktreeManager();
      wm.remove.mockRejectedValue(new Error('worktree removal failed'));

      const pool = new AgentPool({
        logger: mockLogger,
        worktreeManager: wm as never,
      });

      await pool.createAgent(makeAgentOptions('agent-1'));

      // Should not throw despite worktree removal failure
      const removed = await pool.removeAgent('agent-1');

      expect(removed).toBe(true);
      expect(pool.size).toBe(0);
    });

    it('stopAll cleans up remaining worktrees', async () => {
      const wm = makeWorktreeManager();
      const pool = new AgentPool({
        maxConcurrent: 5,
        logger: mockLogger,
        worktreeManager: wm as never,
      });

      const agent1 = await pool.createAgent(makeAgentOptions('agent-1'));
      await pool.createAgent(makeAgentOptions('agent-2'));

      const p1 = agent1.start('test');
      await vi.advanceTimersByTimeAsync(0);

      expect(pool.getWorktreeCount()).toBe(2);

      await pool.stopAll(false);

      // Worktrees should be cleaned up for both agents
      expect(wm.remove).toHaveBeenCalledWith('agent-1');
      expect(wm.remove).toHaveBeenCalledWith('agent-2');
      expect(pool.getWorktreeCount()).toBe(0);

      vi.runAllTimers();
      await p1;
    });

    it('cleanOrphanedWorktrees removes worktrees not in pool', async () => {
      const wm = makeWorktreeManager();
      wm.list.mockResolvedValue([
        {
          path: '/tmp/worktrees/agent-orphan1',
          branch: 'agent-orphan1/work',
          head: 'abc123',
          isLocked: false,
        },
        {
          path: '/tmp/worktrees/agent-orphan2',
          branch: 'agent-orphan2/feature',
          head: 'def456',
          isLocked: false,
        },
      ]);

      const pool = new AgentPool({
        logger: mockLogger,
        worktreeManager: wm as never,
      });

      await pool.cleanOrphanedWorktrees();

      expect(wm.remove).toHaveBeenCalledWith('orphan1');
      expect(wm.remove).toHaveBeenCalledWith('orphan2');
    });

    it('cleanOrphanedWorktrees skips worktrees belonging to tracked agents', async () => {
      const wm = makeWorktreeManager();
      wm.list.mockResolvedValue([
        {
          path: '/tmp/worktrees/agent-tracked1',
          branch: 'agent-tracked1/work',
          head: 'abc123',
          isLocked: false,
        },
        {
          path: '/tmp/worktrees/agent-orphan',
          branch: 'agent-orphan/work',
          head: 'def456',
          isLocked: false,
        },
      ]);

      const pool = new AgentPool({
        logger: mockLogger,
        worktreeManager: wm as never,
      });

      // Add an agent with id 'tracked1' so its worktree should be skipped
      await pool.createAgent(makeAgentOptions('tracked1'));

      await pool.cleanOrphanedWorktrees();

      // Only the orphan should be removed, not the tracked one
      expect(wm.remove).toHaveBeenCalledWith('orphan');
      expect(wm.remove).not.toHaveBeenCalledWith('tracked1');
    });

    it('cleanOrphanedWorktrees skips branches not matching agent- prefix', async () => {
      const wm = makeWorktreeManager();
      wm.list.mockResolvedValue([
        {
          path: '/tmp/worktrees/feature-branch',
          branch: 'feature/my-feature',
          head: 'abc123',
          isLocked: false,
        },
        {
          path: '/tmp/worktrees/main',
          branch: 'main',
          head: 'def456',
          isLocked: false,
        },
      ]);

      const pool = new AgentPool({
        logger: mockLogger,
        worktreeManager: wm as never,
      });

      await pool.cleanOrphanedWorktrees();

      // Neither should be removed — they don't match the agent- prefix
      expect(wm.remove).not.toHaveBeenCalled();
    });

    it('cleanOrphanedWorktrees is a no-op when no worktreeManager is configured', async () => {
      const pool = new AgentPool({ logger: mockLogger });

      // Should not throw
      await expect(pool.cleanOrphanedWorktrees()).resolves.toBeUndefined();
    });

    it('cleanOrphanedWorktrees handles list failure gracefully', async () => {
      const wm = makeWorktreeManager();
      wm.list.mockRejectedValue(new Error('git not found'));

      const pool = new AgentPool({
        logger: mockLogger,
        worktreeManager: wm as never,
      });

      // Should not throw
      await expect(pool.cleanOrphanedWorktrees()).resolves.toBeUndefined();
    });

    it('cleanOrphanedWorktrees handles individual removal failure gracefully', async () => {
      const wm = makeWorktreeManager();
      wm.list.mockResolvedValue([
        {
          path: '/tmp/worktrees/agent-fail',
          branch: 'agent-fail/work',
          head: 'abc123',
          isLocked: false,
        },
        {
          path: '/tmp/worktrees/agent-ok',
          branch: 'agent-ok/work',
          head: 'def456',
          isLocked: false,
        },
      ]);
      wm.remove.mockRejectedValueOnce(new Error('removal failed')).mockResolvedValueOnce(undefined);

      const pool = new AgentPool({
        logger: mockLogger,
        worktreeManager: wm as never,
      });

      // Should not throw despite first removal failing
      await expect(pool.cleanOrphanedWorktrees()).resolves.toBeUndefined();

      // Both should have been attempted
      expect(wm.remove).toHaveBeenCalledTimes(2);
    });

    it('cleanOrphanedWorktrees handles branch without slash (no description)', async () => {
      const wm = makeWorktreeManager();
      wm.list.mockResolvedValue([
        {
          path: '/tmp/worktrees/agent-bare',
          branch: 'agent-bare',
          head: 'abc123',
          isLocked: false,
        },
      ]);

      const pool = new AgentPool({
        logger: mockLogger,
        worktreeManager: wm as never,
      });

      await pool.cleanOrphanedWorktrees();

      // Should extract agentId='bare' and remove it since it's not tracked
      expect(wm.remove).toHaveBeenCalledWith('bare');
    });
  });

  it('stopAgent delegates to agent instance stop()', async () => {
    const pool = new AgentPool({ maxConcurrent: 5, logger: mockLogger });

    const agent = await pool.createAgent(makeAgentOptions('agent-1'));
    const startPromise = agent.start('test');
    await vi.advanceTimersByTimeAsync(0);

    expect(agent.getStatus()).toBe('running');

    await pool.stopAgent('agent-1', false);

    expect(agent.getStatus()).toBe('stopped');

    vi.runAllTimers();
    await startPromise;
  });

  it('POOL_FULL checks only running/starting agents, not registered ones', async () => {
    const pool = new AgentPool({ maxConcurrent: 1, logger: mockLogger });

    // Create a registered (non-running) agent — should not count towards running
    await pool.createAgent(makeAgentOptions('agent-1'));

    expect(pool.getRunningCount()).toBe(0);

    // Should be able to create another agent since none are running
    const agent2 = await pool.createAgent(makeAgentOptions('agent-2'));

    expect(pool.size).toBe(2);
    expect(agent2).toBeDefined();
  });

  it('getAgentStats sums cost across all agents', async () => {
    const pool = new AgentPool({ maxConcurrent: 5, logger: mockLogger });

    const agent1 = await pool.createAgent(makeAgentOptions('agent-1'));
    const agent2 = await pool.createAgent(makeAgentOptions('agent-2'));

    // Start both agents and let the stub simulation run a bit
    const p1 = agent1.start('test1');
    const p2 = agent2.start('test2');
    await vi.advanceTimersByTimeAsync(0);

    // Let a few simulation turns run
    await vi.advanceTimersByTimeAsync(2000);

    const stats = pool.getAgentStats();

    // Both agents should have accumulated cost from stub turns
    expect(stats.totalCostUsd).toBeGreaterThan(0);
    expect(stats.byStatus.running).toBe(2);

    await agent1.stop(false);
    await agent2.stop(false);
    vi.runAllTimers();
    await Promise.all([p1, p2]);
  });
});
