import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { performance } from 'node:perf_hooks';

import { afterEach, describe, expect, it } from 'vitest';

const HOOK_PATH = new URL('./pre-compact-hook.ts', import.meta.url).pathname;

type HookResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
};

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

async function listen(server: http.Server): Promise<number> {
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP server address');
  }
  return address.port;
}

async function runHook(input: unknown, env: Record<string, string>): Promise<HookResult> {
  const startedAt = performance.now();
  const child = spawn(process.execPath, ['--import', 'tsx', HOOK_PATH], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  child.stdin.end(`${JSON.stringify(input)}\n`);
  const [code] = (await once(child, 'exit')) as [number | null, NodeJS.Signals | null];

  return {
    code,
    stdout,
    stderr,
    durationMs: performance.now() - startedAt,
  };
}

describe('pre-compact hook subprocess', () => {
  it('prints valid JSON and exits quickly when the worker does not respond', async () => {
    const hangingServer = http.createServer(() => {
      // Intentionally leave the request open so the hook must rely on its timeout.
    });
    const port = await listen(hangingServer);

    const result = await runHook(
      {
        context_size_tokens: 12_345,
        messages: [{ role: 'user', content: 'please preserve this before compaction' }],
      },
      {
        AGENTCTL_WORKER_PORT: String(port),
        AGENTCTL_SESSION_ID: 'session-1',
        AGENTCTL_AGENT_ID: 'agent-1',
        AGENTCTL_MACHINE_ID: 'machine-1',
      },
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('{}\n');
    expect(result.stderr).toBe('');
    expect(result.durationMs).toBeLessThan(2_500);
  });

  it('notifies the worker with compact recent messages when available', async () => {
    let receivedBody = '';
    let resolveReceived: () => void = () => {};
    const received = new Promise<void>((resolve) => {
      resolveReceived = resolve;
    });
    const server = http.createServer((request, response) => {
      expect(request.method).toBe('POST');
      expect(request.url).toBe('/api/sessions/session-2/pre-compact');
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        receivedBody += chunk;
      });
      request.on('end', () => {
        response.writeHead(202, { 'Content-Type': 'application/json' });
        response.end('{"queued":true}');
        resolveReceived();
      });
    });
    const port = await listen(server);

    const hookResult = runHook(
      {
        context_size_tokens: 999,
        messages: [
          { role: 'user', content: 'first' },
          { role: 'assistant', content: [{ type: 'text', text: 'second' }] },
        ],
      },
      {
        AGENTCTL_WORKER_PORT: String(port),
        AGENTCTL_SESSION_ID: 'session-2',
        AGENTCTL_AGENT_ID: 'agent-2',
        AGENTCTL_MACHINE_ID: 'machine-2',
      },
    );

    await received;
    const result = await hookResult;

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('{}\n');
    expect(result.stderr).toBe('');

    const body = JSON.parse(receivedBody) as {
      agentId: string;
      machineId: string;
      contextSizeTokens: number;
      recentMessages: string[];
    };

    expect(body).toEqual({
      agentId: 'agent-2',
      machineId: 'machine-2',
      contextSizeTokens: 999,
      recentMessages: ['user: first', 'assistant: second'],
    });
  });
});
