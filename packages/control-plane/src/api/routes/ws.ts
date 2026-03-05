import type { AgentConfig, AgentEvent } from '@agentctl/shared';
import { ControlPlaneError, DEFAULT_WORKER_PORT } from '@agentctl/shared';
import type { Queue } from 'bullmq';
import type { FastifyPluginAsync } from 'fastify';
import type { Logger } from 'pino';
import type { WebSocket } from 'ws';

import type { DbAgentRegistry } from '../../registry/db-registry.js';
import type { AgentTaskJobData, AgentTaskJobName } from '../../scheduler/task-queue.js';
import { resolveWorkerUrlOrThrow } from '../resolve-worker-url.js';

const HEARTBEAT_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// Incoming message types (client -> server)
// ---------------------------------------------------------------------------

type SubscribeAgentMessage = {
  type: 'subscribe_agent';
  agentId: string;
};

type UnsubscribeAgentMessage = {
  type: 'unsubscribe_agent';
  agentId: string;
};

type StartAgentMessage = {
  type: 'start_agent';
  agentId: string;
  prompt: string;
  machineId?: string;
  config?: AgentConfig;
};

type StopAgentMessage = {
  type: 'stop_agent';
  agentId: string;
  graceful?: boolean;
};

type PingMessage = {
  type: 'ping';
};

type IncomingMessage =
  | SubscribeAgentMessage
  | UnsubscribeAgentMessage
  | StartAgentMessage
  | StopAgentMessage
  | PingMessage;

// ---------------------------------------------------------------------------
// Outgoing message types (server -> client)
// ---------------------------------------------------------------------------

type AgentEventMessage = {
  type: 'agent_event';
  agentId: string;
  event: AgentEvent;
};

type PongMessage = {
  type: 'pong';
  timestamp: string;
};

type ErrorMessage = {
  type: 'error';
  message: string;
  code: string;
};

type OutgoingMessage = AgentEventMessage | PongMessage | ErrorMessage;

// ---------------------------------------------------------------------------
// Route options
// ---------------------------------------------------------------------------

export type WsRouteOptions = {
  dbRegistry: DbAgentRegistry | null;
  taskQueue: Queue<AgentTaskJobData, void, AgentTaskJobName> | null;
  logger: Logger;
  workerPort?: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendJson(socket: WebSocket, message: OutgoingMessage): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function sendError(socket: WebSocket, code: string, message: string): void {
  sendJson(socket, { type: 'error', code, message });
}

const VALID_INCOMING_TYPES: ReadonlySet<string> = new Set([
  'subscribe_agent',
  'unsubscribe_agent',
  'start_agent',
  'stop_agent',
  'ping',
]);

function isValidIncomingMessage(msg: Record<string, unknown>): msg is IncomingMessage {
  return typeof msg.type === 'string' && VALID_INCOMING_TYPES.has(msg.type);
}

// ---------------------------------------------------------------------------
// SSE subscription helper — connects to a worker's SSE stream and relays
// events over the WebSocket as `agent_event` messages.
// ---------------------------------------------------------------------------

type SseSubscription = {
  cancel: () => void;
};

function subscribeSse(
  agentId: string,
  workerBaseUrl: string,
  socket: WebSocket,
  logger: Logger,
): SseSubscription {
  const controller = new AbortController();
  const upstreamUrl = `${workerBaseUrl}/api/agents/${encodeURIComponent(agentId)}/stream`;

  const pump = async (): Promise<void> => {
    try {
      const response = await fetch(upstreamUrl, { signal: controller.signal });

      if (!response.ok || !response.body) {
        logger.warn(
          { agentId, workerBaseUrl, status: response.status },
          'failed to connect to worker SSE stream',
        );
        sendError(
          socket,
          'WORKER_STREAM_ERROR',
          `Worker returned HTTP ${String(response.status)} for agent '${agentId}'`,
        );
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();

        if (done || controller.signal.aborted) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from the buffer.
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let currentEventType = '';

        for (const line of lines) {
          if (line.startsWith('event:')) {
            currentEventType = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            const data = line.slice(5).trim();

            try {
              const parsed = JSON.parse(data) as Record<string, unknown>;
              const agentEvent: AgentEvent = {
                event: (currentEventType || 'output') as AgentEvent['event'],
                data: parsed,
              } as AgentEvent;

              sendJson(socket, { type: 'agent_event', agentId, event: agentEvent });
            } catch {
              // Skip malformed SSE data lines.
              logger.debug({ agentId, data }, 'skipped malformed SSE data line');
            }

            currentEventType = '';
          } else if (line === '') {
            currentEventType = '';
          }
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ agentId, workerBaseUrl, err: message }, 'SSE subscription error');
        sendError(socket, 'SSE_ERROR', `SSE stream error for agent '${agentId}': ${message}`);
      }
    }
  };

  void pump();

  return {
    cancel(): void {
      controller.abort();
    },
  };
}

