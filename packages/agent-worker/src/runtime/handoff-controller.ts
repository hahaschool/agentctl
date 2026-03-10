import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type {
  ExportHandoffSnapshotRequest,
  HandoffSnapshot,
  HandoffStrategy,
  ManagedRuntime,
  NativeImportPreflightResponse,
  StartHandoffRequest,
} from '@agentctl/shared';
import { WorkerError } from '@agentctl/shared';
import type { Logger } from 'pino';

import { tryClaudeToCodexImport } from './native-import/claude-to-codex.js';
import { tryCodexToClaudeImport } from './native-import/codex-to-claude.js';
import { probeNativeImportPrerequisites } from './native-import/probe.js';
import {
  failedNativeImportAttempt,
  type NativeImportAttemptResult,
  type NativeImportProbeInput,
} from './native-import/types.js';
import type { ManagedSessionHandle, RuntimeAdapter } from './runtime-adapter.js';
import type { RuntimeRegistry } from './runtime-registry.js';

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
  nativeImporters?: Partial<Record<string, NativeImportProbe>>;
};

export type HandoffExecutionResult = {
  ok: true;
  strategy: HandoffStrategy;
  attemptedStrategies: HandoffStrategy[];
  snapshot: HandoffSnapshot;
  session: ManagedSessionHandle;
  nativeImportAttempt?: NativeImportAttemptResult;
};

type NativeImportProbe = (input: NativeImportProbeInput) => Promise<NativeImportAttemptResult>;

export class HandoffController {
  private readonly inspectWorkspace: (projectPath: string) => Promise<WorkspaceInspection>;
  private readonly nativeImporters: Record<string, NativeImportProbe>;

