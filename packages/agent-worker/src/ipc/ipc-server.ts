import fs from 'node:fs/promises';
import path from 'node:path';
import { WorkerError } from '@agentctl/shared';
import type { Logger } from 'pino';

import {
  CMD_EXTENSION,
  createIpcResponse,
  type IpcMessage,
  type IpcResponse,
  RSP_EXTENSION,
  safeUnlink,
} from './ipc-channel.js';

const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_HANDLER_TIMEOUT_MS = 30_000;

export type IpcServerOptions = {
  ipcDir: string;
  agentId: string;
  logger: Logger;
  pollIntervalMs?: number;
  handlerTimeoutMs?: number;
};

export type IpcMessageHandler = (msg: IpcMessage) => Promise<IpcResponse>;

/**
 * Watches for incoming command files in a directory and dispatches them
 * to a registered handler.
 *
 * This implements the NanoClaw-style filesystem IPC pattern: the control
 * plane (or any client) writes `{id}.cmd.json` files into the IPC directory.
 * The server polls for new files, parses them, invokes the handler, writes
 * the response as `{id}.rsp.json`, and removes the original command file.
 */
export class IpcServer {
  private readonly ipcDir: string;
  private readonly agentId: string;
  private readonly logger: Logger;
  private readonly pollIntervalMs: number;
  private readonly handlerTimeoutMs: number;

  private handler: IpcMessageHandler | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private processing = false;

  constructor(options: IpcServerOptions) {
    this.ipcDir = options.ipcDir;
    this.agentId = options.agentId;
    this.logger = options.logger;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.handlerTimeoutMs = options.handlerTimeoutMs ?? DEFAULT_HANDLER_TIMEOUT_MS;
  }

  /**
   * Register a handler for incoming IPC messages.
   *
   * Only one handler can be active at a time; calling this again replaces
   * the previous handler.
   */
  onMessage(handler: IpcMessageHandler): void {
    this.handler = handler;
  }

  /**
   * Begin polling the IPC directory for new command files.
   *
   * Creates the IPC directory if it does not already exist.
   */
  async start(): Promise<void> {
    if (this.timer) {
      throw new WorkerError('IPC_ALREADY_STARTED', 'IPC server is already running', {
        agentId: this.agentId,
      });
    }

    await fs.mkdir(this.ipcDir, { recursive: true });

    this.timer = setInterval(() => {
      void this.poll();
    }, this.pollIntervalMs);

    this.logger.info(
      { agentId: this.agentId, ipcDir: this.ipcDir, pollIntervalMs: this.pollIntervalMs },
      'IPC server started',
    );
  }

  /**
   * Stop polling for new messages. In-flight message processing will
   * complete before the server is fully quiescent.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.logger.info({ agentId: this.agentId }, 'IPC server stopped');
  }

  // ── Private helpers ─────────────────────────────────────────────────

  /**
   * One poll cycle: read the directory, find `.cmd.json` files, and
   * process each one sequentially.
   */
  private async poll(): Promise<void> {
    // Guard against overlapping polls if a handler takes longer than
    // the poll interval.
    if (this.processing) {
      return;
    }

    this.processing = true;

    try {
      // Verify IPC directory is still accessible before reading.
      try {
        await fs.access(this.ipcDir);
      } catch {
        this.logger.warn(
          { agentId: this.agentId, ipcDir: this.ipcDir },
          'IPC directory is not accessible, skipping poll cycle',
        );
        return;
      }

      const entries = await fs.readdir(this.ipcDir);
      const cmdFiles = entries.filter((f) => f.endsWith(CMD_EXTENSION)).sort(); // Process in lexicographic order for determinism.

      for (const cmdFile of cmdFiles) {
        await this.processCommandFile(cmdFile);
      }
    } catch (err) {
      // ENOENT is expected if the directory was removed between polls.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.error({ agentId: this.agentId, err }, 'Error polling IPC directory');
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Read a single command file, invoke the handler, write the response,
   * and clean up the command file.
   */
  private async processCommandFile(filename: string): Promise<void> {
    const cmdPath = path.join(this.ipcDir, filename);

    let raw: string;
    try {
      raw = await fs.readFile(cmdPath, 'utf-8');
    } catch (err) {
      // File may have been removed between readdir and readFile.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw err;
    }

    let message: IpcMessage;
    try {
      message = JSON.parse(raw) as IpcMessage;
    } catch {
      this.logger.warn(
        { agentId: this.agentId, filename },
        'Failed to parse IPC command file, removing',
      );
      await safeUnlink(cmdPath, this.logger);
      return;
    }

    this.logger.debug(
      { agentId: this.agentId, messageId: message.id, type: message.type, sender: message.sender },
      'IPC message received',
    );

    let response: IpcResponse;

    if (!this.handler) {
      this.logger.warn(
        { agentId: this.agentId, messageId: message.id },
        'No handler registered, responding with error',
      );
      response = createIpcResponse(message.id, 'error', {
        code: 'NO_HANDLER',
        message: 'No message handler is registered on the IPC server',
      });
    } else {
      try {
        response = await this.runHandlerWithTimeout(this.handler, message);
      } catch (err) {
        this.logger.error(
          { agentId: this.agentId, messageId: message.id, err },
          'IPC handler threw an error',
        );
        response = createIpcResponse(message.id, 'error', {
          code: 'HANDLER_ERROR',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Write the response file before removing the command file so that
    // the client can never miss a response.
    const rspFilename = message.id + RSP_EXTENSION;
    const rspPath = path.join(this.ipcDir, rspFilename);

    await fs.writeFile(rspPath, JSON.stringify(response, null, 2), 'utf-8');

    this.logger.debug(
      { agentId: this.agentId, messageId: message.id, status: response.status },
      'IPC response written',
    );

    // Remove the command file to signal that the message has been
    // processed (and prevent re-processing on the next poll).
    await safeUnlink(cmdPath, this.logger);
  }

  /**
   * Run a handler with a timeout. If the handler does not resolve within
   * `handlerTimeoutMs`, a HANDLER_TIMEOUT error response is returned
   * instead of waiting indefinitely.
   */
  private async runHandlerWithTimeout(
    handler: IpcMessageHandler,
    message: IpcMessage,
  ): Promise<IpcResponse> {
    return new Promise<IpcResponse>((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.logger.warn(
            {
              agentId: this.agentId,
              messageId: message.id,
              timeoutMs: this.handlerTimeoutMs,
            },
            'IPC handler timed out',
          );
          resolve(
            createIpcResponse(message.id, 'error', {
              code: 'HANDLER_TIMEOUT',
              message: `Command handler timed out after ${this.handlerTimeoutMs}ms`,
            }),
          );
        }
      }, this.handlerTimeoutMs);

      handler(message).then(
        (result) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(result);
          }
        },
        (err: unknown) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(err);
          }
        },
      );
    });
  }
}
