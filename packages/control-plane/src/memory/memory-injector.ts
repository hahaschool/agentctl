import { ControlPlaneError } from '@agentctl/shared';
import type { Logger } from 'pino';

import type { Mem0Client } from './mem0-client.js';
import type { MemorySearch } from './memory-search.js';
import type { MemoryStore } from './memory-store.js';

const DEFAULT_MAX_MEMORIES = 10;

export type MemoryBackend = 'mem0' | 'postgres';

export type MemoryInjectorOptions = {
  backend?: MemoryBackend;
  mem0Client?: Mem0Client;
  memorySearch?: Pick<MemorySearch, 'search'>;
  memoryStore?: Pick<MemoryStore, 'addFact'>;
  maxMemories?: number;
  logger: Logger;
};

export class MemoryInjector {
  private readonly backend: MemoryBackend | null;
  private readonly mem0Client: Mem0Client | null;
  private readonly memorySearch: Pick<MemorySearch, 'search'> | null;
  private readonly memoryStore: Pick<MemoryStore, 'addFact'> | null;
  private readonly maxMemories: number;
  private readonly logger: Logger;

  constructor(options: MemoryInjectorOptions) {
    this.mem0Client = options.mem0Client ?? null;
    this.memorySearch = options.memorySearch ?? null;
    this.memoryStore = options.memoryStore ?? null;
    this.maxMemories = options.maxMemories ?? DEFAULT_MAX_MEMORIES;
    this.logger = options.logger;
    this.backend = this.resolveBackend(options.backend ?? null);
  }

  /**
   * Fetch relevant memories for the given agent and task prompt,
   * and format them as a prompt section to inject into the agent's system prompt.
   */
  async buildMemoryContext(agentId: string, taskPrompt: string): Promise<string> {
    this.logger.debug({ agentId, promptLength: taskPrompt.length }, 'Building memory context');

    if (this.backend === 'postgres') {
      return this.buildPostgresMemoryContext(agentId, taskPrompt);
    }

    if (this.backend !== 'mem0' || !this.mem0Client) {
      return '';
    }

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

    if (this.backend === 'postgres') {
      await this.syncPostgresMemory(agentId, sessionSummary, metadata);
      return;
    }

    if (this.backend !== 'mem0' || !this.mem0Client) {
      return;
    }

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

  private resolveBackend(requestedBackend: MemoryBackend | null): MemoryBackend | null {
    const hasMem0 = this.mem0Client !== null;
    const hasPostgres = this.memorySearch !== null && this.memoryStore !== null;

    if (requestedBackend === 'postgres') {
      return hasPostgres ? 'postgres' : hasMem0 ? 'mem0' : null;
    }

    if (requestedBackend === 'mem0') {
      return hasMem0 ? 'mem0' : hasPostgres ? 'postgres' : null;
    }

    if (hasPostgres) {
      return 'postgres';
    }

    if (hasMem0) {
      return 'mem0';
    }

    return null;
  }

  private async buildPostgresMemoryContext(agentId: string, taskPrompt: string): Promise<string> {
    if (!this.memorySearch) {
      return '';
    }

    try {
      const results = await this.memorySearch.search({
        query: taskPrompt,
        visibleScopes: [`agent:${agentId}`, 'global'],
        limit: this.maxMemories,
      });

      if (results.length === 0) {
        this.logger.debug({ agentId }, 'No relevant PG memories found');
        return '';
      }

      const memoryLines = results.map((entry) => `- ${entry.fact.content}`);
      const context = `## Relevant Memories\n${memoryLines.join('\n')}`;

      this.logger.info({ agentId, memoryCount: results.length }, 'PG memory context built');
      return context;
    } catch (error: unknown) {
      if (error instanceof ControlPlaneError) {
        this.logger.warn(
          { agentId, code: error.code, err: error },
          'Failed to fetch PG memories — continuing without memory context',
        );
        return '';
      }
      this.logger.warn(
        { agentId, err: error },
        'Unexpected error fetching PG memories — continuing without memory context',
      );
      return '';
    }
  }

  private async syncPostgresMemory(
    agentId: string,
    sessionSummary: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.memoryStore) {
      return;
    }

    try {
      await this.memoryStore.addFact({
        scope: `agent:${agentId}`,
        content: sessionSummary,
        entity_type: 'decision',
        source: {
          session_id:
            this.stringMetadata(metadata, 'runId') ?? this.stringMetadata(metadata, 'sessionId'),
          agent_id: agentId,
          machine_id: this.stringMetadata(metadata, 'machineId'),
          turn_index: null,
          extraction_method: 'rule',
        },
        confidence: 0.8,
      });

      this.logger.info({ agentId }, 'PG memory synced after run');
    } catch (error: unknown) {
      if (error instanceof ControlPlaneError) {
        this.logger.warn(
          { agentId, code: error.code, err: error },
          'Failed to sync PG memory after run',
        );
        return;
      }
      this.logger.error({ agentId, err: error }, 'Unexpected error syncing PG memory after run');
    }
  }

  private stringMetadata(
    metadata: Record<string, unknown> | undefined,
    key: string,
  ): string | null {
    const value = metadata?.[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }
}
