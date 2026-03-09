import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

type SourceSessionSummary = {
  recentMessages?: Array<{
    role?: string;
    text?: string;
  }>;
};

export async function materializeClaudeImportedSession(input: {
  projectPath: string;
  sourceRuntime: string;
  sourceSessionId: string;
  gitBranch?: string | null;
  sourceSessionSummary?: SourceSessionSummary | null;
  claudeVersion?: string | null;
}): Promise<{
  nativeSessionId: string;
  sessionPath: string;
}> {
  const nativeSessionId = randomUUID();
  const encodedProjectPath = input.projectPath.replace(/[\\/]/g, '-');
  const sessionDir = join(homedir(), '.claude', 'projects', encodedProjectPath);
  const sessionPath = join(sessionDir, `${nativeSessionId}.jsonl`);

  await mkdir(sessionDir, { recursive: true });

  const lines = buildImportedSessionLines({
    nativeSessionId,
    projectPath: input.projectPath,
    sourceRuntime: input.sourceRuntime,
    sourceSessionId: input.sourceSessionId,
    gitBranch: input.gitBranch ?? 'main',
    sourceSessionSummary: input.sourceSessionSummary ?? null,
    claudeVersion: input.claudeVersion ?? '2.1.71',
  });

  await writeFile(sessionPath, `${lines.join('\n')}\n`, 'utf8');

  return {
    nativeSessionId,
    sessionPath,
  };
}

function buildImportedSessionLines(input: {
  nativeSessionId: string;
  projectPath: string;
  sourceRuntime: string;
  sourceSessionId: string;
  gitBranch: string;
  sourceSessionSummary: SourceSessionSummary | null;
  claudeVersion: string;
}): string[] {
  const lines: string[] = [];
  let parentUuid: string | null = null;

  for (const message of buildImportedMessages(input)) {
    const uuid = randomUUID();
    lines.push(
      JSON.stringify({
        parentUuid,
        isSidechain: false,
        userType: 'external',
        cwd: input.projectPath,
        sessionId: input.nativeSessionId,
        version: input.claudeVersion,
        gitBranch: input.gitBranch,
        type: message.role,
        timestamp: new Date().toISOString(),
        uuid,
        ...(message.role === 'user'
          ? {
              message: {
                content: [
                  {
                    type: 'text',
                    text: message.text,
                  },
                ],
              },
            }
          : {
              message: {
                id: randomUUID(),
                container: null,
                model: '<synthetic>',
                role: 'assistant',
                stop_reason: 'stop_sequence',
                stop_sequence: '',
                type: 'message',
                usage: {
                  input_tokens: 0,
                  output_tokens: 0,
                  cache_creation_input_tokens: 0,
                  cache_read_input_tokens: 0,
                  server_tool_use: {
                    web_search_requests: 0,
                    web_fetch_requests: 0,
                  },
                  service_tier: null,
                  cache_creation: {
                    ephemeral_1h_input_tokens: 0,
                    ephemeral_5m_input_tokens: 0,
                  },
                  inference_geo: null,
                  iterations: null,
                  speed: null,
                },
                content: [
                  {
                    type: 'text',
                    text: message.text,
                  },
                ],
                context_management: null,
              },
              isApiErrorMessage: false,
            }),
      }),
    );
    parentUuid = uuid;
  }

  return lines;
}

function buildImportedMessages(input: {
  sourceRuntime: string;
  sourceSessionId: string;
  sourceSessionSummary: SourceSessionSummary | null;
}): Array<{ role: 'user' | 'assistant'; text: string }> {
  const messages: Array<{ role: 'user' | 'assistant'; text: string }> = [
    {
      role: 'assistant',
      text: [
        `Imported from ${input.sourceRuntime} session ${input.sourceSessionId}.`,
        'Treat the following imported messages as prior conversation context.',
      ].join('\n'),
    },
  ];

  for (const message of input.sourceSessionSummary?.recentMessages ?? []) {
    if (typeof message?.text !== 'string') {
      continue;
    }

    const role = message.role === 'assistant' ? 'assistant' : 'user';
    messages.push({
      role,
      text: message.text,
    });
  }

  return messages;
}
