import { probeNativeImportPrerequisites } from './probe.js';
import { failedNativeImportAttempt, type NativeImportAttemptResult, type NativeImportProbeInput } from './types.js';

export async function tryCodexToClaudeImport(
  input: NativeImportProbeInput,
): Promise<NativeImportAttemptResult> {
  const prerequisiteResult = await probeNativeImportPrerequisites({
    sourceRuntime: 'codex',
    targetRuntime: 'claude-code',
    projectPath: input.projectPath,
    snapshot: input.snapshot,
  });

  return failedNativeImportAttempt({
    sourceRuntime: 'codex',
    targetRuntime: 'claude-code',
    reason: prerequisiteResult.reason,
    metadata: {
      probe: 'codex-to-claude',
      sourceSessionId: input.snapshot.sourceSessionId,
      projectPath: input.projectPath,
      ...prerequisiteResult.metadata,
    },
  });
}
