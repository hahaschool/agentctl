import { describe, expect, it } from 'vitest';

import type {
  ExportHandoffSnapshotRequest,
  ExportHandoffSnapshotResponse,
  ManagedSessionHandoffResponse,
  NativeImportPreflightResponse,
  NativeImportAttempt,
  StartHandoffRequest,
  StartHandoffResponse,
} from './handoff.js';

describe('handoff protocol', () => {
  it('defines snapshot export and target handoff payloads', () => {
    const exportRequest: ExportHandoffSnapshotRequest = {
      sourceRuntime: 'codex',
      sourceSessionId: 'ms-source',
      projectPath: '/workspace/app',
      worktreePath: '/workspace/app/.trees/agent-1',
      activeConfigRevision: 9,
      reason: 'manual',
      prompt: 'Continue from the latest runtime state.',
      activeMcpServers: ['mem0'],
      activeSkills: ['systematic-debugging'],
    };

    const exportResponse: ExportHandoffSnapshotResponse = {
      ok: true,
      strategy: 'snapshot-handoff',
      snapshot: {
        sourceRuntime: 'codex',
        sourceSessionId: 'ms-source',
        sourceNativeSessionId: 'codex-native-1',
        projectPath: '/workspace/app',
        worktreePath: '/workspace/app/.trees/agent-1',
        branch: 'codex/runtime-unification-fresh',
        headSha: 'abc123',
        dirtyFiles: ['packages/shared/src/protocol/handoff.ts'],
        diffSummary: 'Added runtime handoff protocol.',
        conversationSummary: 'Continue on Claude from the current Codex worktree state.',
        openTodos: ['implement worker handoff controller'],
        nextSuggestedPrompt: 'Continue with the snapshot handoff flow.',
        activeConfigRevision: 9,
        activeMcpServers: ['mem0'],
        activeSkills: ['systematic-debugging'],
        reason: 'manual',
      },
    };

    const startRequest: StartHandoffRequest = {
      targetRuntime: 'claude-code',
      agentId: 'agent-1',
      projectPath: '/workspace/app',
      prompt: 'Continue from the exported snapshot.',
      snapshot: exportResponse.snapshot,
    };

    const startResponse: StartHandoffResponse = {
      ok: true,
      strategy: 'snapshot-handoff',
      attemptedStrategies: ['native-import', 'snapshot-handoff'],
      nativeImportAttempt: {
        ok: false,
        sourceRuntime: 'codex',
        targetRuntime: 'claude-code',
        reason: 'not_implemented',
        metadata: { probe: 'codex-to-claude' },
      },
      snapshot: exportResponse.snapshot,
      session: {
        runtime: 'claude-code',
        sessionId: 'worker-1',
        nativeSessionId: 'claude-native-1',
        agentId: 'agent-1',
        projectPath: '/workspace/app',
        model: 'sonnet',
        status: 'active',
      },
    };

    const managedResponse: ManagedSessionHandoffResponse = {
      ok: true,
      handoffId: 'handoff-1',
      strategy: 'snapshot-handoff',
      attemptedStrategies: ['native-import', 'snapshot-handoff'],
      nativeImportAttempt: startResponse.nativeImportAttempt,
      snapshot: exportResponse.snapshot,
      session: {
        id: 'ms-target',
        runtime: 'claude-code',
        nativeSessionId: 'claude-native-1',
        machineId: 'machine-1',
        agentId: 'agent-1',
        projectPath: '/workspace/app',
        worktreePath: '/workspace/app/.trees/agent-1',
        status: 'active',
        configRevision: 9,
        handoffStrategy: 'snapshot-handoff',
        handoffSourceSessionId: 'ms-source',
        metadata: {},
      },
    };

    expect(exportRequest.reason).toBe('manual');
    expect(exportResponse.strategy).toBe('snapshot-handoff');
    expect(startRequest.targetRuntime).toBe('claude-code');
    expect(startResponse.attemptedStrategies).toEqual(['native-import', 'snapshot-handoff']);
    expect(startResponse.nativeImportAttempt?.reason).toBe('not_implemented');
    expect(managedResponse.session.handoffSourceSessionId).toBe('ms-source');
  });

  it('defines native import attempt reasons for experimental probe reporting', () => {
    const attempt: NativeImportAttempt = {
      ok: false,
      sourceRuntime: 'claude-code',
      targetRuntime: 'codex',
      reason: 'target_cli_unavailable',
      metadata: {
        targetCli: {
          command: 'codex',
          available: false,
          version: null,
        },
      },
    };

    expect(attempt.reason).toBe('target_cli_unavailable');
    expect(attempt.metadata.targetCli).toEqual({
      command: 'codex',
      available: false,
      version: null,
    });
  });

  it('defines native import preflight responses before a handoff starts', () => {
    const response: NativeImportPreflightResponse = {
      ok: true,
      nativeImportCapable: true,
      attempt: {
        ok: false,
        sourceRuntime: 'claude-code',
        targetRuntime: 'codex',
        reason: 'not_implemented',
        metadata: {
          sourceSessionSummary: {
            messageCounts: {
              user: 4,
              assistant: 3,
            },
          },
        },
      },
    };

    expect(response.ok).toBe(true);
    expect(response.nativeImportCapable).toBe(true);
    expect(response.attempt.reason).toBe('not_implemented');
  });
});
