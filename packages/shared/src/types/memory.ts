export type MemoryObservation = {
  id: number;
  type: string;
  title: string;
  subtitle?: string;
  facts?: string;
  narrative?: string;
  files_modified?: string;
  created_at: string;
};

export type MemoryScope =
  | 'global'
  | `project:${string}`
  | `agent:${string}`
  | `session:${string}`;

export type EntityType =
  | 'code_artifact'
  | 'decision'
  | 'pattern'
  | 'error'
  | 'person'
  | 'concept'
  | 'preference';

export type RelationType =
  | 'modifies'
  | 'depends_on'
  | 'caused_by'
  | 'resolves'
  | 'supersedes'
  | 'related_to'
  | 'summarizes';

export type FactSource = {
  session_id: string | null;
  agent_id: string | null;
  machine_id: string | null;
  turn_index: number | null;
  extraction_method: 'llm' | 'rule' | 'manual' | 'import';
};

export type MemoryFact = {
  id: string;
  scope: MemoryScope;
  content: string;
  content_model: string;
  entity_type: EntityType;
  confidence: number;
  strength: number;
  source: FactSource;
  valid_from: string;
  valid_until: string | null;
  created_at: string;
  accessed_at: string;
};

export type MemoryEdge = {
  id: string;
  source_fact_id: string;
  target_fact_id: string;
  relation: RelationType;
  weight: number;
  created_at: string;
};

export type MemorySearchResult = {
  fact: MemoryFact;
  score: number;
  source_path: 'vector' | 'bm25' | 'graph';
};

export type InjectionBudget = {
  maxTokens: number;
  maxFacts: number;
  priorityWeights: {
    relevance: number;
    recency: number;
    strength: number;
    scopeProximity: number;
  };
};

export const DEFAULT_INJECTION_BUDGET: InjectionBudget = {
  maxTokens: 2000,
  maxFacts: 15,
  priorityWeights: {
    relevance: 0.5,
    recency: 0.2,
    strength: 0.2,
    scopeProximity: 0.1,
  },
};
