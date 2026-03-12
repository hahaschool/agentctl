import type { AgentProfile, DecompositionResult, WorkerNode } from '@agentctl/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../api/routes/test-helpers.js';
import { TaskDecomposer } from './task-decomposer.js';

// ── Test data ────────────────────────────────────────────────────

const MOCK_PROFILE: AgentProfile = {
  id: 'profile-1',
  name: 'Claude Coder',
  runtimeType: 'claude-code',
  modelId: 'claude-sonnet-4-20250514',
  providerId: 'anthropic',
  capabilities: ['typescript', 'testing', 'refactoring'],
  toolScopes: [],
  maxTokensPerTask: 200_000,
  maxCostPerHour: null,
  createdAt: new Date().toISOString(),
};

const MOCK_NODE: WorkerNode = {
  id: 'node-1',
  hostname: 'mac-mini',
  tailscaleIp: '100.64.0.1',
  maxConcurrentAgents: 4,
  currentLoad: 0.3,
  capabilities: ['docker', 'high-memory'],
  status: 'online',
  lastHeartbeatAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
};

const VALID_LLM_RESULT: DecompositionResult = {
  tasks: [
    {
      tempId: 't1',
      type: 'task',
      name: 'Implement auth module',
      description: 'Create OAuth PKCE flow',
      requiredCapabilities: ['typescript'],
      estimatedTokens: 50_000,
      timeoutMs: 3_600_000,
    },
    {
      tempId: 't2',
      type: 'task',
      name: 'Write auth tests',
      description: 'Unit and integration tests',
      requiredCapabilities: ['testing'],
      estimatedTokens: 30_000,
      timeoutMs: 1_800_000,
    },
    {
      tempId: 'g1',
      type: 'gate',
      name: 'Review before merge',
      description: 'Human review approval gate',
      requiredCapabilities: [],
      estimatedTokens: 0,
      timeoutMs: 86_400_000,
    },
  ],
  edges: [
    { from: 't1', to: 't2', type: 'blocks' },
    { from: 't2', to: 'g1', type: 'blocks' },
  ],
  suggestedApprovalGates: ['g1'],
  reasoning: 'Auth module must be built before tests can be written',
  estimatedTotalTokens: 80_000,
  estimatedTotalCostUsd: 0.24,
};

// ── Mock factories ───────────────────────────────────────────────

function createMockLitellmClient(result: DecompositionResult = VALID_LLM_RESULT) {
  return {
    chatCompletion: vi.fn().mockResolvedValue({
      id: 'chatcmpl-1',
      object: 'chat.completion',
      model: 'claude-sonnet-4-20250514',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: JSON.stringify(result) },
          finishReason: 'stop',
        },
      ],
      usage: { promptTokens: 500, completionTokens: 300, totalTokens: 800 },
    }),
  };
}

function createMockAgentProfileStore(profiles: AgentProfile[] = [MOCK_PROFILE]) {
  return {
    listProfiles: vi.fn().mockResolvedValue(profiles),
  };
}

function createMockWorkerNodeStore(nodes: WorkerNode[] = [MOCK_NODE]) {
  return {
    listNodes: vi.fn().mockResolvedValue(nodes),
  };
}

