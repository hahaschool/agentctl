import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClaudeRuntimeAdapter } from '../claude-runtime-adapter.js';
import { CliSessionManager } from '../cli-session-manager.js';
import { CodexRuntimeAdapter } from '../codex-runtime-adapter.js';
import { CodexSessionManager } from '../codex-session-manager.js';
import { tryClaudeToCodexImport } from './claude-to-codex.js';
import { tryCodexToClaudeImport } from './codex-to-claude.js';

type TempEnv = {
  root: string;
  binDir: string;
  homeDir: string;
  codexHome: string;
  logsDir: string;
};

const originalPath = process.env.PATH;
const originalHome = process.env.HOME;
const originalCodexHome = process.env.CODEX_HOME;
const tempDirs: string[] = [];
const cleanupManagers: Array<() => Promise<void>> = [];

describe('native import integration', () => {
  beforeEach(() => {
    cleanupManagers.length = 0;
  });

  afterEach(async () => {
    await Promise.all(cleanupManagers.splice(0).map((cleanup) => cleanup()));

    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodexHome;
    }

    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('imports a Claude source session into Codex using fake CLI binaries and sourceNativeSessionId', async () => {
    const env = await createTempEnv();
    const projectPath = await createProjectPath(env.root);
    const codexArgsLog = join(env.logsDir, 'codex-args.log');
    await installFakeCodex(env.binDir, codexArgsLog);
    await installFakeClaude(env.binDir, join(env.logsDir, 'claude-args.log'));
    await seedClaudeSourceSession(env.homeDir, projectPath, 'claude-native-source');

    const manager = new CodexSessionManager({
      codexPath: join(env.binDir, 'codex'),
      startupTimeoutMs: 50,
    });
    cleanupManagers.push(() => manager.stopAll());
    const adapter = new CodexRuntimeAdapter(manager);

    const result = await tryClaudeToCodexImport({
      agentId: 'agent-1',
      projectPath,
      prompt: 'Continue from imported Claude context.',
      snapshot: makeSnapshot({
        sourceRuntime: 'claude-code',
        sourceSessionId: 'ms-source',
        sourceNativeSessionId: 'claude-native-source',
        projectPath,
      }),
      resumeTargetSession: (input) =>
        adapter.resumeSession({
          agentId: 'agent-1',
          projectPath,
          nativeSessionId: input.nativeSessionId,
          prompt: input.prompt,
          model: input.model ?? null,
        }),
    });

    expect(result.ok).toBe(true);
    expect(result.session?.nativeSessionId).toBe(
      (result.metadata.materializedSession as { nativeSessionId: string }).nativeSessionId,
    );

    const materializedSession = result.metadata.materializedSession as { nativeSessionId: string };

    const codexArgs = await waitForFile(codexArgsLog, (content) =>
      content.includes(materializedSession.nativeSessionId),
    );
    expect(codexArgs).toContain('exec');
    expect(codexArgs).toContain('resume');
    expect(codexArgs).toContain(materializedSession.nativeSessionId);
  });

  it('imports a Codex source session into Claude using fake CLI binaries and CODEX_HOME', async () => {
    const env = await createTempEnv();
    const projectPath = await createProjectPath(env.root);
    const claudeArgsLog = join(env.logsDir, 'claude-args.log');
    await installFakeCodex(env.binDir, join(env.logsDir, 'codex-args.log'));
    await installFakeClaude(env.binDir, claudeArgsLog);
    await seedCodexSourceSession(env.codexHome, projectPath, 'codex-native-source');

    const manager = new CliSessionManager({
      claudePath: join(env.binDir, 'claude'),
    });
    cleanupManagers.push(async () => {
      await manager.stopAll();
      manager.destroy();
    });
    const adapter = new ClaudeRuntimeAdapter(manager);

    const result = await tryCodexToClaudeImport({
      agentId: 'agent-1',
      projectPath,
      prompt: 'Continue from imported Codex context.',
      snapshot: makeSnapshot({
        sourceRuntime: 'codex',
        sourceSessionId: 'ms-source',
        sourceNativeSessionId: 'codex-native-source',
        projectPath,
      }),
      resumeTargetSession: (input) =>
        adapter.resumeSession({
          agentId: 'agent-1',
          projectPath,
          nativeSessionId: input.nativeSessionId,
          prompt: input.prompt,
          model: input.model ?? null,
        }),
    });

    expect(result.ok).toBe(true);
    expect(result.session?.nativeSessionId).toBe(
      (result.metadata.materializedSession as { nativeSessionId: string }).nativeSessionId,
    );

    const materializedSession = result.metadata.materializedSession as { nativeSessionId: string };

    const claudeArgs = await waitForFile(claudeArgsLog, (content) =>
      content.includes(materializedSession.nativeSessionId),
    );
    expect(claudeArgs).toContain('--resume');
    expect(claudeArgs).toContain(materializedSession.nativeSessionId);
  });
});

async function createTempEnv(): Promise<TempEnv> {
  const root = await mkdtemp(join(tmpdir(), 'agentctl-native-import-it-'));
  tempDirs.push(root);
  const binDir = join(root, 'bin');
  const homeDir = join(root, 'home');
  const codexHome = join(root, 'codex-home');
  const logsDir = join(root, 'logs');
  await Promise.all([
    mkdir(binDir, { recursive: true }),
    mkdir(homeDir, { recursive: true }),
    mkdir(codexHome, { recursive: true }),
    mkdir(logsDir, { recursive: true }),
  ]);

  process.env.PATH = `${binDir}${originalPath ? `:${originalPath}` : ''}`;
  process.env.HOME = homeDir;
  process.env.CODEX_HOME = codexHome;

  return { root, binDir, homeDir, codexHome, logsDir };
}

async function installFakeCodex(binDir: string, argsLog: string): Promise<void> {
  const scriptPath = join(binDir, 'codex');
  await writeFile(
    scriptPath,
    [
      '#!/bin/sh',
      'set -eu',
      `LOG_FILE="${argsLog}"`,
      `if [ "\${1:-}" = "--version" ]; then`,
      "  echo 'codex-cli fake'",
      '  exit 0',
      'fi',
      ': > "$LOG_FILE"',
      'for arg in "$@"; do',
      '  printf "%s\\n" "$arg" >> "$LOG_FILE"',
      'done',
      'session_id="fake-codex-start"',
      `if [ "\${1:-}" = "exec" ] && [ "\${2:-}" = "resume" ]; then`,
      `  session_id="\${3:-fake-codex-resume}"`,
      'fi',
      'printf \'{"type":"session.started","session_id":"%s"}\\n\' "$session_id"',
    ].join('\n'),
    'utf8',
  );
  await chmod(scriptPath, 0o755);
}

async function installFakeClaude(binDir: string, argsLog: string): Promise<void> {
  const scriptPath = join(binDir, 'claude');
  await writeFile(
    scriptPath,
    [
      '#!/bin/sh',
      'set -eu',
      `LOG_FILE="${argsLog}"`,
      `if [ "\${1:-}" = "--version" ]; then`,
      "  echo '2.1.71 (Claude Code)'",
      '  exit 0',
      'fi',
      ': > "$LOG_FILE"',
      'resume_id="fake-claude-start"',
      'while [ "$#" -gt 0 ]; do',
      '  printf "%s\\n" "$1" >> "$LOG_FILE"',
      '  if [ "$1" = "--resume" ] && [ "$#" -ge 2 ]; then',
      '    shift',
      '    printf "%s\\n" "$1" >> "$LOG_FILE"',
      '    resume_id="$1"',
      '  fi',
      '  shift',
      'done',
      'printf \'{"type":"system","session_id":"%s"}\\n\' "$resume_id"',
    ].join('\n'),
    'utf8',
  );
  await chmod(scriptPath, 0o755);
}

async function seedClaudeSourceSession(
  homeDir: string,
  projectPath: string,
  sourceNativeSessionId: string,
): Promise<void> {
  const projectDir = join(homeDir, '.claude', 'projects', projectPath.replace(/[\\/]/g, '-'));
  await mkdir(projectDir, { recursive: true });
  await writeFile(
    join(projectDir, `${sourceNativeSessionId}.jsonl`),
    `${[
      JSON.stringify({
        type: 'user',
        timestamp: '2026-03-10T00:00:00.000Z',
        cwd: projectPath,
        gitBranch: 'main',
        message: {
          content: [{ type: 'text', text: 'Please continue this imported task.' }],
        },
      }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-03-10T00:00:05.000Z',
        cwd: projectPath,
        gitBranch: 'main',
        message: {
          content: [{ type: 'text', text: 'I am ready to continue in Codex.' }],
        },
      }),
    ].join('\n')}\n`,
    'utf8',
  );
}

async function createProjectPath(root: string): Promise<string> {
  const projectPath = join(root, 'workspace', 'app');
  await mkdir(projectPath, { recursive: true });
  return projectPath;
}

async function seedCodexSourceSession(
  codexHome: string,
  projectPath: string,
  sourceNativeSessionId: string,
): Promise<void> {
  const sessionDir = join(codexHome, 'sessions', '2026', '03', '10');
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    join(sessionDir, `rollout-2026-03-10T00-00-00-${sourceNativeSessionId}.jsonl`),
    `${[
      JSON.stringify({
        timestamp: '2026-03-10T00:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: sourceNativeSessionId,
          cwd: projectPath,
        },
      }),
      JSON.stringify({
        timestamp: '2026-03-10T00:00:03.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Switch this imported task to Claude.' }],
        },
      }),
      JSON.stringify({
        timestamp: '2026-03-10T00:00:06.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'I will continue in Claude.' }],
        },
      }),
    ].join('\n')}\n`,
    'utf8',
  );
}

async function waitForFile(
  path: string,
  predicate?: (content: string) => boolean,
): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const content = await readFile(path, 'utf8');
      if (!predicate || predicate(content)) {
        return content;
      }
    } catch {
      // Ignore read races while the fake CLI process is still writing the log.
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for file: ${path}`);
}

function makeSnapshot(overrides: {
  sourceRuntime: 'claude-code' | 'codex';
  sourceSessionId: string;
  sourceNativeSessionId: string;
  projectPath: string;
}) {
  return {
    sourceRuntime: overrides.sourceRuntime,
    sourceSessionId: overrides.sourceSessionId,
    sourceNativeSessionId: overrides.sourceNativeSessionId,
    projectPath: overrides.projectPath,
    worktreePath: join(overrides.projectPath, '.trees', 'agent-1'),
    branch: 'main',
    headSha: 'abc123',
    dirtyFiles: [],
    diffSummary: 'No diff.',
    conversationSummary: 'Continue from imported context.',
    openTodos: [],
    nextSuggestedPrompt: 'Continue from the handoff snapshot.',
    activeConfigRevision: 9,
    activeMcpServers: [],
    activeSkills: [],
    reason: 'manual' as const,
  };
}
