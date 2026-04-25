import type {
  InjectionBudget,
  InjectionTier,
  MemoryFact,
  MemoryFactSourcePreview,
  MemoryInjectionResultMode,
  TriggerContext,
} from '@agentctl/shared';
import { ControlPlaneError, DEFAULT_INJECTION_BUDGET } from '@agentctl/shared';
import type { Logger } from 'pino';

import { buildContextBudget, estimateTokens } from './context-budget.js';
import type { Mem0Client } from './mem0-client.js';
import type { MemoryFactSourceDrawer } from './memory-fact-source-drawers.js';
import type { MemorySearch } from './memory-search.js';
import type { MemoryStore } from './memory-store.js';

const DEFAULT_MAX_MEMORIES = 10;
const DEFAULT_INJECTION_RESULT_MODE = DEFAULT_INJECTION_BUDGET.resultMode;
const MAX_SNIPPET_FACTS = 3;
const MAX_SNIPPET_CHARS = 160;
const MAX_TOTAL_SNIPPET_CHARS = MAX_SNIPPET_FACTS * MAX_SNIPPET_CHARS;
const MAX_FULL_DRAWER_FACTS = 2;
const MAX_FULL_DRAWER_CHARS = 1200;
const CHARS_PER_ESTIMATED_TOKEN = 4;

export type MemoryBackend = 'mem0' | 'postgres';

type MemoryStoreLike = Pick<MemoryStore, 'addFact' | 'listFacts'> &
  Partial<Pick<MemoryStore, 'listFactSourcePreviews'>>;

type FactSourceDrawerLoader = (factId: string) => Promise<readonly MemoryFactSourceDrawer[]>;

type RenderMemoryLineOptions = {
  onDemandFactIds: ReadonlySet<string>;
  factTierById: ReadonlyMap<string, InjectionTier>;
  injectionTokenCount: number;
  tierTokenCounts: Readonly<Record<InjectionTier, number>>;
};

type AdditiveBudgetState = {
  globalTokens: number;
  tierTokens: Record<InjectionTier, number | null>;
};

export type MemoryInjectorOptions = {
  backend?: MemoryBackend;
  mem0Client?: Mem0Client;
  memorySearch?: Pick<MemorySearch, 'search'>;
  memoryStore?: MemoryStoreLike;
  loadFactSourceDrawers?: FactSourceDrawerLoader;
  maxMemories?: number;
  injectionBudget?: InjectionBudget;
  logger: Logger;
};

export class MemoryInjector {
  private readonly backend: MemoryBackend | null;
  private readonly mem0Client: Mem0Client | null;
  private readonly memorySearch: Pick<MemorySearch, 'search'> | null;
  private readonly memoryStore: MemoryStoreLike | null;
  private readonly loadFactSourceDrawers: FactSourceDrawerLoader | null;
  private readonly maxMemories: number;
  private readonly injectionBudget: InjectionBudget;
  private readonly resultMode: MemoryInjectionResultMode;
  private readonly logger: Logger;

  constructor(options: MemoryInjectorOptions) {
    this.mem0Client = options.mem0Client ?? null;
    this.memorySearch = options.memorySearch ?? null;
    this.memoryStore = options.memoryStore ?? null;
    this.loadFactSourceDrawers = options.loadFactSourceDrawers ?? null;
    this.maxMemories = options.maxMemories ?? DEFAULT_MAX_MEMORIES;
    this.injectionBudget = options.injectionBudget ?? DEFAULT_INJECTION_BUDGET;
    this.logger = options.logger;
    this.backend = this.resolveBackend(options.backend ?? null);
    this.resultMode = this.resolveResultMode(this.injectionBudget.resultMode);
  }

