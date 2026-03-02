import { ControlPlaneError } from '@agentctl/shared';
import type { Logger } from 'pino';

import type { Mem0Client } from './mem0-client.js';

const DEFAULT_MAX_MEMORIES = 10;

export type MemoryInjectorOptions = {
  mem0Client: Mem0Client;
  maxMemories?: number;
  logger: Logger;
};

export class MemoryInjector {
  private readonly mem0Client: Mem0Client;
  private readonly maxMemories: number;
  private readonly logger: Logger;

  constructor(options: MemoryInjectorOptions) {
    this.mem0Client = options.mem0Client;
    this.maxMemories = options.maxMemories ?? DEFAULT_MAX_MEMORIES;
    this.logger = options.logger;
  }

  /**
   * Fetch relevant memories for the given agent and task prompt,
   * and format them as a prompt section to inject into the agent's system prompt.
   */
  async buildMemoryContext(agentId: string, taskPrompt: string): Promise<string> {
    this.logger.debug({ agentId, promptLength: taskPrompt.length }, 'Building memory context');

    try {
      const { results } = await this.mem0Client.search({
        query: taskPrompt,
        agentId,
        limit: this.maxMemories,
      });

      if (results.length === 0) {
        this.logger.debug({ agentId }, 'No relevant memories found');
        return '';
      }

      const memoryLines = results.map((entry) => `- ${entry.memory}`);
      const context = `## Relevant Memories\n${memoryLines.join('\n')}`;

      this.logger.info({ agentId, memoryCount: results.length }, 'Memory context built');

      return context;
    } catch (error: unknown) {
      // If Mem0 is unavailable, log a warning but don't block agent execution.
      // Memory is a best-effort enhancement, not a hard dependency.
      if (error instanceof ControlPlaneError) {
        this.logger.warn(
          { agentId, code: error.code, err: error },
          'Failed to fetch memories — continuing without memory context',
        );
        return '';
      }
      this.logger.warn(
        { agentId, err: error },
        'Unexpected error fetching memories — continuing without memory context',
      );
      return '';
    }
  }

  /**
   * After an agent run completes, sync the session summary back into Mem0
   * so future runs benefit from what was learned.
   */
  async syncAfterRun(
    agentId: string,
    sessionSummary: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    this.logger.debug({ agentId }, 'Syncing memory after run');

    try {
      await this.mem0Client.add({
        messages: [{ role: 'assistant', content: sessionSummary }],
        agentId,
        metadata: {
          source: 'agent-run',
          syncedAt: new Date().toISOString(),
          ...metadata,
        },
      });

      this.logger.info({ agentId }, 'Memory synced after run');
    } catch (error: unknown) {
      // Don't throw — memory sync failure should not break the agent lifecycle.
      if (error instanceof ControlPlaneError) {
        this.logger.warn(
          { agentId, code: error.code, err: error },
          'Failed to sync memory after run',
        );
        return;
      }
      this.logger.error({ agentId, err: error }, 'Unexpected error syncing memory after run');
    }
  }
}
