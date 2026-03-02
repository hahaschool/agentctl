import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { Logger } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CMD_EXTENSION,
  createIpcMessage,
  createIpcResponse,
  RSP_EXTENSION,
} from './ipc-channel.js';
import { IpcClient, type IpcClientOptions } from './ipc-client.js';

const mockLogger = {
  child: () => mockLogger,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
} as unknown as Logger;

function makeOptions(overrides?: Partial<IpcClientOptions>): IpcClientOptions {
  return {
    ipcDir: '',
    logger: mockLogger,
    ...overrides,
  };
}

describe('IpcClient', () => {
  let tmpDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-client-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('sends a command file and reads the response', async () => {
    const ipcDir = path.join(tmpDir, 'ipc');
    const client = new IpcClient(makeOptions({ ipcDir, responseTimeoutMs: 5000 }));

    const msg = createIpcMessage('ping', { value: 42 }, 'test');

    // Simulate a server writing the response after a short delay.
    const rspPath = path.join(ipcDir, `${msg.id}${RSP_EXTENSION}`);
    const fakeResponse = createIpcResponse(msg.id, 'ok', { pong: true });

    setTimeout(async () => {
      await fs.mkdir(ipcDir, { recursive: true });
      await fs.writeFile(rspPath, JSON.stringify(fakeResponse), 'utf-8');
    }, 200);

    const response = await client.send(msg);

    expect(response.requestId).toBe(msg.id);
    expect(response.status).toBe('ok');
    expect(response.payload.pong).toBe(true);
  });

  it('returns RESPONSE_TIMEOUT when no response file appears', async () => {
    const ipcDir = path.join(tmpDir, 'ipc');
    const client = new IpcClient(makeOptions({ ipcDir, responseTimeoutMs: 300 }));

    const msg = createIpcMessage('slow', {}, 'test');

    // Do NOT write a response file — simulate an unresponsive server.
    const response = await client.send(msg);

    expect(response.requestId).toBe(msg.id);
    expect(response.status).toBe('error');
    expect(response.payload.code).toBe('RESPONSE_TIMEOUT');
    expect(response.payload.message).toContain('300ms');
  });

  it('cleans up command file after response timeout', async () => {
    const ipcDir = path.join(tmpDir, 'ipc');
    const client = new IpcClient(makeOptions({ ipcDir, responseTimeoutMs: 300 }));

    const msg = createIpcMessage('orphan', {}, 'test');

    await client.send(msg);

    // The command file should have been cleaned up on timeout.
    const cmdPath = path.join(ipcDir, `${msg.id}${CMD_EXTENSION}`);
    await expect(fs.access(cmdPath)).rejects.toThrow();
  });

  it('logs a warning when response times out', async () => {
    const ipcDir = path.join(tmpDir, 'ipc');
    const client = new IpcClient(makeOptions({ ipcDir, responseTimeoutMs: 300 }));

    const msg = createIpcMessage('timeout-log', {}, 'test');

    await client.send(msg);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: msg.id,
        timeoutMs: 300,
        ipcDir,
      }),
      'IPC response timed out',
    );
  });

  it('sendFireAndForget() writes command file without waiting', async () => {
    const ipcDir = path.join(tmpDir, 'ipc');
    const client = new IpcClient(makeOptions({ ipcDir }));

    const msg = createIpcMessage('fire', { data: 'test' }, 'test');

    await client.sendFireAndForget(msg);

    const cmdPath = path.join(ipcDir, `${msg.id}${CMD_EXTENSION}`);
    const raw = await fs.readFile(cmdPath, 'utf-8');
    const written = JSON.parse(raw);

    expect(written.id).toBe(msg.id);
    expect(written.type).toBe('fire');
    expect(written.payload.data).toBe('test');
  });
});
