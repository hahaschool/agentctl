import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { Logger } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createIpcMessage, createIpcResponse, RSP_EXTENSION } from './ipc-channel.js';
import { IpcServer, type IpcServerOptions } from './ipc-server.js';

const mockLogger = {
  child: () => mockLogger,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
} as unknown as Logger;

function makeOptions(overrides?: Partial<IpcServerOptions>): IpcServerOptions {
  return {
    ipcDir: '',
    agentId: 'test-agent',
    logger: mockLogger,
    pollIntervalMs: 50,
    ...overrides,
  };
}

describe('IpcServer', () => {
  let tmpDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ipc-server-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('processes a command file and writes a response', async () => {
    const ipcDir = path.join(tmpDir, 'ipc');
    const server = new IpcServer(makeOptions({ ipcDir }));

    server.onMessage(async (msg) => {
      return createIpcResponse(msg.id, 'ok', { echo: msg.payload.text });
    });

    await server.start();

    const msg = createIpcMessage('ping', { text: 'hello' }, 'test-client');
    const cmdPath = path.join(ipcDir, `${msg.id}.cmd.json`);
    await fs.writeFile(cmdPath, JSON.stringify(msg), 'utf-8');

    // Wait for the server to poll and process the file.
    await sleep(200);

    server.stop();

    const rspPath = path.join(ipcDir, `${msg.id}${RSP_EXTENSION}`);
    const raw = await fs.readFile(rspPath, 'utf-8');
    const response = JSON.parse(raw);

    expect(response.requestId).toBe(msg.id);
    expect(response.status).toBe('ok');
    expect(response.payload.echo).toBe('hello');
  });

  it('writes HANDLER_TIMEOUT response when handler exceeds timeout', async () => {
    const ipcDir = path.join(tmpDir, 'ipc');
    const server = new IpcServer(makeOptions({ ipcDir, handlerTimeoutMs: 100 }));

    server.onMessage(async (_msg) => {
      // Simulate a handler that takes far longer than the timeout.
      await sleep(5000);
      return createIpcResponse(_msg.id, 'ok', {});
    });

    await server.start();

    const msg = createIpcMessage('slow', {}, 'test-client');
    const cmdPath = path.join(ipcDir, `${msg.id}.cmd.json`);
    await fs.writeFile(cmdPath, JSON.stringify(msg), 'utf-8');

    // Wait for timeout + poll cycle.
    await sleep(400);

    server.stop();

    const rspPath = path.join(ipcDir, `${msg.id}${RSP_EXTENSION}`);
    const raw = await fs.readFile(rspPath, 'utf-8');
    const response = JSON.parse(raw);

    expect(response.requestId).toBe(msg.id);
    expect(response.status).toBe('error');
    expect(response.payload.code).toBe('HANDLER_TIMEOUT');
    expect(response.payload.message).toContain('timed out');
  });

  it('writes HANDLER_ERROR response when handler throws', async () => {
    const ipcDir = path.join(tmpDir, 'ipc');
    const server = new IpcServer(makeOptions({ ipcDir }));

    server.onMessage(async () => {
      throw new Error('Something broke');
    });

    await server.start();

    const msg = createIpcMessage('fail', {}, 'test-client');
    const cmdPath = path.join(ipcDir, `${msg.id}.cmd.json`);
    await fs.writeFile(cmdPath, JSON.stringify(msg), 'utf-8');

    await sleep(200);

    server.stop();

    const rspPath = path.join(ipcDir, `${msg.id}${RSP_EXTENSION}`);
    const raw = await fs.readFile(rspPath, 'utf-8');
    const response = JSON.parse(raw);

    expect(response.requestId).toBe(msg.id);
    expect(response.status).toBe('error');
    expect(response.payload.code).toBe('HANDLER_ERROR');
    expect(response.payload.message).toBe('Something broke');
  });

  it('writes NO_HANDLER response when no handler is registered', async () => {
    const ipcDir = path.join(tmpDir, 'ipc');
    const server = new IpcServer(makeOptions({ ipcDir }));

    // Deliberately do NOT register a handler.

    await server.start();

    const msg = createIpcMessage('noop', {}, 'test-client');
    const cmdPath = path.join(ipcDir, `${msg.id}.cmd.json`);
    await fs.writeFile(cmdPath, JSON.stringify(msg), 'utf-8');

    await sleep(200);

    server.stop();

    const rspPath = path.join(ipcDir, `${msg.id}${RSP_EXTENSION}`);
    const raw = await fs.readFile(rspPath, 'utf-8');
    const response = JSON.parse(raw);

    expect(response.requestId).toBe(msg.id);
    expect(response.status).toBe('error');
    expect(response.payload.code).toBe('NO_HANDLER');
  });

  it('skips poll cycle when IPC directory is inaccessible', async () => {
    const ipcDir = path.join(tmpDir, 'ipc');
    const server = new IpcServer(makeOptions({ ipcDir }));

    server.onMessage(async (msg) => {
      return createIpcResponse(msg.id, 'ok', {});
    });

    await server.start();

    // Remove the directory to make it inaccessible.
    await fs.rm(ipcDir, { recursive: true, force: true });

    // Let a few poll cycles run — the server should not crash.
    await sleep(200);

    server.stop();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'test-agent', ipcDir }),
      'IPC directory is not accessible, skipping poll cycle',
    );
  });

  it('removes malformed command files without crashing', async () => {
    const ipcDir = path.join(tmpDir, 'ipc');
    const server = new IpcServer(makeOptions({ ipcDir }));

    server.onMessage(async (msg) => {
      return createIpcResponse(msg.id, 'ok', {});
    });

    await server.start();

    // Write invalid JSON as a command file.
    const cmdPath = path.join(ipcDir, 'bad-id.cmd.json');
    await fs.writeFile(cmdPath, 'not valid json{{{', 'utf-8');

    await sleep(200);

    server.stop();

    // The malformed file should have been removed.
    const entries = await fs.readdir(ipcDir);
    const remaining = entries.filter((e) => e.includes('bad-id'));

    expect(remaining).toHaveLength(0);
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
