import type { AgentInstance, AgentProfile, WorkerNode } from '@agentctl/shared';
import { describe, expect, it } from 'vitest';

import { RoutingEngine, type RoutingWeights, type StatsMap } from './routing-engine.js';

// ── Helpers ─────────────────────────────────────────────────

function makeProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: 'profile-1',
    name: 'Test Agent',
    runtimeType: 'claude-code',
    modelId: 'claude-sonnet-4-20250514',
    providerId: 'anthropic',
    capabilities: ['typescript', 'testing'],
    toolScopes: [],
    maxTokensPerTask: 100_000,
    maxCostPerHour: 5.0,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeNode(overrides: Partial<WorkerNode> = {}): WorkerNode {
  return {
    id: 'node-1',
    hostname: 'test-host',
    tailscaleIp: '100.64.0.1',
    maxConcurrentAgents: 3,
    currentLoad: 0.0,
    capabilities: ['docker'],
    status: 'online',
    lastHeartbeatAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeInstance(overrides: Partial<AgentInstance> = {}): AgentInstance {
  return {
    id: 'instance-1',
    profileId: 'profile-1',
    machineId: 'node-1',
    worktreeId: null,
    runtimeSessionId: null,
    status: 'idle',
    heartbeatAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

const EQUAL_WEIGHTS: RoutingWeights = {
  load: 0.25,
  cost: 0.25,
  successRate: 0.25,
  duration: 0.25,
};

// ── Tests ───────────────────────────────────────────────────

describe('RoutingEngine', () => {
  describe('rankCandidates', () => {
    it('filters out profiles missing required capabilities', () => {
      const engine = new RoutingEngine(EQUAL_WEIGHTS);

      const profiles = [
        makeProfile({ id: 'p1', capabilities: ['typescript', 'testing'] }),
        makeProfile({ id: 'p2', capabilities: ['python'] }),
      ];
      const nodes = [makeNode()];
      const emptyStats: StatsMap = new Map();

      const candidates = engine.rankCandidates(
        {
          taskDefinitionId: 'td-1',
          requiredCapabilities: ['typescript', 'testing'],
          estimatedTokens: null,
        },
        profiles,
        nodes,
        [],
        emptyStats,
      );

      expect(candidates).toHaveLength(1);
      expect(candidates[0].profileId).toBe('p1');
    });

    it('filters out offline nodes', () => {
      const engine = new RoutingEngine(EQUAL_WEIGHTS);

      const profiles = [makeProfile()];
      const nodes = [
        makeNode({ id: 'n1', status: 'online' }),
        makeNode({ id: 'n2', status: 'offline' }),
        makeNode({ id: 'n3', status: 'draining' }),
      ];
      const emptyStats: StatsMap = new Map();

      const candidates = engine.rankCandidates(
        {
          taskDefinitionId: 'td-1',
          requiredCapabilities: ['typescript'],
          estimatedTokens: null,
        },
        profiles,
        nodes,
        [],
        emptyStats,
      );

      expect(candidates).toHaveLength(1);
      expect(candidates[0].nodeId).toBe('n1');
    });

    it('filters out nodes at capacity', () => {
      const engine = new RoutingEngine(EQUAL_WEIGHTS);

      const profiles = [makeProfile()];
      const nodes = [makeNode({ id: 'n1', maxConcurrentAgents: 2 })];
      const instances: AgentInstance[] = [
        makeInstance({ id: 'i1', machineId: 'n1', status: 'running' }),
        makeInstance({ id: 'i2', machineId: 'n1', status: 'running' }),
      ];
      const emptyStats: StatsMap = new Map();

      const candidates = engine.rankCandidates(
        {
          taskDefinitionId: 'td-1',
          requiredCapabilities: ['typescript'],
          estimatedTokens: null,
        },
        profiles,
        nodes,
        instances,
        emptyStats,
      );

      expect(candidates).toHaveLength(0);
    });

    it('filters by machine requirements', () => {
      const engine = new RoutingEngine(EQUAL_WEIGHTS);

      const profiles = [makeProfile()];
      const nodes = [
        makeNode({ id: 'n1', capabilities: ['docker', 'gpu'] }),
        makeNode({ id: 'n2', capabilities: ['docker'] }),
      ];
      const emptyStats: StatsMap = new Map();

      const candidates = engine.rankCandidates(
        {
          taskDefinitionId: 'td-1',
          requiredCapabilities: ['typescript'],
          machineRequirements: ['gpu'],
          estimatedTokens: null,
        },
        profiles,
        nodes,
        [],
        emptyStats,
      );

      expect(candidates).toHaveLength(1);
      expect(candidates[0].nodeId).toBe('n1');
    });

    it('respects limit parameter', () => {
      const engine = new RoutingEngine(EQUAL_WEIGHTS);

      const profiles = [
        makeProfile({ id: 'p1', capabilities: ['typescript'] }),
        makeProfile({ id: 'p2', capabilities: ['typescript'] }),
        makeProfile({ id: 'p3', capabilities: ['typescript'] }),
      ];
      const nodes = [makeNode()];
      const emptyStats: StatsMap = new Map();

      const candidates = engine.rankCandidates(
        {
          taskDefinitionId: 'td-1',
          requiredCapabilities: ['typescript'],
          estimatedTokens: null,
          limit: 2,
        },
        profiles,
        nodes,
        [],
        emptyStats,
      );

      expect(candidates).toHaveLength(2);
    });

    it('prefers agents with higher success rate', () => {
      const weights: RoutingWeights = {
        load: 0,
        cost: 0,
        successRate: 1.0,
        duration: 0,
      };
      const engine = new RoutingEngine(weights);

      const profiles = [
        makeProfile({ id: 'p1', capabilities: ['typescript'], maxCostPerHour: 5 }),
        makeProfile({ id: 'p2', capabilities: ['typescript'], maxCostPerHour: 5 }),
      ];
      const nodes = [makeNode()];
      const stats: StatsMap = new Map([
        ['p1', { successRate: 0.95, avgDurationMs: 1000, avgCostUsd: 0.5, count: 20 }],
        ['p2', { successRate: 0.6, avgDurationMs: 1000, avgCostUsd: 0.5, count: 20 }],
      ]);

      const candidates = engine.rankCandidates(
        {
          taskDefinitionId: 'td-1',
          requiredCapabilities: ['typescript'],
          estimatedTokens: null,
        },
        profiles,
        nodes,
        [],
        stats,
      );

      expect(candidates[0].profileId).toBe('p1');
      expect(candidates[0].breakdown.successRateScore).toBe(0.95);
      expect(candidates[1].profileId).toBe('p2');
      expect(candidates[1].breakdown.successRateScore).toBe(0.6);
    });

    it('prefers nodes with lower load', () => {
      const weights: RoutingWeights = {
        load: 1.0,
        cost: 0,
        successRate: 0,
        duration: 0,
      };
      const engine = new RoutingEngine(weights);

      const profiles = [makeProfile({ id: 'p1', capabilities: ['typescript'] })];
      const nodes = [
        makeNode({ id: 'n1', maxConcurrentAgents: 4 }),
        makeNode({ id: 'n2', maxConcurrentAgents: 4 }),
      ];
      const instances: AgentInstance[] = [
        makeInstance({ id: 'i1', machineId: 'n1', status: 'running' }),
        makeInstance({ id: 'i2', machineId: 'n1', status: 'running' }),
        makeInstance({ id: 'i3', machineId: 'n1', status: 'running' }),
      ];
      const emptyStats: StatsMap = new Map();

      const candidates = engine.rankCandidates(
        {
          taskDefinitionId: 'td-1',
          requiredCapabilities: ['typescript'],
          estimatedTokens: null,
        },
        profiles,
        nodes,
        instances,
        emptyStats,
      );

      // n2 has 0 running, n1 has 3 running (of max 4)
      expect(candidates[0].nodeId).toBe('n2');
      expect(candidates[0].breakdown.loadScore).toBe(1.0); // 0 of 4 used
      expect(candidates[1].nodeId).toBe('n1');
      expect(candidates[1].breakdown.loadScore).toBe(0.25); // 3 of 4 used
    });

    it('prefers cheaper profiles when cost weight is dominant', () => {
      const weights: RoutingWeights = {
        load: 0,
        cost: 1.0,
        successRate: 0,
        duration: 0,
      };
      const engine = new RoutingEngine(weights);

      const profiles = [
        makeProfile({ id: 'p-cheap', capabilities: ['typescript'], maxCostPerHour: 1.0 }),
        makeProfile({ id: 'p-expensive', capabilities: ['typescript'], maxCostPerHour: 10.0 }),
      ];
      const nodes = [makeNode()];
      const emptyStats: StatsMap = new Map();

      const candidates = engine.rankCandidates(
        {
          taskDefinitionId: 'td-1',
          requiredCapabilities: ['typescript'],
          estimatedTokens: null,
        },
        profiles,
        nodes,
        [],
        emptyStats,
      );

      expect(candidates[0].profileId).toBe('p-cheap');
      expect(candidates[0].breakdown.costScore).toBeGreaterThan(candidates[1].breakdown.costScore);
    });

    it('returns empty array when no profiles match', () => {
      const engine = new RoutingEngine(EQUAL_WEIGHTS);

      const profiles = [makeProfile({ capabilities: ['python'] })];
      const nodes = [makeNode()];
      const emptyStats: StatsMap = new Map();

      const candidates = engine.rankCandidates(
        {
          taskDefinitionId: 'td-1',
          requiredCapabilities: ['typescript'],
          estimatedTokens: null,
        },
        profiles,
        nodes,
        [],
        emptyStats,
      );

      expect(candidates).toHaveLength(0);
    });

    it('returns empty array when no nodes are available', () => {
      const engine = new RoutingEngine(EQUAL_WEIGHTS);

      const profiles = [makeProfile()];
      const nodes: WorkerNode[] = [];
      const emptyStats: StatsMap = new Map();

      const candidates = engine.rankCandidates(
        {
          taskDefinitionId: 'td-1',
          requiredCapabilities: ['typescript'],
          estimatedTokens: null,
        },
        profiles,
        nodes,
        [],
        emptyStats,
      );

      expect(candidates).toHaveLength(0);
    });
  });

  describe('computeScore', () => {
    it('returns breakdown with all score components', () => {
      const engine = new RoutingEngine(EQUAL_WEIGHTS);

      const profile = makeProfile({ maxCostPerHour: 5.0 });
      const node = makeNode({ maxConcurrentAgents: 4 });
      const instancesPerNode = new Map([['node-1', 1]]);
      const stats: StatsMap = new Map([
        ['profile-1', { successRate: 0.9, avgDurationMs: 5000, avgCostUsd: 0.3, count: 10 }],
      ]);

      const breakdown = engine.computeScore(
        profile,
        node,
        instancesPerNode,
        {
          taskDefinitionId: 'td-1',
          requiredCapabilities: ['typescript'],
          estimatedTokens: null,
        },
        stats,
        10.0, // maxCost
        10000, // maxDuration
      );

      expect(breakdown.capabilityMatch).toBe(1.0);
      expect(breakdown.loadScore).toBe(0.75); // 1 of 4 used
      expect(breakdown.costScore).toBe(0.5); // 5/10 = 0.5 cost ratio
      expect(breakdown.successRateScore).toBe(0.9);
      expect(breakdown.durationScore).toBe(0.5); // 5000/10000 = 0.5 duration ratio
      expect(breakdown.weightedTotal).toBeGreaterThan(0);
    });

    it('uses neutral defaults when no stats are available', () => {
      const engine = new RoutingEngine(EQUAL_WEIGHTS);

      const profile = makeProfile();
      const node = makeNode();
      const emptyStats: StatsMap = new Map();

      const breakdown = engine.computeScore(
        profile,
        node,
        new Map(),
        {
          taskDefinitionId: 'td-1',
          requiredCapabilities: ['typescript'],
          estimatedTokens: null,
        },
        emptyStats,
        5.0,
        1000,
      );

      expect(breakdown.successRateScore).toBe(0.5);
      expect(breakdown.durationScore).toBe(0.5);
    });
  });
});
