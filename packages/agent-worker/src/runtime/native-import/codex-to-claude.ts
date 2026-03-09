import { materializeClaudeImportedSession } from './claude-materializer.js';
import { probeNativeImportPrerequisites } from './probe.js';
import {
  failedNativeImportAttempt,
  type NativeImportAttemptResult,
  type NativeImportProbeInput,
} from './types.js';

export async function tryCodexToClaudeImport(
  input: NativeImportProbeInput,
): Promise<NativeImportAttemptResult> {
  const sourceImportId = input.snapshot.sourceNativeSessionId ?? input.snapshot.sourceSessionId;
  const prerequisiteResult = await probeNativeImportPrerequisites({
    sourceRuntime: 'codex',
    targetRuntime: 'claude-code',
    projectPath: input.projectPath,
    snapshot: input.snapshot,
  });

  if (prerequisiteResult.reason !== 'not_implemented') {
    return failedNativeImportAttempt({
      sourceRuntime: 'codex',
      targetRuntime: 'claude-code',
      reason: prerequisiteResult.reason,
      metadata: {
        probe: 'codex-to-claude',
        sourceSessionId: input.snapshot.sourceSessionId,
        sourceNativeSessionId: input.snapshot.sourceNativeSessionId,
        projectPath: input.projectPath,
        ...prerequisiteResult.metadata,
      },
    });
  }

  if (!input.resumeTargetSession) {
    return failedNativeImportAttempt({
      sourceRuntime: 'codex',
      targetRuntime: 'claude-code',
      reason: 'not_supported',
      metadata: {
        probe: 'codex-to-claude',
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
  };

  try {
    materializedSession = await materializeClaudeImportedSession({
      projectPath: input.projectPath,
      sourceRuntime: 'codex',
      sourceSessionId: sourceImportId,
      gitBranch: input.snapshot.branch,
      sourceSessionSummary: extractSourceSessionSummary(prerequisiteResult.metadata),
      claudeVersion: extractCliVersion(prerequisiteResult.metadata),
    });
  } catch (error) {
    return failedNativeImportAttempt({
      sourceRuntime: 'codex',
      targetRuntime: 'claude-code',
      reason: 'session_materialization_failed',
      metadata: {
        probe: 'codex-to-claude',
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
      sourceRuntime: 'codex',
      targetRuntime: 'claude-code',
      reason: 'succeeded',
      metadata: {
        probe: 'codex-to-claude',
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
      sourceRuntime: 'codex',
      targetRuntime: 'claude-code',
      reason: 'resume_failed',
      metadata: {
        probe: 'codex-to-claude',
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