function createMockTaskGraphStore() {
  let defCounter = 0;
  return {
    createGraph: vi
      .fn()
      .mockResolvedValue({ id: 'graph-1', name: '', createdAt: new Date().toISOString() }),
    addDefinition: vi.fn().mockImplementation(async () => {
      defCounter += 1;
      return {
        id: `def-${defCounter}`,
        graphId: 'graph-1',
        type: 'task',
        name: '',
        description: '',
        requiredCapabilities: [],
        estimatedTokens: null,
        timeoutMs: 3_600_000,
        maxRetryAttempts: 1,
        retryBackoffMs: 5000,
        createdAt: new Date().toISOString(),
      };
    }),
    addEdge: vi.fn().mockResolvedValue({
      fromDefinition: 'def-1',
      toDefinition: 'def-2',
      type: 'blocks',
    }),
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe('TaskDecomposer', () => {
  const logger = createMockLogger();

  let litellmClient: ReturnType<typeof createMockLitellmClient>;
  let agentProfileStore: ReturnType<typeof createMockAgentProfileStore>;
  let workerNodeStore: ReturnType<typeof createMockWorkerNodeStore>;
  let taskGraphStore: ReturnType<typeof createMockTaskGraphStore>;
  let decomposer: TaskDecomposer;

  beforeEach(() => {
    litellmClient = createMockLitellmClient();
    agentProfileStore = createMockAgentProfileStore();
    workerNodeStore = createMockWorkerNodeStore();
    taskGraphStore = createMockTaskGraphStore();

    decomposer = new TaskDecomposer({
      litellmClient: litellmClient as never,
      agentProfileStore: agentProfileStore as never,
      workerNodeStore: workerNodeStore as never,
      taskGraphStore: taskGraphStore as never,
      logger,
      modelId: 'test-model',
    });
  });

  describe('decompose', () => {
    it('should decompose a task and persist the graph', async () => {
      const response = await decomposer.decompose({
        description: 'Refactor the auth module to use OAuth PKCE',
      });

      expect(response.graphId).toBe('graph-1');
      expect(response.result.tasks).toHaveLength(3);
      expect(response.result.edges).toHaveLength(2);
      expect(response.validationErrors).toHaveLength(0);

      // Verify persistence calls
      expect(taskGraphStore.createGraph).toHaveBeenCalledOnce();
      expect(taskGraphStore.addDefinition).toHaveBeenCalledTimes(3);
      expect(taskGraphStore.addEdge).toHaveBeenCalledTimes(2);
    });

    it('should map tempIds to definition IDs', async () => {
      const response = await decomposer.decompose({
        description: 'Build feature X',
      });

      expect(response.definitionIdMap).toHaveProperty('t1');
      expect(response.definitionIdMap).toHaveProperty('t2');
      expect(response.definitionIdMap).toHaveProperty('g1');
      expect(response.definitionIdMap.t1).toMatch(/^def-/);
    });

    it('should pass constraints to the LLM prompt', async () => {
      await decomposer.decompose({
        description: 'Build a CLI tool',
        constraints: {
          maxSubTasks: 5,
          maxDepthLevels: 2,
          budgetTokens: 100_000,
        },
      });

      const callArgs = litellmClient.chatCompletion.mock.calls[0][0];
      const userMessage = callArgs.messages[1].content;
      expect(userMessage).toContain('Maximum sub-tasks: 5');
      expect(userMessage).toContain('Maximum DAG depth: 2');
      expect(userMessage).toContain('Total token budget: 100000');
    });
  });

  describe('preview', () => {
    it('should return result and validation without persisting', async () => {
      const preview = await decomposer.preview({
        description: 'Refactor auth module',
      });

      expect(preview.result.tasks).toHaveLength(3);
      expect(preview.validationErrors).toHaveLength(0);

      // Should NOT call persistence methods
      expect(taskGraphStore.createGraph).not.toHaveBeenCalled();
      expect(taskGraphStore.addDefinition).not.toHaveBeenCalled();
    });
  });

  describe('validation', () => {
    it('should detect duplicate tempIds', async () => {
      const badResult: DecompositionResult = {
        ...VALID_LLM_RESULT,
        tasks: [
          { ...VALID_LLM_RESULT.tasks[0], tempId: 'dup' },
          { ...VALID_LLM_RESULT.tasks[1], tempId: 'dup' },
        ],
        edges: [],
        suggestedApprovalGates: [],
      };

      litellmClient = createMockLitellmClient(badResult);
      decomposer = new TaskDecomposer({
        litellmClient: litellmClient as never,
        agentProfileStore: agentProfileStore as never,
        workerNodeStore: workerNodeStore as never,
        taskGraphStore: taskGraphStore as never,
        logger,
        modelId: 'test-model',
      });

      const response = await decomposer.decompose({ description: 'test' });
      expect(response.validationErrors.some((e) => e.includes('Duplicate tempId'))).toBe(true);
    });

    it('should detect edges referencing unknown tempIds', async () => {
      const badResult: DecompositionResult = {
        ...VALID_LLM_RESULT,
        edges: [{ from: 'nonexistent', to: 't1', type: 'blocks' }],
      };

      litellmClient = createMockLitellmClient(badResult);
      decomposer = new TaskDecomposer({
        litellmClient: litellmClient as never,
        agentProfileStore: agentProfileStore as never,
        workerNodeStore: workerNodeStore as never,
        taskGraphStore: taskGraphStore as never,
        logger,
        modelId: 'test-model',
      });

      const response = await decomposer.decompose({ description: 'test' });
      expect(response.validationErrors.some((e) => e.includes('unknown "from" tempId'))).toBe(true);
    });

    it('should detect cycles in the graph', async () => {
      const cyclicResult: DecompositionResult = {
        ...VALID_LLM_RESULT,
        tasks: [
          { ...VALID_LLM_RESULT.tasks[0], tempId: 'a' },
          { ...VALID_LLM_RESULT.tasks[1], tempId: 'b' },
        ],
        edges: [
          { from: 'a', to: 'b', type: 'blocks' },
          { from: 'b', to: 'a', type: 'blocks' },
        ],
        suggestedApprovalGates: [],
      };

      litellmClient = createMockLitellmClient(cyclicResult);
      decomposer = new TaskDecomposer({
        litellmClient: litellmClient as never,
        agentProfileStore: agentProfileStore as never,
        workerNodeStore: workerNodeStore as never,
        taskGraphStore: taskGraphStore as never,
        logger,
        modelId: 'test-model',
      });

      const response = await decomposer.decompose({ description: 'test' });
      expect(response.validationErrors.some((e) => e.includes('cycle'))).toBe(true);
    });

    it('should detect unknown capabilities', async () => {
      const badCapResult: DecompositionResult = {
        ...VALID_LLM_RESULT,
        tasks: [
          {
            ...VALID_LLM_RESULT.tasks[0],
            requiredCapabilities: ['quantum-computing'],
          },
        ],
        edges: [],
        suggestedApprovalGates: [],
      };

      litellmClient = createMockLitellmClient(badCapResult);
      decomposer = new TaskDecomposer({
        litellmClient: litellmClient as never,
        agentProfileStore: agentProfileStore as never,
        workerNodeStore: workerNodeStore as never,
        taskGraphStore: taskGraphStore as never,
        logger,
        modelId: 'test-model',
      });

      const response = await decomposer.decompose({ description: 'test' });
      expect(response.validationErrors.some((e) => e.includes('unknown capability'))).toBe(true);
    });

    it('should detect too many sub-tasks', async () => {
      const manyTasks: DecompositionResult = {
        ...VALID_LLM_RESULT,
        tasks: Array.from({ length: 12 }, (_, i) => ({
          tempId: `t${i}`,
          type: 'task' as const,
          name: `Task ${i}`,
          description: `Description ${i}`,
          requiredCapabilities: ['typescript'],
          estimatedTokens: 10_000,
          timeoutMs: 3_600_000,
        })),
        edges: [],
        suggestedApprovalGates: [],
      };

      litellmClient = createMockLitellmClient(manyTasks);
      decomposer = new TaskDecomposer({
        litellmClient: litellmClient as never,
        agentProfileStore: agentProfileStore as never,
        workerNodeStore: workerNodeStore as never,
        taskGraphStore: taskGraphStore as never,
        logger,
        modelId: 'test-model',
      });

      const response = await decomposer.decompose({ description: 'test' });
      expect(response.validationErrors.some((e) => e.includes('Too many sub-tasks'))).toBe(true);
    });

    it('should detect DAG depth exceeding limit', async () => {
      // Build a chain of 6 tasks (depth 6 > default 4)
      const deepResult: DecompositionResult = {
        ...VALID_LLM_RESULT,
        tasks: Array.from({ length: 6 }, (_, i) => ({
          tempId: `t${i}`,
          type: 'task' as const,
          name: `Task ${i}`,
          description: `Description ${i}`,
          requiredCapabilities: ['typescript'],
          estimatedTokens: 10_000,
          timeoutMs: 3_600_000,
        })),
        edges: Array.from({ length: 5 }, (_, i) => ({
          from: `t${i}`,
          to: `t${i + 1}`,
          type: 'blocks' as const,
        })),
        suggestedApprovalGates: [],
      };

      litellmClient = createMockLitellmClient(deepResult);
      decomposer = new TaskDecomposer({
        litellmClient: litellmClient as never,
        agentProfileStore: agentProfileStore as never,
        workerNodeStore: workerNodeStore as never,
        taskGraphStore: taskGraphStore as never,
        logger,
        modelId: 'test-model',
      });

      const response = await decomposer.decompose({ description: 'test' });
      expect(response.validationErrors.some((e) => e.includes('DAG depth'))).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should throw on empty LLM response', async () => {
      litellmClient.chatCompletion.mockResolvedValue({
        id: 'chatcmpl-1',
        object: 'chat.completion',
        model: 'test',
        choices: [{ index: 0, message: { role: 'assistant', content: '' }, finishReason: 'stop' }],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      });

      await expect(decomposer.decompose({ description: 'test' })).rejects.toThrow(
        'LLM returned an empty response',
      );
    });

    it('should throw on invalid JSON from LLM', async () => {
      litellmClient.chatCompletion.mockResolvedValue({
        id: 'chatcmpl-1',
        object: 'chat.completion',
        model: 'test',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'not json at all' },
            finishReason: 'stop',
          },
        ],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      });

      await expect(decomposer.decompose({ description: 'test' })).rejects.toThrow('not valid JSON');
    });

    it('should throw when tasks array is missing', async () => {
      litellmClient.chatCompletion.mockResolvedValue({
        id: 'chatcmpl-1',
        object: 'chat.completion',
        model: 'test',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: JSON.stringify({ edges: [] }) },
            finishReason: 'stop',
          },
        ],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      });

      await expect(decomposer.decompose({ description: 'test' })).rejects.toThrow(
        'missing "tasks" array',
      );
    });
  });
});
