import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type {
  ExportHandoffSnapshotRequest,
  HandoffSnapshot,
  HandoffStrategy,
  ManagedRuntime,
  StartHandoffRequest,
} from '@agentctl/shared';
import { WorkerError } from '@agentctl/shared';
import type { Logger } from 'pino';

import type { ManagedSessionHandle, RuntimeAdapter } from './runtime-adapter.js';
import { RuntimeRegistry } from './runtime-registry.js';

const execFileAsync = promisify(execFile);

type ExportSnapshotInput = ExportHandoffSnapshotRequest & {
  nativeSessionId: string;
};

type WorkspaceInspection = {
  worktreePath: string | null;
  branch: string | null;
  headSha: string | null;
  dirtyFiles: string[];
  diffSummary: string;
};

type HandoffControllerOptions = {
  machineId: string;
  logger: Logger;
  runtimeRegistry: RuntimeRegistry;
  inspectWorkspace?: (projectPath: string) => Promise<WorkspaceInspection>;
  allowExperimentalNativeImport?: boolean;
};

export type HandoffExecutionResult = {
  ok: true;
  strategy: HandoffStrategy;
  attemptedStrategies: HandoffStrategy[];
  snapshot: HandoffSnapshot;
  session: ManagedSessionHandle;
};

export class HandoffController {
  private readonly inspectWorkspace: (projectPath: string) => Promise<WorkspaceInspection>;

  constructor(private readonly options: HandoffControllerOptions) {
    this.inspectWorkspace = options.inspectWorkspace ?? inspectGitWorkspace;
  }

  pickStrategies(input: {
    sourceRuntime: ManagedRuntime;
    targetRuntime: ManagedRuntime;
  }): HandoffStrategy[] {
    if (this.options.allowExperimentalNativeImport && input.sourceRuntime !== input.targetRuntime) {
      return ['native-import', 'snapshot-handoff'];
    }

    return ['snapshot-handoff'];
  }

  async exportSnapshot(input: ExportSnapshotInput): Promise<HandoffSnapshot> {
    const inspected = await this.inspectWorkspace(input.projectPath);

    return {
      sourceRuntime: input.sourceRuntime,
      sourceSessionId: input.sourceSessionId,
      projectPath: input.projectPath,
      worktreePath: input.worktreePath ?? inspected.worktreePath,
      branch: inspected.branch,
      headSha: inspected.headSha,
      dirtyFiles: inspected.dirtyFiles,
      diffSummary: inspected.diffSummary,
      conversationSummary: buildConversationSummary(input),
      openTodos: [],
      nextSuggestedPrompt: input.prompt?.trim() || 'Continue from the handoff snapshot.',
      activeConfigRevision: input.activeConfigRevision,
      activeMcpServers: input.activeMcpServers ?? [],
      activeSkills: input.activeSkills ?? [],
      reason: input.reason,
    };
  }

  async handoff(input: StartHandoffRequest): Promise<HandoffExecutionResult> {
    const adapter = requireAdapter(this.options.runtimeRegistry, input.targetRuntime);
    const attemptedStrategies = this.pickStrategies({
      sourceRuntime: input.snapshot.sourceRuntime,
      targetRuntime: input.targetRuntime,
    });

    const session = await adapter.startSession({
      agentId: input.agentId,
      projectPath: input.projectPath,
      prompt: composeHandoffPrompt(input.snapshot, input.prompt),
      model: input.model ?? null,
    });

    this.options.logger.info(
      {
        machineId: this.options.machineId,
        targetRuntime: input.targetRuntime,
        sourceRuntime: input.snapshot.sourceRuntime,
        nativeSessionId: session.nativeSessionId,
      },
      'Started snapshot handoff session',
    );

    return {
      ok: true,
      strategy: 'snapshot-handoff',
      attemptedStrategies,
      snapshot: input.snapshot,
      session,
    };
  }
}

function requireAdapter(registry: RuntimeRegistry, runtime: ManagedRuntime): RuntimeAdapter {
  const adapter = registry.get(runtime);
  if (!adapter) {
    throw new WorkerError('RUNTIME_NOT_FOUND', `Runtime '${runtime}' is not registered`, { runtime });
  }
  return adapter;
}

async function inspectGitWorkspace(projectPath: string): Promise<WorkspaceInspection> {
  const [worktreePath, branch, headSha, dirtyOutput, diffOutput] = await Promise.all([
    runGit(['rev-parse', '--show-toplevel'], projectPath),
    runGit(['rev-parse', '--abbrev-ref', 'HEAD'], projectPath),
    runGit(['rev-parse', 'HEAD'], projectPath),
    runGit(['status', '--short'], projectPath),
    runGit(['diff', '--stat'], projectPath),
  ]);

  return {
    worktreePath,
    branch,
    headSha,
    dirtyFiles: parseDirtyFiles(dirtyOutput),
    diffSummary: diffOutput || 'No local diff summary available.',
  };
}

async function runGit(args: string[], cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function parseDirtyFiles(output: string | null): string[] {
  if (!output) {
    return [];
  }

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const trimmed = line.slice(2).trim();
      const renameIndex = trimmed.lastIndexOf(' -> ');
      return renameIndex === -1 ? trimmed : trimmed.slice(renameIndex + 4);
    })
    .filter(Boolean);
}

function buildConversationSummary(input: ExportSnapshotInput): string {
  const base = `Resume work from ${input.sourceRuntime} session ${input.nativeSessionId}.`;
  if (!input.prompt?.trim()) {
    return base;
  }
  return `${base} Requester note: ${input.prompt.trim()}`;
}

function composeHandoffPrompt(snapshot: HandoffSnapshot, prompt?: string | null): string {
  const lines = [
    prompt?.trim() || snapshot.nextSuggestedPrompt,
    '',
    `Source runtime: ${snapshot.sourceRuntime}`,
    `Conversation summary: ${snapshot.conversationSummary}`,
    `Diff summary: ${snapshot.diffSummary}`,
  ];

  if (snapshot.openTodos.length > 0) {
    lines.push(`Open todos: ${snapshot.openTodos.join('; ')}`);
  }

  return lines.join('\n').trim();
}
