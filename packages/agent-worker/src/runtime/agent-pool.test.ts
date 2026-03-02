import { AgentError } from '@agentctl/shared';

import type { Logger } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentInstanceOptions } from './agent-instance.js';
import { AgentPool } from './agent-pool.js';

// Mock the sdk-runner so AgentInstance.start() falls back to stub simulation.
vi.mock('./sdk-runner.js', () => ({
  runWithSdk: vi.fn().mockResolvedValue(null),
}));

const mockLogger = {
  child: () => mockLogger,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
} as unknown as Logger;

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
});
