import { probeNativeImportPrerequisites } from './probe.js';
import { failedNativeImportAttempt, type NativeImportAttemptResult, type NativeImportProbeInput } from './types.js';

export async function tryClaudeToCodexImport(
  input: NativeImportProbeInput,
): Promise<NativeImportAttemptResult> {
  const prerequisiteResult = await probeNativeImportPrerequisites({
    sourceRuntime: 'claude-code',
    targetRuntime: 'codex',
    projectPath: input.projectPath,
    snapshot: input.snapshot,
  });

  return failedNativeImportAttempt({
    sourceRuntime: 'claude-code',
    targetRuntime: 'codex',
    reason: prerequisiteResult.reason,
    metadata: {
      probe: 'claude-to-codex',
      sourceSessionId: input.snapshot.sourceSessionId,
      projectPath: input.projectPath,
      ...prerequisiteResult.metadata,
    },
  });
}
