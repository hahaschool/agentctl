import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { tryClaudeToCodexImport } from './claude-to-codex.js';
import { tryCodexToClaudeImport } from './codex-to-claude.js';

const { mockProbeNativeImportPrerequisites } = vi.hoisted(() => ({
  mockProbeNativeImportPrerequisites: vi.fn(),
}));

vi.mock('./probe.js', () => ({
  probeNativeImportPrerequisites: (input: unknown) => mockProbeNativeImportPrerequisites(input),
}));

describe('native import probes', () => {
  const originalCodexHome = process.env.CODEX_HOME;
  const tempDirs: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (originalCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodexHome;
    }

    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('materializes and resumes a synthetic Codex session for Claude imports', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'agentctl-codex-home-'));
    tempDirs.push(codexHome);
    process.env.CODEX_HOME = codexHome;

    mockProbeNativeImportPrerequisites.mockResolvedValueOnce({
      reason: 'not_implemented',
      metadata: {
        targetCli: { command: 'codex', available: true, version: 'codex-cli test' },
        sourceStorage: {
          rootPath: '/tmp/.claude/projects',
          exists: true,
          sessionLocated: true,
          sessionPath: '/tmp/.claude/projects/session.jsonl',
        },
        prerequisitesMet: true,
        sourceSessionSummary: {
          recentMessages: [
            { role: 'user', text: 'Please continue the runtime handoff implementation.' },
            { role: 'assistant', text: 'I am ready to continue in Codex.' },
          ],
        },
      },
    });

    const resumeTargetSession = vi.fn(async ({ nativeSessionId }: { nativeSessionId: string }) => ({
      runtime: 'codex' as const,
      sessionId: 'managed-codex-1',
      nativeSessionId,
      agentId: 'agent-1',
      projectPath: '/workspace/app',
      model: 'gpt-5-codex',
      status: 'active' as const,
      pid: 1234,
      startedAt: new Date('2026-03-10T00:00:00.000Z'),
      lastActivity: new Date('2026-03-10T00:00:05.000Z'),
    }));

    const result = await tryClaudeToCodexImport({
      agentId: 'agent-1',
      projectPath: '/workspace/app',
      prompt: 'Continue from this handoff.',
      resumeTargetSession,
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

    expect(result.ok).toBe(true);
    expect(result.reason).toBe('succeeded');
    expect(result.metadata.probe).toBe('claude-to-codex');
    expect(resumeTargetSession).toHaveBeenCalledTimes(1);

    const materializedSession = result.metadata.materializedSession as {
      nativeSessionId: string;
      sessionPath: string;
      indexPath: string;
    };
    expect(materializedSession.nativeSessionId).toBe(result.session?.nativeSessionId);

    const sessionIndex = await readFile(materializedSession.indexPath, 'utf8');
    expect(sessionIndex).toContain(materializedSession.nativeSessionId);

    const sessionFile = await readFile(materializedSession.sessionPath, 'utf8');
    expect(sessionFile).toContain('Imported from claude-code session ms-source.');
    expect(sessionFile).toContain('Please continue the runtime handoff implementation.');
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

  it('returns a typed resume failure when Codex cannot open the materialized session', async () => {
    const codexHome = await mkdtemp(join(tmpdir(), 'agentctl-codex-home-'));
    tempDirs.push(codexHome);
    process.env.CODEX_HOME = codexHome;

    mockProbeNativeImportPrerequisites.mockResolvedValueOnce({
      reason: 'not_implemented',
      metadata: {
        targetCli: { command: 'codex', available: true, version: 'codex-cli test' },
        sourceStorage: {
          rootPath: '/tmp/.claude/projects',
          exists: true,
          sessionLocated: true,
          sessionPath: '/tmp/.claude/projects/session.jsonl',
        },
        prerequisitesMet: true,
      },
    });

    const result = await tryClaudeToCodexImport({
      agentId: 'agent-1',
      projectPath: '/workspace/app',
      prompt: 'Continue from this handoff.',
      resumeTargetSession: vi.fn(async () => {
        throw new Error('Codex resume failed');
      }),
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
    expect(result.reason).toBe('resume_failed');
    expect(result.metadata.error).toBe('Codex resume failed');
  });
});