// ---------------------------------------------------------------------------
// Worker URL resolution — uses shared utility from resolve-worker-url.ts
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const wsRoutes: FastifyPluginAsync<WsRouteOptions> = async (app, opts) => {
  const { dbRegistry, taskQueue, logger, workerPort = DEFAULT_WORKER_PORT } = opts;

  app.get('/ws', { websocket: true }, (socket, request) => {
    logger.info({ remoteAddress: request.ip }, 'WebSocket client connected');

    // Per-connection state: active SSE subscriptions keyed by agentId.
    const subscriptions = new Map<string, SseSubscription>();

    // Heartbeat timer to keep the connection alive.
    const heartbeatTimer = setInterval(() => {
      if (socket.readyState === socket.OPEN) {
        socket.ping();
      }
    }, HEARTBEAT_INTERVAL_MS);

    // -----------------------------------------------------------------------
    // Message handler
    // -----------------------------------------------------------------------

    socket.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
      let msg: Record<string, unknown>;

      try {
        const text = typeof raw === 'string' ? raw : raw.toString('utf-8');
        msg = JSON.parse(text) as Record<string, unknown>;
      } catch {
        sendError(socket, 'INVALID_JSON', 'Failed to parse message as JSON');
        return;
      }

      if (!isValidIncomingMessage(msg)) {
        sendError(
          socket,
          'UNKNOWN_MESSAGE_TYPE',
          `Unknown or missing message type: ${String(msg.type)}`,
        );
        return;
      }

      // Handle each message type without awaiting — fire-and-forget with
      // internal error handling so a single bad message never kills the
      // connection.
      void handleMessage(msg).catch((err) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        const code = err instanceof ControlPlaneError ? err.code : 'INTERNAL_ERROR';
        logger.error({ err: errMsg, messageType: msg.type }, 'error handling WebSocket message');
        sendError(socket, code, errMsg);
      });
    });

    // -----------------------------------------------------------------------
    // Connection close
    // -----------------------------------------------------------------------

    socket.on('close', () => {
      logger.info({ remoteAddress: request.ip }, 'WebSocket client disconnected');
      clearInterval(heartbeatTimer);

      for (const [, sub] of subscriptions) {
        sub.cancel();
      }

      subscriptions.clear();
    });

    socket.on('error', (err: Error) => {
      logger.warn({ err: err.message }, 'WebSocket error');
    });

    // -----------------------------------------------------------------------
    // Message dispatch
    // -----------------------------------------------------------------------

    async function handleMessage(msg: IncomingMessage): Promise<void> {
      switch (msg.type) {
        case 'ping': {
          sendJson(socket, { type: 'pong', timestamp: new Date().toISOString() });
          return;
        }

        case 'subscribe_agent': {
          const { agentId } = msg;

          if (!agentId || typeof agentId !== 'string') {
            sendError(socket, 'INVALID_PARAMS', 'subscribe_agent requires a string agentId');
            return;
          }

          if (subscriptions.has(agentId)) {
            sendError(socket, 'ALREADY_SUBSCRIBED', `Already subscribed to agent '${agentId}'`);
            return;
          }

          if (!dbRegistry) {
            sendError(
              socket,
              'REGISTRY_UNAVAILABLE',
              'Database registry is not configured — cannot resolve agent worker address',
            );
            return;
          }

          const workerBaseUrl = await resolveWorkerUrlOrThrow(
            agentId,
            {},
            {
              dbRegistry,
              workerPort,
            },
          );

          const sub = subscribeSse(agentId, workerBaseUrl, socket, logger);
          subscriptions.set(agentId, sub);

          logger.info({ agentId, workerBaseUrl }, 'client subscribed to agent events');
          return;
        }

        case 'unsubscribe_agent': {
          const { agentId } = msg;

          if (!agentId || typeof agentId !== 'string') {
            sendError(socket, 'INVALID_PARAMS', 'unsubscribe_agent requires a string agentId');
            return;
          }

          const sub = subscriptions.get(agentId);

          if (sub) {
            sub.cancel();
            subscriptions.delete(agentId);
            logger.info({ agentId }, 'client unsubscribed from agent events');
          }

          return;
        }

        case 'start_agent': {
          const { agentId, prompt, config, machineId: requestedMachineId } = msg;

          if (!agentId || typeof agentId !== 'string') {
            sendError(socket, 'INVALID_PARAMS', 'start_agent requires a string agentId');
            return;
          }

          if (!prompt || typeof prompt !== 'string') {
            sendError(socket, 'INVALID_PARAMS', 'start_agent requires a non-empty string prompt');
            return;
          }

          if (!taskQueue) {
            sendError(socket, 'QUEUE_UNAVAILABLE', 'Task queue is not configured');
            return;
          }

          let machineId = agentId;

          if (dbRegistry) {
            let agent = await dbRegistry.getAgent(agentId);

            if (!agent) {
              // Auto-create the agent on first use so iOS clients can start
              // agents without a separate registration step.
              let targetMachineId = requestedMachineId;

              if (!targetMachineId) {
                const allMachines = await dbRegistry.listMachines();
                const onlineMachine = allMachines.find((m) => m.status === 'online');

                if (!onlineMachine) {
                  sendError(
                    socket,
                    'NO_MACHINES_AVAILABLE',
                    'Cannot auto-create agent: no online machines are registered',
                  );
                  return;
                }

                targetMachineId = onlineMachine.id;
              }

              const newAgentId = await dbRegistry.createAgent({
                machineId: targetMachineId,
                name: agentId,
                type: 'adhoc',
              });

              agent = await dbRegistry.getAgent(newAgentId);

              if (!agent) {
                sendError(
                  socket,
                  'AGENT_CREATE_FAILED',
                  `Failed to auto-create agent for '${agentId}'`,
                );
                return;
              }

              logger.info(
                { agentId: newAgentId, machineId: targetMachineId, originalId: agentId },
                'Auto-created adhoc agent on first use via WebSocket',
              );
            }

            machineId = agent.machineId;
          }

          const jobData: AgentTaskJobData = {
            agentId,
            machineId,
            prompt,
            model: config?.model ?? null,
            trigger: 'manual',
            allowedTools: config?.allowedTools ?? null,
            resumeSession: null,
            createdAt: new Date().toISOString(),
          };

          const job = await taskQueue.add('agent:start', jobData);

          logger.info({ agentId, jobId: job.id }, 'agent start job enqueued via WebSocket');
          sendJson(socket, {
            type: 'agent_event',
            agentId,
            event: {
              event: 'status',
              data: { status: 'starting', reason: `Job ${String(job.id)} enqueued` },
            },
          });
          return;
        }

        case 'stop_agent': {
          const { agentId, graceful } = msg;

          if (!agentId || typeof agentId !== 'string') {
            sendError(socket, 'INVALID_PARAMS', 'stop_agent requires a string agentId');
            return;
          }

          if (!dbRegistry) {
            sendError(
              socket,
              'REGISTRY_UNAVAILABLE',
              'Database registry is not configured — cannot resolve agent worker address',
            );
            return;
          }

          const workerBaseUrl = await resolveWorkerUrlOrThrow(
            agentId,
            {},
            {
              dbRegistry,
              workerPort,
            },
          );
          const stopUrl = `${workerBaseUrl}/api/agents/${encodeURIComponent(agentId)}/stop`;

          try {
            const response = await fetch(stopUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                reason: 'user',
                graceful: graceful ?? true,
              }),
            });

            if (!response.ok) {
              throw new ControlPlaneError(
                'WORKER_STOP_FAILED',
                `Worker returned HTTP ${String(response.status)} when stopping agent '${agentId}'`,
                { agentId, httpStatus: response.status },
              );
            }

            logger.info(
              { agentId, workerBaseUrl, graceful: graceful ?? true },
              'agent stop request sent via WebSocket',
            );
            sendJson(socket, {
              type: 'agent_event',
              agentId,
              event: {
                event: 'status',
                data: { status: 'stopping', reason: 'Stop requested via WebSocket' },
              },
            });
          } catch (err) {
            if (err instanceof ControlPlaneError) {
              throw err;
            }

            const message = err instanceof Error ? err.message : String(err);
            throw new ControlPlaneError(
              'WORKER_UNREACHABLE',
              `Failed to reach worker to stop agent '${agentId}': ${message}`,
              { agentId, workerBaseUrl },
            );
          }

          return;
        }
      }
    }
  });
};
