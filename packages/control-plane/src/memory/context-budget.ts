import type {
  InjectionBudget,
  InjectionResult,
  InjectionTier,
  MemoryFact,
  MemorySearchResult,
  TriggerContext,
  TriggerSpec,
} from '@agentctl/shared';
import { DEFAULT_INJECTION_BUDGET } from '@agentctl/shared';

const CHARS_PER_TOKEN = 4;

/**
 * Estimate token count for a piece of text using a simple character-based
 * heuristic. Good enough for MVP budget enforcement (4 chars ~ 1 token).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Check whether a fact's trigger spec matches the current trigger context.
 *
 * A trigger spec matches when ALL of its defined fields match at least one
 * value in the trigger context. Fields that are undefined in the spec are
 * treated as wildcards (always match).
 */
export function matchesTrigger(spec: TriggerSpec, context: TriggerContext): boolean {
  if (spec.tool !== undefined) {
    if (context.tool !== spec.tool) {
      return false;
    }
  }

  if (spec.file_pattern !== undefined) {
    if (!context.filePath) {
      return false;
    }
    try {
      const pattern = new RegExp(spec.file_pattern);
      if (!pattern.test(context.filePath)) {
        return false;
      }
    } catch {
      // If the pattern is invalid regex, treat it as a literal substring match
      if (!context.filePath.includes(spec.file_pattern)) {
        return false;
      }
    }
  }

  if (spec.keyword !== undefined) {
    const keywords = context.keywords ?? [];
    const lowerKeyword = spec.keyword.toLowerCase();
    const found = keywords.some((kw) => kw.toLowerCase().includes(lowerKeyword));
    if (!found) {
      return false;
    }
  }

  return true;
}

type BudgetState = {
  readonly facts: MemoryFact[];
  readonly tokenCount: number;
  readonly tierCounts: Record<InjectionTier, number>;
};

function createEmptyState(): BudgetState {
  return {
    facts: [],
    tokenCount: 0,
    tierCounts: { pinned: 0, 'on-demand': 0, triggered: 0 },
  };
}

function tryAddFact(
  state: BudgetState,
  fact: MemoryFact,
  tier: InjectionTier,
  budget: InjectionBudget,
): BudgetState {
  if (state.facts.length >= budget.maxFacts) {
    return state;
  }

  const factTokens = estimateTokens(fact.content);
  if (state.tokenCount + factTokens > budget.maxTokens) {
    return state;
  }

  // Avoid duplicates — a fact may appear in multiple tiers
  if (state.facts.some((existing) => existing.id === fact.id)) {
    return state;
  }

  return {
    facts: [...state.facts, fact],
    tokenCount: state.tokenCount + factTokens,
    tierCounts: {
      ...state.tierCounts,
      [tier]: state.tierCounts[tier] + 1,
    },
  };
}

/**
 * Collect Tier 1 (pinned) facts: always-injected facts with `pinned: true`,
 * capped by `budget.pinnedCap`.
 */
function collectPinnedFacts(
  allFacts: readonly MemoryFact[],
  state: BudgetState,
  budget: InjectionBudget,
): BudgetState {
  const pinnedFacts = allFacts.filter((fact) => fact.pinned === true).slice(0, budget.pinnedCap);

  let current = state;
  for (const fact of pinnedFacts) {
    current = tryAddFact(current, fact, 'pinned', budget);
  }
  return current;
}

/**
 * Collect Tier 2 (on-demand) facts: ranked search results that fill the
 * remaining budget after pinned facts.
 */
function collectOnDemandFacts(
  searchResults: readonly MemorySearchResult[],
  state: BudgetState,
  budget: InjectionBudget,
): BudgetState {
  let current = state;
  for (const result of searchResults) {
    current = tryAddFact(current, result.fact, 'on-demand', budget);
    if (current.facts.length >= budget.maxFacts || current.tokenCount >= budget.maxTokens) {
      break;
    }
  }
  return current;
}

/**
 * Collect Tier 3 (triggered) facts: facts whose `trigger_spec` matches the
 * current trigger context.
 */
function collectTriggeredFacts(
  allFacts: readonly MemoryFact[],
  triggerContext: TriggerContext,
  state: BudgetState,
  budget: InjectionBudget,
): BudgetState {
  const triggered = allFacts.filter(
    (fact) => fact.trigger_spec !== undefined && matchesTrigger(fact.trigger_spec, triggerContext),
  );

  let current = state;
  for (const fact of triggered) {
    current = tryAddFact(current, fact, 'triggered', budget);
    if (current.facts.length >= budget.maxFacts || current.tokenCount >= budget.maxTokens) {
      break;
    }
  }
  return current;
}

export type BuildContextBudgetInput = {
  /** All available facts (e.g. from a scope-filtered query). Used for pinned + triggered tiers. */
  allFacts: readonly MemoryFact[];
  /** Relevance-ranked search results from MemorySearch. Used for the on-demand tier. */
  searchResults: readonly MemorySearchResult[];
  /** Current trigger context for matching triggered facts. */
  triggerContext?: TriggerContext;
  /** Budget configuration. Defaults to DEFAULT_INJECTION_BUDGET. */
  budget?: InjectionBudget;
};

/**
 * Build a context-budgeted set of memory facts using a 3-tier injection strategy:
 *
 * 1. **Pinned** (Tier 1): Always-injected facts marked with `pinned: true`.
 *    No decay, capped per scope by `budget.pinnedCap`.
 *
 * 2. **On-demand** (Tier 2): Facts ranked by relevance score from MemorySearch.
 *    Fills remaining budget after pinned facts.
 *
 * 3. **Triggered** (Tier 3): Facts with a `trigger_spec` that matches the current
 *    context (tool, file pattern, keyword). Only injected when the trigger fires.
 *
 * Budget enforcement: stops when either `maxTokens` or `maxFacts` is exceeded.
 * Token estimation uses a rough heuristic of 4 characters per token.
 */
export function buildContextBudget(input: BuildContextBudgetInput): InjectionResult {
  const budget = input.budget ?? DEFAULT_INJECTION_BUDGET;
  const triggerContext = input.triggerContext ?? {};
  const activeTiers = new Set(budget.tiers);

  let state = createEmptyState();

  // Tier 1: Pinned facts
  if (activeTiers.has('pinned')) {
    state = collectPinnedFacts(input.allFacts, state, budget);
  }

  // Tier 2: On-demand (relevance-ranked search results)
  if (activeTiers.has('on-demand')) {
    state = collectOnDemandFacts(input.searchResults, state, budget);
  }

  // Tier 3: Triggered facts
  if (activeTiers.has('triggered')) {
    state = collectTriggeredFacts(input.allFacts, triggerContext, state, budget);
  }

  return {
    facts: state.facts,
    tokenCount: state.tokenCount,
    tierBreakdown: { ...state.tierCounts },
  };
}
