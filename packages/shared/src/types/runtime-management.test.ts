import { describe, expect, it } from 'vitest';

import type {
  HandoffSnapshot,
  ManagedRuntime,
  ManagedRuntimeConfig,
  ManagedSession,
} from './runtime-management.js';
import {
  HANDOFF_STRATEGIES,
  MANAGED_RUNTIMES,
  MANAGED_SESSION_STATUSES,
  isHandoffStrategy,
  isManagedRuntime,
  isManagedSessionStatus,
} from './runtime-management.js';

describe('runtime-management types', () => {
  it('defines the managed runtimes used by unified runtime orchestration', () => {
    const runtimes: ManagedRuntime[] = ['claude-code', 'codex'];
    expect(runtimes).toEqual(MANAGED_RUNTIMES);
    expect(isManagedRuntime('codex')).toBe(true);
    expect(isManagedRuntime('nanoclaw')).toBe(false);
  });

  it('defines handoff and session lifecycle constants', () => {
    expect(MANAGED_SESSION_STATUSES).toEqual([
      'starting',
      'active',
      'paused',
      'handing_off',
      'ended',
      'error',
    ]);
    expect(HANDOFF_STRATEGIES).toEqual(['native-import', 'snapshot-handoff']);
    expect(isManagedSessionStatus('handing_off')).toBe(true);
    expect(isManagedSessionStatus('running')).toBe(false);
    expect(isHandoffStrategy('snapshot-handoff')).toBe(true);
    expect(isHandoffStrategy('fork')).toBe(false);
  });

  it('supports canonical runtime config documents', () => {
    const config: ManagedRuntimeConfig = {
      version: 3,
      hash: 'sha256:abc123',
      instructions: {
        userGlobal: 'Follow the repo instructions.',
        projectTemplate: 'Use the managed config bundle.',
      },
      mcpServers: [
        {
          id: 'mem0',
          name: 'Mem0',
          command: 'mem0-mcp',
          args: ['--stdio'],
          env: { MEM0_API_KEY: 'env:MEM0_API_KEY' },
        },
      ],
      skills: [
        {
          id: 'systematic-debugging',
          path: '.claude/skills/systematic-debugging.md',
          enabled: true,
        },
      ],
      sandbox: 'workspace-write',
      approvalPolicy: 'on-request',
      environmentPolicy: {
        inherit: ['PATH'],
        set: { AGENTCTL_MANAGED: '1' },
      },
      runtimeOverrides: {
        claudeCode: { model: 'sonnet' },
        codex: { model: 'gpt-5-codex' },
      },
    };

    expect(config.mcpServers).toHaveLength(1);
    expect(config.skills[0]?.enabled).toBe(true);
    expect(config.runtimeOverrides.codex?.model).toBe('gpt-5-codex');
  });

  it('supports portable managed session and handoff snapshot types', () => {
    const session: ManagedSession = {
      id: 'ms-1',
      runtime: 'codex',
      nativeSessionId: 'native-123',
      machineId: 'machine-1',
      agentId: 'agent-1',
      projectPath: '/tmp/project',
      worktreePath: '/tmp/project/.trees/agent-1',
      status: 'active',
      configRevision: 3,
      handoffStrategy: 'snapshot-handoff',
      handoffSourceSessionId: null,
      metadata: { model: 'gpt-5-codex' },
    };

    const snapshot: HandoffSnapshot = {
      sourceRuntime: 'claude-code',
      sourceSessionId: 'ms-parent',
      projectPath: '/tmp/project',
      worktreePath: '/tmp/project/.trees/agent-1',
      branch: 'codex/runtime-unification-fresh',
      headSha: 'abc123',
      dirtyFiles: ['packages/shared/src/types/agent.ts'],
      diffSummary: 'Added codex runtime support.',
      conversationSummary: 'User wants seamless Claude/Codex switching.',
      openTodos: ['Implement shared runtime-management contracts'],
      nextSuggestedPrompt: 'Continue with Task 2.',
      activeConfigRevision: 3,
      activeMcpServers: ['mem0'],
      activeSkills: ['systematic-debugging'],
      reason: 'manual',
    };

    expect(session.runtime).toBe('codex');
    expect(snapshot.reason).toBe('manual');
    expect(snapshot.activeConfigRevision).toBe(3);
  });
});
