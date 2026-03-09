// ---------------------------------------------------------------------------
// Worker-side terminal routes — HTTP + WebSocket endpoints for spawning and
// interacting with PTY terminal processes on this worker machine.
//
// REST endpoints handle lifecycle (list, spawn, resize, kill).
// WebSocket endpoint handles real-time bidirectional terminal I/O.
// ---------------------------------------------------------------------------

import { WorkerError } from '@agentctl/shared';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { Logger } from 'pino';

import type { TerminalManager } from '../../runtime/terminal-manager.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TerminalRouteOptions = FastifyPluginOptions & {
  terminalManager: TerminalManager;
  logger: Logger;
};

type SpawnBody = {
  id: string;
  command?: string;
  args?: string[];
  cols?: number;
  rows?: number;
  cwd?: string;
};

type ResizeBody = {
  cols: number;
  rows: number;
};

type TerminalParams = {
  id: string;
};

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export async function terminalRoutes(
  app: FastifyInstance,
  opts: TerminalRouteOptions,
): Promise<void> {
  const { terminalManager, logger } = opts;

  // -------------------------------------------------------------------------
  // GET / — list active terminals
  // -------------------------------------------------------------------------

  app.get('/', async () => {
    return terminalManager.list();
  });

  // -------------------------------------------------------------------------
  // POST / — spawn a new terminal
  // -------------------------------------------------------------------------

  app.post<{ Body: SpawnBody }>(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            command: { type: 'string' },
            args: { type: 'array', items: { type: 'string' } },
            cols: { type: 'integer', minimum: 1 },
            rows: { type: 'integer', minimum: 1 },
            cwd: { type: 'string' },
          },
          required: ['id'],
        },
      },
    },
    async (request) => {
      const { id, command, args, cols, rows, cwd } = request.body;

      logger.info({ terminalId: id, command, cwd }, 'Spawning terminal');

      const info = await terminalManager.spawn({ id, command, args, cols, rows, cwd });
      return info;
    },
  );

  // -------------------------------------------------------------------------
  // GET /:id — get terminal info
  // -------------------------------------------------------------------------

  app.get<{ Params: TerminalParams }>('/:id', async (request) => {
    const { id } = request.params;
    const info = terminalManager.get(id);
    if (!info) {
      throw new WorkerError('TERMINAL_NOT_FOUND', `Terminal ${id} not found`, { terminalId: id });
    }
    return info;
  });

  // -------------------------------------------------------------------------
  // POST /:id/resize — resize terminal dimensions
  // -------------------------------------------------------------------------

  app.post<{ Params: TerminalParams; Body: ResizeBody }>(
    '/:id/resize',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            cols: { type: 'integer', minimum: 1 },
            rows: { type: 'integer', minimum: 1 },
          },
          required: ['cols', 'rows'],
        },
      },
    },
    async (request) => {
      const { id } = request.params;
      const { cols, rows } = request.body;

      terminalManager.resize(id, cols, rows);
      logger.debug({ terminalId: id, cols, rows }, 'Terminal resized');

      return { success: true, cols, rows };
    },
  );

  // -------------------------------------------------------------------------
  // DELETE /:id — kill a terminal
  // -------------------------------------------------------------------------

  app.delete<{ Params: TerminalParams }>('/:id', async (request) => {
    const { id } = request.params;

    terminalManager.kill(id);
    logger.info({ terminalId: id }, 'Terminal killed via API');

    return { success: true };
  });

  // -------------------------------------------------------------------------
  // GET /:id/ws — WebSocket for terminal I/O
  // -------------------------------------------------------------------------

  app.get<{ Params: TerminalParams }>('/:id/ws', { websocket: true }, (socket, request) => {
    const { id } = request.params;

    const info = terminalManager.get(id);
    if (!info) {
      socket.send(JSON.stringify({ type: 'error', message: `Terminal ${id} not found` }));
      socket.close();
      return;
    }

    logger.info({ terminalId: id }, 'WebSocket connected to terminal');

    // Subscribe to terminal events and relay to WebSocket
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = terminalManager.subscribe(id, (event) => {
        if (socket.readyState === 1 /* OPEN */) {
          socket.send(JSON.stringify(event));
        }
      });
    } catch {
      socket.send(JSON.stringify({ type: 'error', message: `Terminal ${id} not found` }));
      socket.close();
      return;
    }

    // Handle incoming messages from WebSocket
    socket.on('message', (rawData) => {
      try {
        const data = typeof rawData === 'string' ? rawData : rawData.toString();
        const message = JSON.parse(data) as {
          type: string;
          data?: string;
          cols?: number;
          rows?: number;
        };

        if (message.type === 'input' && typeof message.data === 'string') {
          try {
            terminalManager.write(id, message.data);
          } catch {
            // Terminal may have exited — ignore write errors
          }
        } else if (
          message.type === 'resize' &&
          typeof message.cols === 'number' &&
          typeof message.rows === 'number'
        ) {
          try {
            terminalManager.resize(id, message.cols, message.rows);
          } catch {
            // Terminal may have exited — ignore resize errors
          }
        }
      } catch {
        // Ignore malformed JSON messages
        logger.debug({ terminalId: id }, 'Received malformed WebSocket message');
      }
    });

    // Cleanup on WebSocket close
    socket.on('close', () => {
      logger.info({ terminalId: id }, 'WebSocket disconnected from terminal');
      if (unsubscribe) {
        unsubscribe();
      }
    });
  });
}
