import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockLogger } from '../api/routes/test-helpers.js';
import type { Database } from '../db/index.js';
import { ManagedSessionStore } from './managed-session-store.js';
import { createMockDb, type MockDb } from './test-helpers.js';

describe('ManagedSessionStore', () => {
  let mockDb: MockDb;
  let store: ManagedSessionStore;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
    store = new ManagedSessionStore(mockDb as unknown as Database, createMockLogger());
  });

  it('creates a managed session row and returns the mapped session', async () => {
    mockDb.returning.mockResolvedValue([
      {
        id: 'ms-1',
        runtime: 'codex',
        nativeSessionId: null,
        machineId: 'machine-1',
        agentId: 'agent-1',
        projectPath: '/workspace/app',
        worktreePath: '/workspace/.trees/task-1',
        status: 'starting',
        configVersion: 7,
        handoffStrategy: null,
        handoffSourceSessionId: null,
        metadata: { source: 'manual' },
        startedAt: new Date('2026-03-09T10:00:00Z'),
        lastHeartbeat: null,
        endedAt: null,
      },
    ]);

    const session = await store.create({
      runtime: 'codex',
      nativeSessionId: null,
      machineId: 'machine-1',
      agentId: 'agent-1',
      projectPath: '/workspace/app',
      worktreePath: '/workspace/.trees/task-1',
      status: 'starting',
      configRevision: 7,
      handoffStrategy: null,
      handoffSourceSessionId: null,
      metadata: { source: 'manual' },
    });

    expect(mockDb.insert).toHaveBeenCalledOnce();
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: 'codex',
        machineId: 'machine-1',
        projectPath: '/workspace/app',
        configVersion: 7,
      }),
    );
    expect(session).toMatchObject({
      id: 'ms-1',
      runtime: 'codex',
      machineId: 'machine-1',
      status: 'starting',
      configRevision: 7,
    });
  });

  it('lists managed sessions with filters and returns mapped results', async () => {
    mockDb.limit.mockResolvedValue([
      {
        id: 'ms-2',
        runtime: 'claude-code',
        nativeSessionId: 'native-1',
        machineId: 'machine-1',
        agentId: null,
        projectPath: '/workspace/api',
        worktreePath: null,
        status: 'active',
        configVersion: 8,
        handoffStrategy: 'snapshot-handoff',
        handoffSourceSessionId: 'ms-1',
        metadata: {},
        startedAt: new Date('2026-03-09T11:00:00Z'),
        lastHeartbeat: new Date('2026-03-09T11:10:00Z'),
        endedAt: null,
      },
    ]);

    const sessions = await store.list({
      machineId: 'machine-1',
      runtime: 'claude-code',
      status: 'active',
      limit: 10,
    });

    expect(mockDb.select).toHaveBeenCalledOnce();
    expect(mockDb.where).toHaveBeenCalledOnce();
    expect(mockDb.orderBy).toHaveBeenCalledOnce();
    expect(mockDb.limit).toHaveBeenCalledWith(10);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: 'ms-2',
      runtime: 'claude-code',
      status: 'active',
      configRevision: 8,
      handoffStrategy: 'snapshot-handoff',
    });
  });

  it('updates session status and returns the updated session', async () => {
    mockDb.returning.mockResolvedValue([
      {
        id: 'ms-1',
        runtime: 'codex',
        nativeSessionId: 'native-1',
        machineId: 'machine-1',
        agentId: 'agent-1',
        projectPath: '/workspace/app',
        worktreePath: null,
        status: 'ended',
        configVersion: 7,
        handoffStrategy: 'native-import',
        handoffSourceSessionId: null,
        metadata: { source: 'manual' },
        startedAt: new Date('2026-03-09T10:00:00Z'),
        lastHeartbeat: new Date('2026-03-09T10:30:00Z'),
        endedAt: new Date('2026-03-09T10:40:00Z'),
      },
    ]);

    const session = await store.updateStatus('ms-1', 'ended', {
      nativeSessionId: 'native-1',
      handoffStrategy: 'native-import',
      endedAt: new Date('2026-03-09T10:40:00Z'),
    });

    expect(mockDb.update).toHaveBeenCalledOnce();
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ended',
        nativeSessionId: 'native-1',
        handoffStrategy: 'native-import',
      }),
    );
    expect(session.status).toBe('ended');
    expect(session.handoffStrategy).toBe('native-import');
  });

  it('returns a managed session by id when it exists', async () => {
    mockDb.limit.mockResolvedValue([
      {
        id: 'ms-lookup',
        runtime: 'codex',
        nativeSessionId: 'codex-native-1',
        machineId: 'machine-1',
        agentId: 'agent-1',
        projectPath: '/workspace/app',
        worktreePath: null,
        status: 'active',
        configVersion: 7,
        handoffStrategy: null,
        handoffSourceSessionId: null,
        metadata: {},
        startedAt: new Date('2026-03-09T10:00:00Z'),
        lastHeartbeat: new Date('2026-03-09T10:05:00Z'),
        endedAt: null,
      },
    ]);

    const session = await store.get('ms-lookup');

    expect(mockDb.select).toHaveBeenCalledOnce();
    expect(mockDb.where).toHaveBeenCalledOnce();
    expect(mockDb.limit).toHaveBeenCalledWith(1);
    expect(session?.id).toBe('ms-lookup');
    expect(session?.runtime).toBe('codex');
  });

  it('patches metadata without overwriting unrelated fields', async () => {
    mockDb.limit.mockResolvedValueOnce([
      {
        id: 'ms-merge',
        runtime: 'claude-code',
        nativeSessionId: 'claude-native-1',
        machineId: 'machine-1',
        agentId: null,
        projectPath: '/workspace/app',
        worktreePath: null,
        status: 'active',
        configVersion: 8,
        handoffStrategy: null,
        handoffSourceSessionId: null,
        metadata: {
          reason: 'manual',
          sourceRuntime: 'claude-code',
          manualTakeover: {
            status: 'starting',
            workerSessionId: 'rc-old',
          },
        },
        startedAt: new Date('2026-03-11T10:00:00Z'),
        lastHeartbeat: new Date('2026-03-11T10:05:00Z'),
        endedAt: null,
      },
    ]);

    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'ms-merge',
        runtime: 'claude-code',
        nativeSessionId: 'claude-native-1',
        machineId: 'machine-1',
        agentId: null,
        projectPath: '/workspace/app',
        worktreePath: null,
        status: 'active',
        configVersion: 8,
        handoffStrategy: null,
        handoffSourceSessionId: null,
        metadata: {
          reason: 'manual',
          sourceRuntime: 'claude-code',
          manualTakeover: {
            status: 'online',
            workerSessionId: 'rc-1',
            sessionUrl: 'https://claude.ai/code/session-123',
          },
        },
        startedAt: new Date('2026-03-11T10:00:00Z'),
        lastHeartbeat: new Date('2026-03-11T10:10:00Z'),
        endedAt: null,
      },
    ]);

    const updated = await store.patchMetadata('ms-merge', {
      manualTakeover: {
        status: 'online',
        workerSessionId: 'rc-1',
        sessionUrl: 'https://claude.ai/code/session-123',
      },
    });

    expect(mockDb.set).toHaveBeenCalledWith({
      metadata: {
        reason: 'manual',
        sourceRuntime: 'claude-code',
        manualTakeover: {
          status: 'online',
          workerSessionId: 'rc-1',
          sessionUrl: 'https://claude.ai/code/session-123',
        },
      },
    });
    expect(updated.metadata).toEqual({
      reason: 'manual',
      sourceRuntime: 'claude-code',
      manualTakeover: {
        status: 'online',
        workerSessionId: 'rc-1',
        sessionUrl: 'https://claude.ai/code/session-123',
      },
    });
  });
});
