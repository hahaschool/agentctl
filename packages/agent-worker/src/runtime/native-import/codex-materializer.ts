import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

type SourceSessionSummary = {
  recentMessages?: Array<{
    role?: string;
    text?: string;
  }>;
};

export async function materializeCodexImportedSession(input: {
  projectPath: string;
  sourceRuntime: string;
  sourceSessionId: string;
  snapshotSummary: string;
  sourceSessionSummary?: SourceSessionSummary | null;
  targetCliVersion?: string | null;
}): Promise<{
  nativeSessionId: string;
  sessionPath: string;
  indexPath: string;
}> {
  const nativeSessionId = randomUUID();
  const now = new Date();
  const codexHome = process.env.CODEX_HOME ?? join(homedir(), '.codex');
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const sessionDir = join(codexHome, 'sessions', year, month, day);
  const sessionPath = join(
    sessionDir,
    `rollout-${formatRolloutTimestamp(now)}-${nativeSessionId}.jsonl`,
  );
  const indexPath = join(codexHome, 'session_index.jsonl');

  await mkdir(sessionDir, { recursive: true });

  const lines = buildImportedSessionLines({
    nativeSessionId,
    timestamp: now.toISOString(),
    projectPath: input.projectPath,
    sourceRuntime: input.sourceRuntime,
    sourceSessionId: input.sourceSessionId,
    snapshotSummary: input.snapshotSummary,
    sourceSessionSummary: input.sourceSessionSummary ?? null,
    targetCliVersion: input.targetCliVersion ?? null,
  });

  await writeFile(sessionPath, `${lines.join('\n')}\n`, 'utf8');
  await appendFile(
    indexPath,
    `${JSON.stringify({
      id: nativeSessionId,
      thread_name: `Imported ${input.sourceRuntime} session`,
      updated_at: now.toISOString(),
    })}\n`,
    'utf8',
  );

  return {
    nativeSessionId,
    sessionPath,
    indexPath,
  };
}

function buildImportedSessionLines(input: {
  nativeSessionId: string;
  timestamp: string;
  projectPath: string;
  sourceRuntime: string;
  sourceSessionId: string;
  snapshotSummary: string;
  sourceSessionSummary: SourceSessionSummary | null;
  targetCliVersion: string | null;
}): string[] {
  const lines = [
    JSON.stringify({
      timestamp: input.timestamp,
      type: 'session_meta',
      payload: {
        id: input.nativeSessionId,
        timestamp: input.timestamp,
        cwd: input.projectPath,
        originator: 'AgentCTL native import',
        cli_version: input.targetCliVersion ?? 'unknown',
        source: 'agentctl-native-import',
        model_provider: 'openai',
      },
    }),
    JSON.stringify({
      timestamp: input.timestamp,
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'developer',
        content: [
          {
            type: 'input_text',
            text: [
              `Imported from ${input.sourceRuntime} session ${input.sourceSessionId}.`,
              'Treat the following imported messages as prior conversation context.',
              `Snapshot summary: ${input.snapshotSummary}`,
            ].join('\n'),
          },
        ],
      },
    }),
  ];

  const recentMessages =
    input.sourceSessionSummary?.recentMessages
      ?.filter(
        (
          message,
        ): message is {
          role: string;
          text: string;
        } => typeof message?.role === 'string' && typeof message?.text === 'string',
      )
      .slice(-6) ?? [];

  for (const message of recentMessages) {
    const role = message.role === 'assistant' ? 'assistant' : 'user';
    lines.push(
      JSON.stringify({
        timestamp: input.timestamp,
        type: 'response_item',
        payload: {
          type: 'message',
          role,
          content: [
            {
              type: role === 'assistant' ? 'output_text' : 'input_text',
              text: message.text,
            },
          ],
        },
      }),
    );
  }

  return lines;
}

function formatRolloutTimestamp(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-') +
    `T${String(date.getUTCHours()).padStart(2, '0')}-${String(date.getUTCMinutes()).padStart(
      2,
      '0',
    )}-${String(date.getUTCSeconds()).padStart(2, '0')}`;
}
