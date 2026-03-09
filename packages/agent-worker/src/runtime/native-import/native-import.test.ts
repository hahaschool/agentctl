import { describe, expect, it } from 'vitest';

import { tryClaudeToCodexImport } from './claude-to-codex.js';
import { tryCodexToClaudeImport } from './codex-to-claude.js';

describe('native import probes', () => {
  it('returns a typed failure for Claude to Codex import scaffolding', async () => {
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
  });

  it('returns a typed failure for Codex to Claude import scaffolding', async () => {
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
    expect(result.reason).toBe('not_implemented');
  });
});