  constructor(private readonly options: HandoffControllerOptions) {
    this.inspectWorkspace = options.inspectWorkspace ?? inspectGitWorkspace;
    this.nativeImporters = {
      'claude-code:codex': tryClaudeToCodexImport,
      'codex:claude-code': tryCodexToClaudeImport,
      ...options.nativeImporters,
    };
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
      sourceNativeSessionId: input.nativeSessionId,
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

  async preflightNativeImport(input: {
    sourceRuntime: ManagedRuntime;
    targetRuntime: ManagedRuntime;
    projectPath: string;
    snapshot: HandoffSnapshot;
  }): Promise<NativeImportPreflightResponse> {
    const key = `${input.sourceRuntime}:${input.targetRuntime}`;
    if (
      !this.options.allowExperimentalNativeImport ||
      input.sourceRuntime === input.targetRuntime
    ) {
      return {
        ok: true,
        nativeImportCapable: false,
        attempt: failedNativeImportAttempt({
          sourceRuntime: input.sourceRuntime,
          targetRuntime: input.targetRuntime,
          reason: 'not_supported',
          metadata: {
            key,
            experimentalNativeImport: this.options.allowExperimentalNativeImport ?? false,
          },
        }),
      };
    }

    if (!this.nativeImporters[key]) {
      return {
        ok: true,
        nativeImportCapable: false,
        attempt: failedNativeImportAttempt({
          sourceRuntime: input.sourceRuntime,
          targetRuntime: input.targetRuntime,
          reason: 'not_supported',
          metadata: { key },
        }),
      };
    }

    const prerequisiteResult = await probeNativeImportPrerequisites(input);
    const attempt =
      prerequisiteResult.reason === 'not_implemented'
        ? failedNativeImportAttempt({
            sourceRuntime: input.sourceRuntime,
            targetRuntime: input.targetRuntime,
            reason: 'not_implemented',
            metadata: {
              key,
              ...prerequisiteResult.metadata,
            },
          })
        : failedNativeImportAttempt({
            sourceRuntime: input.sourceRuntime,
            targetRuntime: input.targetRuntime,
            reason: prerequisiteResult.reason,
            metadata: {
              key,
              ...prerequisiteResult.metadata,
            },
          });

    return {
      ok: true,
      nativeImportCapable: prerequisiteResult.reason === 'not_implemented',
      attempt,
    };
  }

  async handoff(input: StartHandoffRequest): Promise<HandoffExecutionResult> {
    const adapter = requireAdapter(this.options.runtimeRegistry, input.targetRuntime);
    const attemptedStrategies = this.pickStrategies({
      sourceRuntime: input.snapshot.sourceRuntime,
      targetRuntime: input.targetRuntime,
    });
    let nativeImportAttempt: NativeImportAttemptResult | undefined;

    for (const strategy of attemptedStrategies) {
      if (strategy === 'native-import') {
        nativeImportAttempt = await this.tryNativeImport(input, adapter);
        if (nativeImportAttempt.ok && nativeImportAttempt.session) {
          return {
            ok: true,
            strategy: 'native-import',
            attemptedStrategies,
            snapshot: input.snapshot,
            session: nativeImportAttempt.session,
            nativeImportAttempt,
          };
        }
        continue;
      }

      const session = await adapter.startSession({
        agentId: input.agentId,
        projectPath: input.projectPath,
        prompt: composeHandoffPrompt(
          input.snapshot,
          input.prompt,
          extractSourceSessionSummary(nativeImportAttempt?.metadata),
        ),
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
        nativeImportAttempt,
      };
    }

    throw new WorkerError(
      'HANDOFF_STRATEGY_FAILED',
      `No usable handoff strategy succeeded for '${input.snapshot.sourceRuntime}' -> '${input.targetRuntime}'`,
      {
        sourceRuntime: input.snapshot.sourceRuntime,
        targetRuntime: input.targetRuntime,
      },
    );
  }

  private async tryNativeImport(
    input: StartHandoffRequest,
    targetAdapter: RuntimeAdapter,
  ): Promise<NativeImportAttemptResult> {
    const key = `${input.snapshot.sourceRuntime}:${input.targetRuntime}`;
    const importer = this.nativeImporters[key];
    if (!importer) {
      return {
        ok: false,
        sourceRuntime: input.snapshot.sourceRuntime,
        targetRuntime: input.targetRuntime,
        reason: 'not_supported',
        metadata: { key },
      };
    }

    return importer({
      agentId: input.agentId,
      projectPath: input.projectPath,
      prompt: input.prompt ?? null,
      model: input.model ?? null,
      snapshot: input.snapshot,
      resumeTargetSession: ({ nativeSessionId, prompt, model }) =>
        targetAdapter.resumeSession({
          agentId: input.agentId,
          projectPath: input.projectPath,
          nativeSessionId,
          prompt,
          model: model ?? null,
        }),
    });
  }
}

function requireAdapter(registry: RuntimeRegistry, runtime: ManagedRuntime): RuntimeAdapter {
  const adapter = registry.get(runtime);
  if (!adapter) {
    throw new WorkerError('RUNTIME_NOT_FOUND', `Runtime '${runtime}' is not registered`, {
      runtime,
    });
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

function composeHandoffPrompt(
  snapshot: HandoffSnapshot,
  prompt?: string | null,
  sourceSessionSummary?: {
    recentMessages?: Array<{ role?: string; text?: string }>;
  } | null,
): string {
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

  const recentMessages = sourceSessionSummary?.recentMessages
    ?.filter(
      (
        message,
      ): message is {
        role: string;
        text: string;
      } => typeof message?.role === 'string' && typeof message?.text === 'string',
    )
    .slice(-3);

  if (recentMessages && recentMessages.length > 0) {
    lines.push(
      'Recent native messages:',
      ...recentMessages.map((message) => `- ${message.role}: ${message.text}`),
    );
  }

  return lines.join('\n').trim();
}

function extractSourceSessionSummary(metadata: Record<string, unknown> | undefined): {
  recentMessages?: Array<{ role?: string; text?: string }>;
} | null {
  if (!metadata) return null;

  const value = metadata.sourceSessionSummary;
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  return value as {
    recentMessages?: Array<{ role?: string; text?: string }>;
  };
}
