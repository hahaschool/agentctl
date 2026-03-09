import type { NativeImportAttemptResult, NativeImportProbeInput } from './types.js';

export async function tryClaudeToCodexImport(
  input: NativeImportProbeInput,
): Promise<NativeImportAttemptResult> {
  return {
    ok: false,
    sourceRuntime: 'claude-code',
    targetRuntime: 'codex',
    reason: 'not_implemented',
    metadata: {
      probe: 'claude-to-codex',
      sourceSessionId: input.snapshot.sourceSessionId,
      projectPath: input.projectPath,
    },
  };
}