  /**
   * Fetch relevant memories for the given agent and task prompt,
   * and format them as a prompt section to inject into the agent's system prompt.
   *
   * When using the postgres backend, applies 3-tier context budget injection:
   *   1. Pinned facts (always included, no decay)
   *   2. On-demand facts (ranked by relevance, fills remaining budget)
   *   3. Triggered facts (matched against current tool/file/keyword context)
   */
  async buildMemoryContext(
    agentId: string,
    taskPrompt: string,
    triggerContext?: TriggerContext,
  ): Promise<string> {
    this.logger.debug(
      { agentId, promptLength: taskPrompt.length, resultMode: this.resultMode },
      'Building memory context',
    );

    if (this.backend === 'postgres') {
      return this.buildPostgresMemoryContext(agentId, taskPrompt, triggerContext);
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

  private resolveResultMode(requestedMode?: MemoryInjectionResultMode): MemoryInjectionResultMode {
    const resultMode = requestedMode ?? DEFAULT_INJECTION_RESULT_MODE;

    if (resultMode === 'fact-plus-snippet' || resultMode === 'full-drawer') {
      if (this.backend !== 'postgres') {
        this.logger.warn(
          { requestedMode: resultMode, backend: this.backend },
          'memory injection result mode requires the postgres backend - falling back to fact-only',
        );
        return DEFAULT_INJECTION_RESULT_MODE;
      }
    }

    if (resultMode === 'fact-plus-snippet') {
      if (!this.memoryStore || typeof this.memoryStore.listFactSourcePreviews !== 'function') {
        this.logger.warn(
          { requestedMode: resultMode },
          'fact-plus-snippet injection mode requires fact source preview support - falling back to fact-only',
        );
        return DEFAULT_INJECTION_RESULT_MODE;
      }
    }

    if (resultMode === 'full-drawer' && !this.loadFactSourceDrawers) {
      this.logger.warn(
        { requestedMode: resultMode },
        'full-drawer injection mode requires fact source drawer support - falling back to fact-only',
      );
      return DEFAULT_INJECTION_RESULT_MODE;
    }

    return resultMode;
  }

  private async buildPostgresMemoryContext(
    agentId: string,
    taskPrompt: string,
    triggerContext?: TriggerContext,
  ): Promise<string> {
    if (!this.memorySearch) {
      return '';
    }

    try {
      const visibleScopes = [`agent:${agentId}`, 'global'];

      // Fetch relevance-ranked search results for on-demand tier
      const searchResults = await this.memorySearch.search({
        query: taskPrompt,
        visibleScopes,
        limit: this.injectionBudget.maxFacts,
      });

      // Fetch all visible facts for pinned + triggered tiers
      const allFacts = this.memoryStore
        ? await this.memoryStore.listFacts({ visibleScopes, limit: 200 })
        : searchResults.map((result) => result.fact);

      const injectionResult = buildContextBudget({
        allFacts,
        searchResults,
        triggerContext,
        budget: this.injectionBudget,
      });

      if (injectionResult.facts.length === 0) {
        this.logger.debug({ agentId }, 'No relevant PG memories found');
        return '';
      }

      const memoryLines = await this.renderMemoryLines(injectionResult.facts, {
        onDemandFactIds: this.onDemandFactIdsForInjection(
          injectionResult.facts,
          injectionResult.tierBreakdown.pinned,
          injectionResult.tierBreakdown['on-demand'],
        ),
        ...this.additiveBudgetInputsForInjection(
          injectionResult.facts,
          injectionResult.tierBreakdown,
        ),
        injectionTokenCount: injectionResult.tokenCount,
      });
      const context = `## Relevant Memories\n${memoryLines.join('\n')}`;

      this.logger.info(
        {
          agentId,
          memoryCount: injectionResult.facts.length,
          tokenCount: injectionResult.tokenCount,
          tierBreakdown: injectionResult.tierBreakdown,
          resultMode: this.resultMode,
        },
        'PG memory context built with 3-tier budget',
      );
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

  private async renderMemoryLines(
    facts: readonly MemoryFact[],
    options: RenderMemoryLineOptions,
  ): Promise<string[]> {
    if (this.resultMode === 'fact-plus-snippet') {
      return this.renderFactPlusSnippetLines(facts, options);
    }

    if (this.resultMode === 'full-drawer') {
      return this.renderFullDrawerLines(facts, options);
    }

    return facts.map((fact) => `- ${fact.content}`);
  }

  private onDemandFactIdsForInjection(
    facts: readonly MemoryFact[],
    pinnedCount: number,
    onDemandCount: number,
  ): ReadonlySet<string> {
    return new Set(facts.slice(pinnedCount, pinnedCount + onDemandCount).map((fact) => fact.id));
  }

  private additiveBudgetInputsForInjection(
    facts: readonly MemoryFact[],
    tierBreakdown: Readonly<Record<InjectionTier, number>>,
  ): Pick<RenderMemoryLineOptions, 'factTierById' | 'tierTokenCounts'> {
    const factTierById = new Map<string, InjectionTier>();
    const tierTokenCounts: Record<InjectionTier, number> = {
      pinned: 0,
      'on-demand': 0,
      triggered: 0,
    };
    let offset = 0;

    for (const tier of this.injectionTiers()) {
      const tierFacts = facts.slice(offset, offset + tierBreakdown[tier]);
      for (const fact of tierFacts) {
        factTierById.set(fact.id, tier);
        tierTokenCounts[tier] += estimateTokens(fact.content);
      }
      offset += tierFacts.length;
    }

    return { factTierById, tierTokenCounts };
  }

  private injectionTiers(): readonly InjectionTier[] {
    return ['pinned', 'on-demand', 'triggered'];
  }

  private createAdditiveBudgetState(options: RenderMemoryLineOptions): AdditiveBudgetState {
    return {
      globalTokens: Math.max(0, this.injectionBudget.maxTokens - options.injectionTokenCount),
      tierTokens: {
        pinned: this.remainingTierAdditiveTokens('pinned', options),
        'on-demand': this.remainingTierAdditiveTokens('on-demand', options),
        triggered: this.remainingTierAdditiveTokens('triggered', options),
      },
    };
  }

  private remainingTierAdditiveTokens(
    tier: InjectionTier,
    options: RenderMemoryLineOptions,
  ): number | null {
    const tierCap = this.injectionBudget.tierTokenCaps?.[tier];
    if (tierCap === undefined) {
      return null;
    }
    return Math.max(0, tierCap - options.tierTokenCounts[tier]);
  }

  private remainingAdditiveTokensForFact(
    fact: MemoryFact,
    options: RenderMemoryLineOptions,
    additiveBudget: AdditiveBudgetState,
  ): number {
    const tier = options.factTierById.get(fact.id);
    const tierTokens = tier ? additiveBudget.tierTokens[tier] : null;
    if (tierTokens === null) {
      return additiveBudget.globalTokens;
    }
    return Math.min(additiveBudget.globalTokens, tierTokens);
  }

  private consumeAdditiveTokensForFact(
    fact: MemoryFact,
    options: RenderMemoryLineOptions,
    additiveBudget: AdditiveBudgetState,
    tokenCount: number,
  ): void {
    additiveBudget.globalTokens = Math.max(0, additiveBudget.globalTokens - tokenCount);

    const tier = options.factTierById.get(fact.id);
    if (!tier || additiveBudget.tierTokens[tier] === null) {
      return;
    }
    additiveBudget.tierTokens[tier] = Math.max(0, additiveBudget.tierTokens[tier] - tokenCount);
  }

  private async renderFactPlusSnippetLines(
    facts: readonly MemoryFact[],
    options: RenderMemoryLineOptions,
  ): Promise<string[]> {
    if (!this.memoryStore || typeof this.memoryStore.listFactSourcePreviews !== 'function') {
      return facts.map((fact) => `- ${fact.content}`);
    }

    try {
      const previewLoader = this.memoryStore.listFactSourcePreviews.bind(this.memoryStore);
      const snippetCandidates = await Promise.all(
        facts.slice(0, MAX_SNIPPET_FACTS).map(async (fact) => ({
          factId: fact.id,
          snippet: this.selectSnippetForInjection(await previewLoader(fact.id)),
        })),
      );

      const snippetsByFactId = new Map(
        snippetCandidates
          .filter(
            (candidate): candidate is { factId: string; snippet: string } =>
              candidate.snippet !== null,
          )
          .map((candidate) => [candidate.factId, candidate.snippet]),
      );

      let remainingSnippetChars = MAX_TOTAL_SNIPPET_CHARS;
      const additiveBudget = this.createAdditiveBudgetState(options);
      const lines: string[] = [];

      for (const fact of facts) {
        lines.push(`- ${fact.content}`);
        const snippet = snippetsByFactId.get(fact.id);
        const remainingSnippetTokens = this.remainingAdditiveTokensForFact(
          fact,
          options,
          additiveBudget,
        );
        if (!snippet || remainingSnippetChars <= 0 || remainingSnippetTokens <= 0) {
          continue;
        }

        const cappedSnippet = this.capSnippetForBudget(
          snippet,
          Math.min(remainingSnippetChars, remainingSnippetTokens * CHARS_PER_ESTIMATED_TOKEN),
        );
        if (!cappedSnippet) {
          continue;
        }

        lines.push(`  Evidence: ${cappedSnippet}`);
        remainingSnippetChars -= cappedSnippet.length;
        this.consumeAdditiveTokensForFact(
          fact,
          options,
          additiveBudget,
          estimateTokens(cappedSnippet),
        );
      }

      return lines;
    } catch (error: unknown) {
      this.logger.warn(
        { err: error, resultMode: this.resultMode },
        'Failed to hydrate evidence snippets for memory injection - falling back to fact-only',
      );
      return facts.map((fact) => `- ${fact.content}`);
    }
  }

  private selectSnippetForInjection(previews: readonly MemoryFactSourcePreview[]): string | null {
    const availablePreview = previews.find(
      (preview) => preview.status === 'available' && preview.quote_preview !== null,
    );
    if (!availablePreview?.quote_preview) {
      return null;
    }

    return this.normalizeSnippetPreview(availablePreview.quote_preview);
  }

  private normalizeSnippetPreview(preview: string): string | null {
    const normalized = preview.replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return null;
    }
    if (normalized.length <= MAX_SNIPPET_CHARS) {
      return normalized;
    }
    return `${normalized.slice(0, MAX_SNIPPET_CHARS - 3)}...`;
  }

  private capSnippetForBudget(snippet: string, remainingSnippetChars: number): string | null {
    const maxSnippetChars = Math.min(MAX_SNIPPET_CHARS, remainingSnippetChars);
    if (maxSnippetChars <= 0) {
      return null;
    }
    if (snippet.length <= maxSnippetChars) {
      return snippet;
    }
    if (maxSnippetChars <= 3) {
      return '.'.repeat(maxSnippetChars);
    }
    return `${snippet.slice(0, maxSnippetChars - 3)}...`;
  }

  private async renderFullDrawerLines(
    facts: readonly MemoryFact[],
    options: RenderMemoryLineOptions,
  ): Promise<string[]> {
    if (!this.loadFactSourceDrawers) {
      return facts.map((fact) => `- ${fact.content}`);
    }

    try {
      const sourceLoader = this.loadFactSourceDrawers;
      const fullDrawerFactIds = facts
        .filter((fact) => options.onDemandFactIds.has(fact.id))
        .slice(0, MAX_FULL_DRAWER_FACTS)
        .map((fact) => fact.id);
      const drawerCandidates = await Promise.all(
        fullDrawerFactIds.map(async (factId) => ({
          factId,
          drawer: this.selectFullDrawerForInjection(await sourceLoader(factId)),
        })),
      );
      const drawersByFactId = new Map(
        drawerCandidates
          .filter(
            (candidate): candidate is { factId: string; drawer: MemoryFactSourceDrawer } =>
              candidate.drawer !== null,
          )
          .map((candidate) => [candidate.factId, candidate.drawer]),
      );

      const additiveBudget = this.createAdditiveBudgetState(options);
      const lines: string[] = [];

      for (const fact of facts) {
        lines.push(`- ${fact.content}`);
        const drawer = drawersByFactId.get(fact.id);
        const remainingDrawerTokens = this.remainingAdditiveTokensForFact(
          fact,
          options,
          additiveBudget,
        );
        if (!drawer || remainingDrawerTokens <= 0) {
          continue;
        }

        const drawerContent = this.normalizeFullDrawerContent(
          drawer.drawer_content,
          remainingDrawerTokens,
        );
        if (!drawerContent) {
          continue;
        }

        lines.push(
          `  Drawer ${drawer.drawer_topic}#${drawer.drawer_chunk_index}: ${drawerContent}`,
        );
        this.consumeAdditiveTokensForFact(
          fact,
          options,
          additiveBudget,
          estimateTokens(drawerContent),
        );
      }

      return lines;
    } catch (error: unknown) {
      this.logger.warn(
        { err: error, resultMode: this.resultMode },
        'Failed to hydrate full drawer sources for memory injection - falling back to fact-only',
      );
      return facts.map((fact) => `- ${fact.content}`);
    }
  }

  private selectFullDrawerForInjection(
    drawers: readonly MemoryFactSourceDrawer[],
  ): MemoryFactSourceDrawer | null {
    return (
      drawers.find(
        (drawer) =>
          drawer.status === 'available' &&
          typeof drawer.drawer_content === 'string' &&
          drawer.drawer_content.trim().length > 0,
      ) ?? null
    );
  }

  private normalizeFullDrawerContent(
    drawerContent: string | null,
    remainingDrawerTokens: number,
  ): string | null {
    const normalized = drawerContent?.replace(/\s+/g, ' ').trim();
    if (!normalized || remainingDrawerTokens <= 0) {
      return null;
    }

    const maxDrawerChars = Math.min(
      MAX_FULL_DRAWER_CHARS,
      remainingDrawerTokens * CHARS_PER_ESTIMATED_TOKEN,
    );
    if (normalized.length <= maxDrawerChars) {
      return normalized;
    }
    if (maxDrawerChars <= 3) {
      return '.'.repeat(maxDrawerChars);
    }
    return `${normalized.slice(0, maxDrawerChars - 3)}...`;
  }

  private stringMetadata(
    metadata: Record<string, unknown> | undefined,
    key: string,
  ): string | null {
    const value = metadata?.[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }
}
