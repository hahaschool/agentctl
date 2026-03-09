import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readNativeSourceSessionSummary } from './source-session.js';

const tempDirs: string[] = [];

async function writeTempJsonl(name: string, lines: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'agentctl-native-import-'));
  tempDirs.push(dir);
  const filePath = join(dir, name);
  await writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
  return filePath;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('readNativeSourceSessionSummary', () => {
  it('summarizes Claude Code JSONL sessions', async () => {
    const filePath = await writeTempJsonl('claude.jsonl', [
      JSON.stringify({
        type: 'queue-operation',
        timestamp: '2026-03-10T00:00:00.000Z',
      }),
      JSON.stringify({
        type: 'user',
        cwd: '/Users/hahaschool/agentctl',
        gitBranch: 'codex/runtime-unification-fresh',
        timestamp: '2026-03-10T00:00:01.000Z',
        message: {
          content: [{ type: 'text', text: 'Please continue the runtime handoff implementation.' }],
        },
      }),
      JSON.stringify({
        type: 'assistant',
        cwd: '/Users/hahaschool/agentctl',
        gitBranch: 'codex/runtime-unification-fresh',
        timestamp: '2026-03-10T00:00:03.000Z',
        message: {
          content: [{ type: 'text', text: 'I will inspect the native import path next.' }],
        },
      }),
    ]);

    const summary = await readNativeSourceSessionSummary({
      runtime: 'claude-code',
      sessionPath: filePath,
    });

    expect(summary.cwd).toBe('/Users/hahaschool/agentctl');
    expect(summary.gitBranch).toBe('codex/runtime-unification-fresh');
    expect(summary.lastActivity).toBe('2026-03-10T00:00:03.000Z');
    expect(summary.messageCounts).toEqual({ user: 1, assistant: 1, developer: 0 });
    expect(summary.recentMessages).toEqual([
      {
        role: 'user',
        text: 'Please continue the runtime handoff implementation.',
        timestamp: '2026-03-10T00:00:01.000Z',
      },
      {
        role: 'assistant',
        text: 'I will inspect the native import path next.',
        timestamp: '2026-03-10T00:00:03.000Z',
      },
    ]);
  });

  it('summarizes Codex JSONL sessions from response items', async () => {
    const filePath = await writeTempJsonl('codex.jsonl', [
      JSON.stringify({
        timestamp: '2026-03-10T00:05:00.000Z',
        type: 'session_meta',
        payload: {
          id: 'session-1',
          cwd: '/Users/hahaschool/agentctl',
        },
      }),
      JSON.stringify({
        timestamp: '2026-03-10T00:05:01.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Switch this task over to Claude Code.' }],
        },
      }),
      JSON.stringify({
        timestamp: '2026-03-10T00:05:02.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'I am probing native import prerequisites now.' }],
        },
      }),
      JSON.stringify({
        timestamp: '2026-03-10T00:05:03.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'web.run',
          arguments: '{}',
        },
      }),
    ]);

    const summary = await readNativeSourceSessionSummary({
      runtime: 'codex',
      sessionPath: filePath,
    });

    expect(summary.cwd).toBe('/Users/hahaschool/agentctl');
    expect(summary.gitBranch).toBeNull();
    expect(summary.lastActivity).toBe('2026-03-10T00:05:03.000Z');
    expect(summary.messageCounts).toEqual({ user: 1, assistant: 1, developer: 0 });
    expect(summary.recentMessages).toEqual([
      {
        role: 'user',
        text: 'Switch this task over to Claude Code.',
        timestamp: '2026-03-10T00:05:01.000Z',
      },
      {
        role: 'assistant',
        text: 'I am probing native import prerequisites now.',
        timestamp: '2026-03-10T00:05:02.000Z',
      },
    ]);
  });
});
