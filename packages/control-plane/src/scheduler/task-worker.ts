import { ControlPlaneError } from '@agentctl/shared';
import { type ConnectionOptions, type Job, Worker } from 'bullmq';
import type { Logger } from 'pino';
import type { MemoryInjector } from '../memory/memory-injector.js';
import type { DbAgentRegistry } from '../registry/db-registry.js';
import { AGENT_TASKS_QUEUE, type AgentTaskJobData, type AgentTaskJobName } from './task-queue.js';

const DEFAULT_WORKER_PORT = 9000;
const DISPATCH_TIMEOUT_MS = 30_000;

export type TaskWorkerOptions = {
  connection: ConnectionOptions;
  logger: Logger;
  concurrency?: number;
  registry?: DbAgentRegistry | null;
  memoryInjector?: MemoryInjector | null;
  controlPlaneUrl?: string;
};

type DispatchPayload = {
  prompt: string | null;
  config: {
    model: string | null;
    tools: string[] | null;
    resumeSession: string | null;
  };
  projectPath: string | null;
};

type DispatchResult = {
  ok: boolean;
  runId?: string;
  message?: string;
};

async function dispatchToWorker(
  url: string,
  payload: DispatchPayload,
  logger: Logger,
): Promise<DispatchResult> {
  logger.debug({ url }, 'Dispatching task to agent worker');

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ControlPlaneError(
      'DISPATCH_CONNECTION_ERROR',
      `Failed to connect to agent worker at ${url}: ${message}`,
      { url },
    );
  }

  if (!response.ok) {
    let errorBody: string;
    try {
      errorBody = await response.text();
    } catch {
      errorBody = '<unreadable>';
    }

    throw new ControlPlaneError(
      'DISPATCH_HTTP_ERROR',
      `Agent worker returned ${response.status}: ${errorBody}`,
      { url, status: response.status },
    );
  }

  try {
    const body = await response.json();
    return body as DispatchResult;
  } catch {
    // Worker responded 2xx but body is not JSON — treat as success with no metadata.
    return { ok: true };
  }
}

