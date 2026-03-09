import { describe, expect, it, vi } from 'vitest';

import { tryClaudeToCodexImport } from './claude-to-codex.js';
import { tryCodexToClaudeImport } from './codex-to-claude.js';

const { mockProbeNativeImportPrerequisites } = vi.hoisted(() => ({
  mockProbeNativeImportPrerequisites: vi.fn(),
}));

vi.mock('./probe.js', () => ({
  probeNativeImportPrerequisites: (input: unknown) => mockProbeNativeImportPrerequisites(input),
}));

describe('native import probes', () => {
  it('returns a typed failure for Claude to Codex import scaffolding', async () => {
    mockProbeNativeImportPrerequisites.mockResolvedValueOnce({
      reason: 'not_implemented',
      metadata: {
        targetCli: { command: 'codex', available: true, version: 'codex-cli test' },
        sourceStorage: { rootPath: '/tmp/.claude/projects', exists: true, sessionLocated: true },
        prerequisitesMet: true,
      },
    });

    const result = await tryClaudeToCodexImport({
      agentId: 'agent-1',
      projectPath: '/workspace/app',
      prompt: 'Continue from this handoff.',
      snapshot: {
        sourceRuntime: 'claude-code',
        sourceSessionId: 'ms-source',
        projectPath: '/workspace/app',
        worktreePath: '/workspace/app/.trees/agent-1',
        branch: 'main',
        headSha: 'abc123',
        dirtyFiles: [],
        diffSummary: 'No diff.',
        conversationSummary: 'Continue from Claude.',
        openTodos: [],
        nextSuggestedPrompt: 'Continue from the handoff snapshot.',
        activeConfigRevision: 9,
        activeMcpServers: [],
        activeSkills: [],
        reason: 'manual',
      },
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not_implemented');
    expect(result.metadata.probe).toBe('claude-to-codex');
    expect(result.metadata.targetCli).toEqual({
      command: 'codex',
      available: true,
      version: 'codex-cli test',
    });
    expect(result.metadata.prerequisitesMet).toBe(true);
  });

  it('returns a typed failure for Codex to Claude import scaffolding', async () => {
    mockProbeNativeImportPrerequisites.mockResolvedValueOnce({
      reason: 'target_cli_unavailable',
      metadata: {
        targetCli: { command: 'claude', available: false, version: null },
        sourceStorage: { rootPath: '/tmp/.codex', exists: true, sessionLocated: false },
        prerequisitesMet: false,
      },
    });

    const result = await tryCodexToClaudeImport({
      agentId: 'agent-1',
      projectPath: '/workspace/app',
      prompt: 'Continue from this handoff.',
      snapshot: {
        sourceRuntime: 'codex',
        sourceSessionId: 'ms-source',
        projectPath: '/workspace/app',
        worktreePath: '/workspace/app/.trees/agent-1',
        branch: 'main',
        headSha: 'abc123',
        dirtyFiles: [],
        diffSummary: 'No diff.',
        conversationSummary: 'Continue from Codex.',
        openTodos: [],
        nextSuggestedPrompt: 'Continue from the handoff snapshot.',
        activeConfigRevision: 9,
        activeMcpServers: [],
        activeSkills: [],
        reason: 'manual',
      },
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('target_cli_unavailable');
    expect(result.metadata.probe).toBe('codex-to-claude');
    expect(result.metadata.targetCli).toEqual({
      command: 'claude',
      available: false,
      version: null,
    });
    expect(result.metadata.prerequisitesMet).toBe(false);
  });
});
