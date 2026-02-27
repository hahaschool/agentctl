import fs from 'node:fs/promises';
import path from 'node:path';
import { WorkerError } from '@agentctl/shared';
import type { Logger } from 'pino';

import { CMD_EXTENSION, type IpcMessage, type IpcResponse, RSP_EXTENSION } from './ipc-channel.js';

const DEFAULT_RESPONSE_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 100;

export type IpcClientOptions = {
  ipcDir: string;
  logger: Logger;
  responseTimeoutMs?: number;
};

/**
 * Sends commands to an agent's IPC directory and optionally waits for
 * the corresponding response.
 *
 * Used by the control plane (or tests) to communicate with a running
 * agent worker via the filesystem IPC channel.
 */
export class IpcClient {
  private readonly ipcDir: string;
  private readonly logger: Logger;
  private readonly responseTimeoutMs: number;

  constructor(options: IpcClientOptions) {
    this.ipcDir = options.ipcDir;
    this.logger = options.logger;
    this.responseTimeoutMs = options.responseTimeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS;
  }

  /**
   * Send a message and wait for the server to produce a response.
   *
   * Writes `{id}.cmd.json`, then polls for `{id}.rsp.json` until the
   * response appears or the timeout is exceeded.
   *
   * @throws {WorkerError} with code `IPC_TIMEOUT` if no response within timeout.
   */
  async send(message: IpcMessage): Promise<IpcResponse> {
    await this.writeCommandFile(message);

    this.logger.debug(
      { messageId: message.id, type: message.type, ipcDir: this.ipcDir },
      'IPC command sent, waiting for response',
    );

    const rspPath = path.join(this.ipcDir, message.id + RSP_EXTENSION);
    const deadline = Date.now() + this.responseTimeoutMs;

    while (Date.now() < deadline) {
      try {
        const raw = await fs.readFile(rspPath, 'utf-8');
        const response = JSON.parse(raw) as IpcResponse;

        // Clean up the response file after reading.
        await this.safeUnlink(rspPath);

        this.logger.debug(
          { messageId: message.id, status: response.status },
          'IPC response received',
        );

        return response;
      } catch (err) {
        // ENOENT means the response has not been written yet — keep polling.
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw new WorkerError(
            'IPC_READ_ERROR',
            `Failed to read IPC response for message '${message.id}': ${err instanceof Error ? err.message : String(err)}`,
            { messageId: message.id, ipcDir: this.ipcDir },
          );
        }
      }

      await this.sleep(POLL_INTERVAL_MS);
    }

    throw new WorkerError(
      'IPC_TIMEOUT',
      `No response received for message '${message.id}' within ${this.responseTimeoutMs}ms`,
      { messageId: message.id, timeoutMs: this.responseTimeoutMs, ipcDir: this.ipcDir },
    );
  }

  /**
   * Send a message without waiting for a response.
   *
   * Useful for fire-and-forget commands where the caller does not need
   * confirmation from the agent.
   */
  async sendFireAndForget(message: IpcMessage): Promise<void> {
    await this.writeCommandFile(message);

    this.logger.debug(
      { messageId: message.id, type: message.type, ipcDir: this.ipcDir },
      'IPC command sent (fire-and-forget)',
    );
  }

  // ── Private helpers ─────────────────────────────────────────────────

  /**
   * Write the command file into the IPC directory.
   *
   * Creates the directory if it does not exist.
   */
  private async writeCommandFile(message: IpcMessage): Promise<void> {
    await fs.mkdir(this.ipcDir, { recursive: true });

    const cmdPath = path.join(this.ipcDir, message.id + CMD_EXTENSION);
    await fs.writeFile(cmdPath, JSON.stringify(message, null, 2), 'utf-8');
  }

  /**
   * Remove a file, ignoring ENOENT if it was already deleted.
   */
  private async safeUnlink(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn({ filePath, err }, 'Failed to remove IPC file');
      }
    }
  }

  /**
   * Promise-based sleep helper.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
