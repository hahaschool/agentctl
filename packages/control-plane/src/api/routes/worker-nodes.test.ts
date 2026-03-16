import type { AgentProfileStore } from '../../collaboration/agent-profile-store.js';
import type { TaskRunStore } from '../../collaboration/task-run-store.js';
import type { WorkerNodeStore } from '../../collaboration/worker-node-store.js';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { workerNodeRoutes } from './worker-nodes.js';

const NOW = new Date().toISOString();

describe('worker node routes', () => {
  let app: FastifyInstance;

  const mockWorkerNodeStore = {
    listNodes: vi.fn().mockResolvedValue([
      {
        id: 'node-1',
        hostname: 'alpha',
        tailscaleIp: '100.64.0.1',
        maxConcurrentAgents: 4,
        currentLoad: 1,
        capabilities: ['typescript'],
        status: 'online',
        lastHeartbeatAt: NOW,
        createdAt: NOW,
      },
      {
        id: 'node-2',
        hostname: 'beta',
        tailscaleIp: '100.64.0.2',
        maxConcurrentAgents: 4,
        currentLoad: 0,
        capabilities: ['python'],
        status: 'offline',
        lastHeartbeatAt: NOW,
        createdAt: NOW,
      },
      {
        id: 'node-3',
        hostname: 'gamma',
        tailscaleIp: '100.64.0.3',
        maxConcurrentAgents: 2,
        currentLoad: 1,
        capabilities: ['go'],
        status: 'draining',
        lastHeartbeatAt: NOW,
        createdAt: NOW,
      },
    ]),
  } as unknown as WorkerNodeStore;

  const mockTaskRunStore = {
    listRuns: vi.fn().mockResolvedValue([
      {
        id: 'run-1',
        definitionId: 'task-1',
        spaceId: null,
        threadId: null,
        status: 'running',
        attempt: 1,
        assigneeInstanceId: null,
        machineId: 'node-1',
        claimedAt: NOW,
        startedAt: NOW,
        completedAt: null,
        lastHeartbeatAt: NOW,
        result: null,
        error: null,
        createdAt: NOW,
      },
      {
        id: 'run-2',
        definitionId: 'task-2',
        spaceId: null,
        threadId: null,
        status: 'claimed',
        attempt: 1,
        assigneeInstanceId: null,
        machineId: 'node-1',
        claimedAt: NOW,
        startedAt: null,
        completedAt: null,
        lastHeartbeatAt: NOW,
        result: null,
        error: null,
        createdAt: NOW,
      },
      {
        id: 'run-3',
        definitionId: 'task-3',
        spaceId: null,
        threadId: null,
        status: 'pending',
        attempt: 1,
        assigneeInstanceId: null,
        machineId: null,
        claimedAt: null,
        startedAt: null,
        completedAt: null,
        lastHeartbeatAt: null,
        result: null,
        error: null,
        createdAt: NOW,
      },
      {
        id: 'run-4',
        definitionId: 'task-4',
        spaceId: null,
        threadId: null,
        status: 'completed',
        attempt: 1,
        assigneeInstanceId: 'instance-3',
        machineId: 'node-2',
        claimedAt: NOW,
        startedAt: NOW,
        completedAt: NOW,
        lastHeartbeatAt: NOW,
        result: null,
        error: null,
        createdAt: NOW,
      },
      {
        id: 'run-5',
        definitionId: 'task-5',
        spaceId: null,
        threadId: null,
        status: 'failed',
        attempt: 1,
        assigneeInstanceId: 'instance-4',
        machineId: 'node-3',
        claimedAt: NOW,
        startedAt: NOW,
        completedAt: NOW,
        lastHeartbeatAt: NOW,
        result: null,
        error: { message: 'boom' },
        createdAt: NOW,
      },
    ]),
  } as unknown as TaskRunStore;

  const mockAgentProfileStore = {
    countInstances: vi.fn().mockResolvedValue(4),
  } as unknown as AgentProfileStore;

  beforeAll(async () => {
    app = Fastify();
    await app.register(workerNodeRoutes, {
      prefix: '/api/fleet/nodes',
      workerNodeStore: mockWorkerNodeStore,
      taskRunStore: mockTaskRunStore,
      agentProfileStore: mockAgentProfileStore,
    } as never);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    (mockWorkerNodeStore.listNodes as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'node-1',
        hostname: 'alpha',
        tailscaleIp: '100.64.0.1',
        maxConcurrentAgents: 4,
        currentLoad: 1,
        capabilities: ['typescript'],
        status: 'online',
        lastHeartbeatAt: NOW,
        createdAt: NOW,
      },
      {
        id: 'node-2',
        hostname: 'beta',
        tailscaleIp: '100.64.0.2',
        maxConcurrentAgents: 4,
        currentLoad: 0,
        capabilities: ['python'],
        status: 'offline',
        lastHeartbeatAt: NOW,
        createdAt: NOW,
      },
      {
        id: 'node-3',
        hostname: 'gamma',
        tailscaleIp: '100.64.0.3',
        maxConcurrentAgents: 2,
        currentLoad: 1,
        capabilities: ['go'],
        status: 'draining',
        lastHeartbeatAt: NOW,
        createdAt: NOW,
      },
    ]);
    (mockTaskRunStore.listRuns as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'run-1',
        definitionId: 'task-1',
        spaceId: null,
        threadId: null,
        status: 'running',
        attempt: 1,
        assigneeInstanceId: null,
        machineId: 'node-1',
        claimedAt: NOW,
        startedAt: NOW,
        completedAt: null,
        lastHeartbeatAt: NOW,
        result: null,
        error: null,
        createdAt: NOW,
      },
      {
        id: 'run-2',
        definitionId: 'task-2',
        spaceId: null,
        threadId: null,
        status: 'claimed',
        attempt: 1,
        assigneeInstanceId: null,
        machineId: 'node-1',
        claimedAt: NOW,
        startedAt: null,
        completedAt: null,
        lastHeartbeatAt: NOW,
        result: null,
        error: null,
        createdAt: NOW,
      },
      {
        id: 'run-3',
        definitionId: 'task-3',
        spaceId: null,
        threadId: null,
        status: 'pending',
        attempt: 1,
        assigneeInstanceId: null,
        machineId: null,
        claimedAt: null,
        startedAt: null,
        completedAt: null,
        lastHeartbeatAt: null,
        result: null,
        error: null,
        createdAt: NOW,
      },
      {
        id: 'run-4',
        definitionId: 'task-4',
        spaceId: null,
        threadId: null,
        status: 'completed',
        attempt: 1,
        assigneeInstanceId: 'instance-3',
        machineId: 'node-2',
        claimedAt: NOW,
        startedAt: NOW,
        completedAt: NOW,
        lastHeartbeatAt: NOW,
        result: null,
        error: null,
        createdAt: NOW,
      },
      {
        id: 'run-5',
        definitionId: 'task-5',
        spaceId: null,
        threadId: null,
        status: 'failed',
        attempt: 1,
        assigneeInstanceId: 'instance-4',
        machineId: 'node-3',
        claimedAt: NOW,
        startedAt: NOW,
        completedAt: NOW,
        lastHeartbeatAt: NOW,
        result: null,
        error: { message: 'boom' },
        createdAt: NOW,
      },
    ]);
    (mockAgentProfileStore.countInstances as ReturnType<typeof vi.fn>).mockResolvedValue(4);
  });

  it('GET /api/fleet/nodes/overview returns live totalAgentInstances counts', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/fleet/nodes/overview',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      totalNodes: 3,
      onlineNodes: 1,
      offlineNodes: 1,
      drainingNodes: 1,
      totalAgentInstances: 4,
      activeTaskRuns: 2,
      pendingTaskRuns: 1,
      completedTaskRuns: 1,
      failedTaskRuns: 1,
    });
    expect(mockAgentProfileStore.countInstances).toHaveBeenCalledOnce();
  });
});
