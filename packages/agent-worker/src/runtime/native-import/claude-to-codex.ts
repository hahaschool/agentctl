import { materializeCodexImportedSession } from './codex-materializer.js';
import { probeNativeImportPrerequisites } from './probe.js';
import {
  failedNativeImportAttempt,
  type NativeImportAttemptResult,
  type NativeImportProbeInput,
} from './types.js';

export async function tryClaudeToCodexImport(
  input: NativeImportProbeInput,
): Promise<NativeImportAttemptResult> {
  const sourceImportId = input.snapshot.sourceNativeSessionId ?? input.snapshot.sourceSessionId;
  const prerequisiteResult = await probeNativeImportPrerequisites({
    sourceRuntime: 'claude-code',
    targetRuntime: 'codex',
    projectPath: input.projectPath,
    snapshot: input.snapshot,
  });

  if (prerequisiteResult.reason !== 'not_implemented') {
    return failedNativeImportAttempt({
      sourceRuntime: 'claude-code',
      targetRuntime: 'codex',
      reason: prerequisiteResult.reason,
      metadata: {
        probe: 'claude-to-codex',
        sourceSessionId: input.snapshot.sourceSessionId,
        sourceNativeSessionId: input.snapshot.sourceNativeSessionId,
        projectPath: input.projectPath,
        ...prerequisiteResult.metadata,
      },
    });
  }

  if (!input.resumeTargetSession) {
    return failedNativeImportAttempt({
      sourceRuntime: 'claude-code',
      targetRuntime: 'codex',
      reason: 'not_supported',
      metadata: {
        probe: 'claude-to-codex',
        sourceSessionId: input.snapshot.sourceSessionId,
        sourceNativeSessionId: input.snapshot.sourceNativeSessionId,
        projectPath: input.projectPath,
        error: 'Target runtime resume callback is unavailable',
        ...prerequisiteResult.metadata,
      },
    });
  }

  let materializedSession: {
    nativeSessionId: string;
    sessionPath: string;
    indexPath: string;
  };

  try {
    materializedSession = await materializeCodexImportedSession({
      projectPath: input.projectPath,
      sourceRuntime: 'claude-code',
      sourceSessionId: sourceImportId,
      snapshotSummary: input.snapshot.conversationSummary,
      sourceSessionSummary: extractSourceSessionSummary(prerequisiteResult.metadata),
      targetCliVersion: extractCliVersion(prerequisiteResult.metadata),
    });
  } catch (error) {
    return failedNativeImportAttempt({
      sourceRuntime: 'claude-code',
      targetRuntime: 'codex',
      reason: 'session_materialization_failed',
      metadata: {
        probe: 'claude-to-codex',
        sourceSessionId: input.snapshot.sourceSessionId,
        sourceNativeSessionId: input.snapshot.sourceNativeSessionId,
        projectPath: input.projectPath,
        error: error instanceof Error ? error.message : String(error),
        ...prerequisiteResult.metadata,
      },
    });
  }

  try {
    const session = await input.resumeTargetSession({
      nativeSessionId: materializedSession.nativeSessionId,
      prompt: input.prompt?.trim() || input.snapshot.nextSuggestedPrompt,
      model: input.model ?? null,
    });

    return {
      ok: true,
      sourceRuntime: 'claude-code',
      targetRuntime: 'codex',
      reason: 'succeeded',
      metadata: {
        probe: 'claude-to-codex',
        sourceSessionId: input.snapshot.sourceSessionId,
        sourceNativeSessionId: input.snapshot.sourceNativeSessionId,
        projectPath: input.projectPath,
        materializedSession,
        ...prerequisiteResult.metadata,
      },
      session,
    };
  } catch (error) {
    return failedNativeImportAttempt({
      sourceRuntime: 'claude-code',
      targetRuntime: 'codex',
      reason: 'resume_failed',
      metadata: {
        probe: 'claude-to-codex',
        sourceSessionId: input.snapshot.sourceSessionId,
        sourceNativeSessionId: input.snapshot.sourceNativeSessionId,
        projectPath: input.projectPath,
        materializedSession,
        error: error instanceof Error ? error.message : String(error),
        ...prerequisiteResult.metadata,
      },
    });
  }
}

function extractSourceSessionSummary(metadata: Record<string, unknown>): {
  recentMessages?: Array<{ role?: string; text?: string }>;
} | null {
  const value = metadata.sourceSessionSummary;
  return typeof value === 'object' && value !== null
    ? (value as {
        recentMessages?: Array<{ role?: string; text?: string }>;
      })
    : null;
}

function extractCliVersion(metadata: Record<string, unknown>): string | null {
  const targetCli =
    typeof metadata.targetCli === 'object' && metadata.targetCli !== null
      ? (metadata.targetCli as Record<string, unknown>)
      : null;
  return typeof targetCli?.version === 'string' ? targetCli.version : null;
}
