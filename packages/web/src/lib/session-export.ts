import type { Session, SessionContentMessage } from './api';

function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function formatMessageLabel(type: string): string {
  switch (type) {
    case 'human':
      return 'Human';
    case 'assistant':
      return 'Assistant';
    case 'tool_use':
      return 'Tool Call';
    case 'tool_result':
      return 'Tool Result';
    case 'thinking':
      return 'Thinking';
    case 'progress':
      return 'Progress';
    case 'subagent':
      return 'Subagent';
    case 'todo':
      return 'Tasks';
    default:
      return type;
  }
}

export function exportSessionAsJson(session: Session, messages: SessionContentMessage[]): void {
  const data = {
    session: {
      id: session.id,
      agentId: session.agentId,
      machineId: session.machineId,
      claudeSessionId: session.claudeSessionId,
      status: session.status,
      projectPath: session.projectPath,
      model: session.model,
      accountId: session.accountId,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      metadata: session.metadata,
    },
    messages: messages.map((m) => ({
      type: m.type,
      content: m.content,
      timestamp: m.timestamp ?? null,
      toolName: m.toolName ?? null,
    })),
    exportedAt: new Date().toISOString(),
  };
  const json = JSON.stringify(data, null, 2);
  const filename = `session-${session.id.slice(0, 12)}-${Date.now()}.json`;
  downloadFile(json, filename, 'application/json');
}

export function exportSessionAsMarkdown(
  session: Session,
  messages: SessionContentMessage[],
): void {
  const lines: string[] = [];

  lines.push(`# Session ${session.id}`);
  lines.push('');

  const metaParts: string[] = [];
  metaParts.push(`**Status:** ${session.status}`);
  metaParts.push(`**Model:** ${session.model ?? '(default)'}`);
  metaParts.push(`**Started:** ${session.startedAt}`);
  if (session.endedAt) metaParts.push(`**Ended:** ${session.endedAt}`);
  metaParts.push(`**Machine:** ${session.machineId}`);
  if (session.projectPath) metaParts.push(`**Project:** ${session.projectPath}`);
  lines.push(metaParts.join(' | '));
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Messages');
  lines.push('');

  for (const msg of messages) {
    const label = formatMessageLabel(msg.type);
    const timestamp = msg.timestamp ? ` _(${msg.timestamp})_` : '';
    const toolSuffix = msg.toolName ? ` \`${msg.toolName}\`` : '';

    lines.push(`### ${label}${toolSuffix}${timestamp}`);
    lines.push('');

    const content = msg.content ?? '';
    if (msg.type === 'tool_use' || msg.type === 'tool_result') {
      lines.push('```');
      lines.push(content);
      lines.push('```');
    } else {
      lines.push(content);
    }
    lines.push('');
  }

  const md = lines.join('\n');
  const filename = `session-${session.id.slice(0, 12)}-${Date.now()}.md`;
  downloadFile(md, filename, 'text/markdown');
}