export function createTaskWorker({
  connection,
  logger,
  concurrency = 5,
  registry = null,
  memoryInjector = null,
  controlPlaneUrl,
}: TaskWorkerOptions): Worker<AgentTaskJobData, void, AgentTaskJobName> {
  const worker = new Worker<AgentTaskJobData, void, AgentTaskJobName>(
    AGENT_TASKS_QUEUE,
    async (job: Job<AgentTaskJobData, void, AgentTaskJobName>) => {
      const { agentId, machineId, trigger, prompt, model, tools, resumeSession } = job.data;

      const jobLogger = logger.child({
        jobId: job.id,
        jobName: job.name,
        agentId,
        machineId,
        trigger,
      });

      jobLogger.info('Processing agent task job');

      // -----------------------------------------------------------------------
      // Guard: registry is required to resolve the target machine address.
      // Without it we cannot look up the tailscaleIp, so we fail explicitly.
      // -----------------------------------------------------------------------
      if (!registry) {
        jobLogger.warn(
          'No database registry available (DATABASE_URL not set) — cannot dispatch task',
        );
        throw new ControlPlaneError(
          'REGISTRY_UNAVAILABLE',
          `Cannot dispatch task for agent ${agentId}: database registry is not configured`,
          { agentId, machineId, jobId: job.id },
        );
      }

      let runId: string | null = null;

      try {
        // -------------------------------------------------------------------
        // 1. Resolve the agent and its host machine from the registry
        // -------------------------------------------------------------------
        const agent = await registry.getAgent(agentId);

        if (!agent) {
          throw new ControlPlaneError(
            'AGENT_NOT_FOUND',
            `Agent '${agentId}' does not exist in the registry`,
            { agentId },
          );
        }

        const machine = await registry.getMachine(agent.machineId);

        if (!machine) {
          throw new ControlPlaneError(
            'MACHINE_NOT_FOUND',
            `Machine '${agent.machineId}' for agent '${agentId}' is not registered`,
            { agentId, machineId: agent.machineId },
          );
        }

        if (machine.status === 'offline') {
          throw new ControlPlaneError(
            'MACHINE_OFFLINE',
            `Machine '${machine.id}' (${machine.hostname}) is offline`,
            { agentId, machineId: machine.id, hostname: machine.hostname },
          );
        }

        // -------------------------------------------------------------------
        // 2. Create a run record before dispatching
        // -------------------------------------------------------------------
        runId = await registry.createRun({
          agentId,
          trigger,
          model,
          provider: null,
          sessionId: resumeSession,
        });

        jobLogger.info({ runId }, 'Agent run record created');

        // -------------------------------------------------------------------
        // 3. Optionally enrich the prompt with relevant memories
        // -------------------------------------------------------------------
        let enrichedPrompt = prompt;

        if (memoryInjector && prompt) {
          const memoryContext = await memoryInjector.buildMemoryContext(agentId, prompt);

          if (memoryContext) {
            enrichedPrompt = `${memoryContext}\n\n${prompt}`;
            jobLogger.info(
              { memoryContextLength: memoryContext.length },
              'Prepended memory context to prompt',
            );
          }
        }

        // -------------------------------------------------------------------
        // 4. Dispatch to the agent worker HTTP endpoint
        // -------------------------------------------------------------------
        const workerPort = DEFAULT_WORKER_PORT;
        const dispatchUrl = `http://${machine.tailscaleIp}:${workerPort}/api/agents/${encodeURIComponent(agentId)}/start`;

        const payload: DispatchPayload = {
          prompt: enrichedPrompt,
          config: {
            model,
            tools,
            resumeSession,
          },
          projectPath: agent.projectPath,
        };

        const result = await dispatchToWorker(dispatchUrl, payload, jobLogger);

        // -------------------------------------------------------------------
        // 5. Complete the run with success
        // -------------------------------------------------------------------
        await registry.completeRun(runId, {
          status: 'success',
          resultSummary: result.message ?? null,
        });

        jobLogger.info(
          {
            runId,
            dispatchUrl,
            workerPort,
            tailscaleIp: machine.tailscaleIp,
            hostname: machine.hostname,
            resultOk: result.ok,
            promptLength: enrichedPrompt ? enrichedPrompt.length : 0,
            model,
            controlPlaneUrl: controlPlaneUrl ?? null,
          },
          'Agent task dispatched and run completed successfully',
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        jobLogger.error({ err, runId }, 'Agent task job failed');

        // -------------------------------------------------------------------
        // Mark the run as failed if one was created
        // -------------------------------------------------------------------
        if (runId) {
          try {
            await registry.completeRun(runId, {
              status: 'failure',
              errorMessage: message,
            });
            jobLogger.info({ runId }, 'Agent run marked as failed');
          } catch (completeErr: unknown) {
            jobLogger.error({ err: completeErr, runId }, 'Failed to mark agent run as failed');
          }
        }

        // Re-throw ControlPlaneErrors as-is so BullMQ sees a typed error.
        if (err instanceof ControlPlaneError) {
          throw err;
        }

        throw new ControlPlaneError(
          'TASK_PROCESSING_FAILED',
          `Failed to process task for agent ${agentId}: ${message}`,
          { agentId, machineId, jobId: job.id },
        );
      }
    },
    {
      connection,
      concurrency,
      autorun: true,
    },
  );

  worker.on('completed', (job: Job<AgentTaskJobData, void, AgentTaskJobName>) => {
    logger.debug({ jobId: job.id, agentId: job.data.agentId }, 'Job completed');
  });

  worker.on(
    'failed',
    (job: Job<AgentTaskJobData, void, AgentTaskJobName> | undefined, err: Error) => {
      logger.error({ jobId: job?.id, agentId: job?.data.agentId, err }, 'Job failed');
    },
  );

  worker.on('error', (err: Error) => {
    logger.error({ err }, 'Task worker error');
  });

  return worker;
}
