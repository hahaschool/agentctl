import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';

import type { Logger } from 'pino';

/**
 * A message sent via the filesystem IPC channel.
 *
 * The sender writes a `{id}.cmd.json` file containing this structure.
 * The `type` field acts as a discriminant so handlers can dispatch on
 * the kind of command being issued.
 */
export type IpcMessage = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
  sender: string;
};

/**
 * A response written by the IPC server after processing a message.
 *
 * Written as `{requestId}.rsp.json` in the same IPC directory.
 */
export type IpcResponse = {
  requestId: string;
  status: 'ok' | 'error';
  payload: Record<string, unknown>;
  timestamp: string;
};

/**
 * Create a new IPC message with a unique ID and the current timestamp.
 */
export function createIpcMessage(
  type: string,
  payload: Record<string, unknown>,
  sender: string,
): IpcMessage {
  return {
    id: randomUUID(),
    type,
    payload,
    timestamp: new Date().toISOString(),
    sender,
  };
}

/**
 * Create an IPC response for a given request.
 */
export function createIpcResponse(
  requestId: string,
  status: 'ok' | 'error',
  payload: Record<string, unknown>,
): IpcResponse {
  return {
    requestId,
    status,
    payload,
    timestamp: new Date().toISOString(),
  };
}

/** File extension for command files. */
export const CMD_EXTENSION = '.cmd.json';

/** File extension for response files. */
export const RSP_EXTENSION = '.rsp.json';

/**
 * Remove a file, ignoring ENOENT if it was already deleted.
 */
export async function safeUnlink(filePath: string, logger: Logger): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn({ filePath, err }, 'Failed to remove IPC file');
    }
  }
}
