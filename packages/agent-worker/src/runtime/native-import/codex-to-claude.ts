import type { NativeImportAttemptResult, NativeImportProbeInput } from './types.js';

export async function tryCodexToClaudeImport(
  input: NativeImportProbeInput,
): Promise<NativeImportAttemptResult> {
  return {
    ok: false,
    sourceRuntime: 'codex',
    targetRuntime: 'claude-code',
    reason: 'not_implemented',
    metadata: {
      probe: 'codex-to-claude',
      sourceSessionId: input.snapshot.sourceSessionId,
      projectPath: input.projectPath,
    },
  };
}
