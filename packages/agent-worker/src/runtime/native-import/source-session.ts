import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

import type { ManagedRuntime } from '@agentctl/shared';

export type NativeSourceSessionMessage = {
  role: 'user' | 'assistant' | 'developer';
  text: string;
  timestamp: string | null;
};

export type NativeSourceSessionSummary = {
  runtime: ManagedRuntime;
  sessionPath: string;
  cwd: string | null;
  gitBranch: string | null;
  lastActivity: string | null;
  messageCounts: {
    user: number;
    assistant: number;
    developer: number;
  };
  recentMessages: NativeSourceSessionMessage[];
};

export async function readNativeSourceSessionSummary(input: {
  runtime: ManagedRuntime;
  sessionPath: string;
  recentMessageLimit?: number;
}): Promise<NativeSourceSessionSummary> {
  const summary: NativeSourceSessionSummary = {
    runtime: input.runtime,
    sessionPath: input.sessionPath,
    cwd: null,
    gitBranch: null,
    lastActivity: null,
    messageCounts: {
      user: 0,
      assistant: 0,
      developer: 0,
    },
    recentMessages: [],
  };

  const recentMessageLimit = Math.max(1, input.recentMessageLimit ?? 6);
  const lines = createInterface({
    input: createReadStream(input.sessionPath, { encoding: 'utf8' }),
    crlfDelay: Number.POSITIVE_INFINITY,
  });

  for await (const line of lines) {
    if (!line.trim()) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (input.runtime === 'claude-code') {
      collectClaudeEntry(summary, parsed, recentMessageLimit);
      continue;
    }

    collectCodexEntry(summary, parsed, recentMessageLimit);
  }

  return summary;
}

function collectClaudeEntry(
  summary: NativeSourceSessionSummary,
  parsed: unknown,
  recentMessageLimit: number,
): void {
  if (!isRecord(parsed)) return;

  const timestamp = asString(parsed.timestamp);
  updateLastActivity(summary, timestamp);
  summary.cwd ??= asString(parsed.cwd);
  summary.gitBranch ??= asString(parsed.gitBranch);

  const entryType = asString(parsed.type);
  if (entryType !== 'user' && entryType !== 'assistant') {
    return;
  }

  const text = extractClaudeMessageText(parsed.message, entryType);
  if (!text) return;

  pushRecentMessage(
    summary,
    {
      role: entryType,
      text,
      timestamp,
    },
    recentMessageLimit,
  );
}

function collectCodexEntry(
  summary: NativeSourceSessionSummary,
  parsed: unknown,
  recentMessageLimit: number,
): void {
  if (!isRecord(parsed)) return;

  const timestamp = asString(parsed.timestamp);
  updateLastActivity(summary, timestamp);

  if (asString(parsed.type) === 'session_meta' && isRecord(parsed.payload)) {
    summary.cwd ??= asString(parsed.payload.cwd);
    return;
  }

  if (asString(parsed.type) === 'turn_context' && isRecord(parsed.payload)) {
    summary.cwd ??= asString(parsed.payload.cwd);
    return;
  }

  if (asString(parsed.type) !== 'response_item' || !isRecord(parsed.payload)) {
    return;
  }

  if (asString(parsed.payload.type) !== 'message') {
    return;
  }

  const role = asString(parsed.payload.role);
  if (role !== 'user' && role !== 'assistant' && role !== 'developer') {
    return;
  }

  const text = extractText(parsed.payload.content);
  if (!text) return;

  pushRecentMessage(
    summary,
    {
      role,
      text,
      timestamp,
    },
    recentMessageLimit,
  );
}

function pushRecentMessage(
  summary: NativeSourceSessionSummary,
  message: NativeSourceSessionMessage,
  recentMessageLimit: number,
): void {
  summary.messageCounts[message.role] += 1;
  summary.recentMessages.push({
    ...message,
    text: truncate(message.text, 400),
  });

  while (summary.recentMessages.length > recentMessageLimit) {
    summary.recentMessages.shift();
  }
}

function updateLastActivity(summary: NativeSourceSessionSummary, timestamp: string | null): void {
  if (!timestamp) return;
  if (!summary.lastActivity || timestamp > summary.lastActivity) {
    summary.lastActivity = timestamp;
  }
}

function extractClaudeMessageText(message: unknown, role: 'user' | 'assistant'): string | null {
  if (!isRecord(message)) return null;
  if (typeof message.content === 'string') {
    return normalizeText(message.content);
  }

  if (!Array.isArray(message.content)) {
    return null;
  }

  const parts = message.content
    .flatMap((block) => {
      if (!isRecord(block)) return [];
      if (asString(block.type) !== 'text') return [];
      const text = asString(block.text);
      if (!text) return [];
      if (role === 'user' && text.startsWith('<') && text.includes('system-reminder')) {
        return [];
      }
      return [text];
    })
    .map(normalizeText)
    .filter((value): value is string => Boolean(value));

  return parts.length > 0 ? parts.join('\n\n') : null;
}

function extractText(value: unknown): string | null {
  if (typeof value === 'string') {
    return normalizeText(value);
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => extractText(entry))
      .filter((entry): entry is string => Boolean(entry));
    return parts.length > 0 ? parts.join('\n\n') : null;
  }

  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.text === 'string') {
    return normalizeText(value.text);
  }

  if ('content' in value) {
    return extractText(value.content);
  }

  return null;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function normalizeText(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
