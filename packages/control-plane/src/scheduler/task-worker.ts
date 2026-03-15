import {
  ControlPlaneError,
  DEFAULT_WORKER_PORT,
  type DispatchSignature,
  type DispatchSigningKeyPair,
  generateDispatchSigningKeyPair,
  type McpServerConfig,
  signDispatchPayload,
} from '@agentctl/shared';
import { type ConnectionOptions, type Job, Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';
import { agents as agentsTable, apiAccounts } from '../db/schema.js';
import type { MemoryInjector } from '../memory/memory-injector.js';
import type { DbAgentRegistry } from '../registry/db-registry.js';
import type { LiteLLMClient } from '../router/litellm-client.js';
import { decryptCredential } from '../utils/credential-crypto.js';
import { resolveAccountId } from '../utils/resolve-account.js';
import type { MachineCircuitBreaker } from './circuit-breaker.js';
import { AGENT_TASKS_QUEUE, type AgentTaskJobData, type AgentTaskJobName } from './task-queue.js';

const DISPATCH_TIMEOUT_MS = 30_000;

export type TaskWorkerOptions = {
  connection: ConnectionOptions;
  logger: Logger;
  concurrency?: number;
  registry?: DbAgentRegistry | null;
  memoryInjector?: MemoryInjector | null;
  litellmClient?: LiteLLMClient | null;
  controlPlaneUrl?: string;
  /** Optional circuit breaker to prevent dispatching to flaky machines. */
  circuitBreaker?: MachineCircuitBreaker | null;
  /** Optional database instance for account resolution during dispatch. */
  db?: Database | null;
  /** Ed25519 key pair used to sign control-plane dispatches. */
  dispatchSigningKeyPair?: DispatchSigningKeyPair;
};

type DispatchPayload = {
  runId: string;
  prompt: string | null;
  config: {
    model: string | null;
    allowedTools: string[] | null;
    /** MCP server definitions for the worker to write as `.mcp.json` before agent startup. */
    mcpServers?: Record<string, McpServerConfig> | null;
  };
  resumeSession: string | null;
  projectPath: string | null;
  /** URL of the control plane, so the worker can POST completion callbacks. */
  controlPlaneUrl: string | null;
  /** Decrypted API credential for the resolved account (if any). */
  accountCredential: string | null;
  /** Provider of the resolved account (e.g. "anthropic", "bedrock", "vertex"). */
  accountProvider: string | null;
  /** Ed25519 signature envelope for application-layer dispatch verification. */
  dispatchSignature: DispatchSignature;
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
  litellmClient = null,
  controlPlaneUrl,
  circuitBreaker = null,
  db = null,
  dispatchSigningKeyPair = generateDispatchSigningKeyPair(),
}: TaskWorkerOptions): Worker<AgentTaskJobData, void, AgentTaskJobName> {
  const worker = new Worker<AgentTaskJobData, void, AgentTaskJobName>(
    AGENT_TASKS_QUEUE,
    async (job: Job<AgentTaskJobData, void, AgentTaskJobName>) => {
      const {
        agentId,
        machineId,
        trigger,
        prompt,
        model,
        allowedTools,
        resumeSession,
        sessionMode,
        iteration,
        mcpServers: jobMcpServers,
      } = job.data;

      // Track retry state across BullMQ attempts.
      // attemptsMade is 0 on the first attempt and increments on each retry.
      const isRetry = job.attemptsMade > 0;
      const firstRunId: string | null = job.data.__firstRunId ?? null;

      const jobLogger = logger.child({
        jobId: job.id,
        jobName: job.name,
        agentId,
        machineId,
        trigger,
        sessionMode: sessionMode ?? null,
        iteration: iteration ?? null,
        attemptsMade: job.attemptsMade,
      });

      jobLogger.info(
        isRetry
          ? `Processing agent task job (retry attempt ${job.attemptsMade})`
          : 'Processing agent task job',
      );

      if (job.name === 'agent:signal') {
        jobLogger.info(
          { signalMetadata: job.data.signalMetadata ?? null },
          'Processing signal-triggered job',
        );
      }

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
        // 1a-ii. Circuit breaker check — prevent dispatching to flaky machines
        // -------------------------------------------------------------------
        if (circuitBreaker?.isOpen(machine.id)) {
          throw new ControlPlaneError(
            'MACHINE_CIRCUIT_OPEN',
            `Circuit breaker is open for machine '${machine.id}' (${machine.hostname}) — dispatch blocked`,
            { agentId, machineId: machine.id, hostname: machine.hostname },
          );
        }

        // -------------------------------------------------------------------
        // 1c. Session resume: resolve currentSessionId when resuming
        // -------------------------------------------------------------------
        let effectiveResumeSession = resumeSession;

        if (sessionMode === 'resume' && !effectiveResumeSession) {
          if (agent.currentSessionId) {
            effectiveResumeSession = agent.currentSessionId;
            jobLogger.info(
              { currentSessionId: agent.currentSessionId, iteration: iteration ?? 0 },
              'Resuming previous session (sessionMode=resume)',
            );
          } else {
            jobLogger.warn(
              { iteration: iteration ?? 0 },
              'sessionMode=resume but agent has no currentSessionId — starting fresh session',
            );
          }
        }

        // -------------------------------------------------------------------
        // 1d. Resolve the API account for this agent dispatch
        // -------------------------------------------------------------------
        let accountCredential: string | null = null;
        let accountProvider: string | null = null;

        if (db) {
          const encryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY ?? '';

          // Fetch the agent's accountId from the raw DB row since the
          // shared Agent type does not expose it.
          const [agentRow] = await db
            .select({ accountId: agentsTable.accountId })
            .from(agentsTable)
            .where(eq(agentsTable.id, agentId));

          const accountId = await resolveAccountId(
            {
              sessionAccountId: null,
              agentAccountId: agentRow?.accountId ?? null,
              projectPath: agent.projectPath ?? null,
            },
            db,
            jobLogger,
          );

          if (accountId && encryptionKey) {
            const [account] = await db
              .select()
              .from(apiAccounts)
              .where(eq(apiAccounts.id, accountId));

            if (account) {
              accountCredential = decryptCredential(
                account.credential,
                account.credentialIv,
                encryptionKey,
              );
              accountProvider = account.provider;
              jobLogger.info(
                { accountId, provider: account.provider },
                'Resolved API account for dispatch',
              );
            } else {
              jobLogger.warn(
                { accountId },
                'Resolved account ID does not match any api_accounts row — dispatching without credential',
              );
            }
          } else if (accountId && !encryptionKey) {
            jobLogger.warn(
              { accountId },
              'CREDENTIAL_ENCRYPTION_KEY not set — cannot decrypt credential for resolved account',
            );
          }
        }

        // -------------------------------------------------------------------
        // 1b. Validate the requested model against LiteLLM (soft check)
        // -------------------------------------------------------------------
        if (litellmClient && model) {
          try {
            const availableModels = await litellmClient.listModels();
            const modelFound = availableModels.includes(model);

            if (modelFound) {
              jobLogger.info(
                { model, availableModelCount: availableModels.length },
                'Model validated against LiteLLM — model is available',
              );
            } else {
              jobLogger.warn(
                { model, availableModelCount: availableModels.length },
                'Model not found in LiteLLM model list — proceeding anyway (proxy may still accept it)',
              );
            }
          } catch (err: unknown) {
            jobLogger.warn(
              { err, model },
              'Failed to validate model against LiteLLM — proceeding without validation',
            );
          }
        } else if (!litellmClient && model) {
          jobLogger.debug({ model }, 'LiteLLM client not configured — skipping model validation');
        }

        // -------------------------------------------------------------------
        // 2. Create a run record before dispatching
        // -------------------------------------------------------------------
        runId = await registry.createRun({
          agentId,
          trigger,
          model,
          provider: null,
          sessionId: effectiveResumeSession,
          retryOf: isRetry ? firstRunId : null,
          retryIndex: isRetry ? job.attemptsMade : null,
        });

        // Store the first run ID so subsequent retries can reference it.
        if (!isRetry) {
          await job.updateData({
            ...job.data,
            __firstRunId: runId,
          });
        }

        jobLogger.info(
          {
            runId,
            retryOf: isRetry ? firstRunId : null,
            retryIndex: isRetry ? job.attemptsMade : null,
          },
          'Agent run record created',
        );

        // -------------------------------------------------------------------
        // 3. Resolve effective prompt: explicit prompt > agent config defaultPrompt
        // -------------------------------------------------------------------
        const effectivePrompt = prompt ?? agent.config?.defaultPrompt ?? null;

        if (!effectivePrompt) {
          throw new ControlPlaneError(
            'NO_PROMPT_AVAILABLE',
            `No prompt provided and agent '${agentId}' has no defaultPrompt configured`,
            { agentId, trigger },
          );
        }

        // -------------------------------------------------------------------
        // 3b. Optionally enrich the prompt with relevant memories
        // -------------------------------------------------------------------
        let enrichedPrompt: string | null = effectivePrompt;

        if (memoryInjector && effectivePrompt) {
          const memoryContext = await memoryInjector.buildMemoryContext(agentId, effectivePrompt);

          if (memoryContext) {
            enrichedPrompt = `${memoryContext}\n\n${effectivePrompt}`;
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
        const address = machine.tailscaleIp ?? machine.hostname;
        const dispatchUrl = `http://${address}:${workerPort}/api/agents/${encodeURIComponent(agentId)}/start`;

        // Include MCP server config in the dispatch payload.
        // Job-level mcpServers (if provided) take priority over the agent's
        // stored configuration, enabling callers to override per-dispatch.
        const mcpServers = jobMcpServers ?? agent.config?.mcpServers ?? null;

        const unsignedPayload = {
          runId,
          prompt: enrichedPrompt,
          config: {
            model,
            allowedTools,
            mcpServers,
          },
          resumeSession: effectiveResumeSession,
          projectPath: agent.projectPath,
          controlPlaneUrl: controlPlaneUrl ?? null,
          accountCredential,
          accountProvider,
        };

        const payload: DispatchPayload = {
          ...unsignedPayload,
          dispatchSignature: signDispatchPayload(unsignedPayload, {
            agentId,
            machineId: machine.id,
            secretKey: dispatchSigningKeyPair.secretKey,
          }),
        };

        const result = await dispatchToWorker(dispatchUrl, payload, jobLogger);

        // Record successful dispatch with the circuit breaker.
        circuitBreaker?.recordSuccess(machine.id);

        // -------------------------------------------------------------------
        // 5. The run was created with status 'running' by createRun above.
        //    dispatchToWorker() only confirms the worker *accepted* the HTTP
        //    request — the agent itself is still executing asynchronously.
        //    Do NOT call completeRun here; the worker will report the final
        //    status (success/failure) via the audit reporter or a completion
        //    callback, which will call completeRun at that point.
        // -------------------------------------------------------------------
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
            sessionMode: sessionMode ?? null,
            iteration: iteration ?? null,
            resumedSession: effectiveResumeSession ?? null,
          },
          'Agent task dispatched; run is now executing on the worker',
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        jobLogger.error({ err, runId }, 'Agent task job failed');

        // Record dispatch failure with the circuit breaker when the error
        // is a dispatch-level problem (connection error or HTTP error).
        if (circuitBreaker && err instanceof ControlPlaneError) {
          const dispatchErrorCodes = new Set(['DISPATCH_CONNECTION_ERROR', 'DISPATCH_HTTP_ERROR']);

          if (dispatchErrorCodes.has(err.code) && err.context?.url) {
            // Extract machineId from the job data since the machine local
            // variable may not be in scope depending on where the error was
            // thrown.
            circuitBreaker.recordFailure(machineId);
          }
        }

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
