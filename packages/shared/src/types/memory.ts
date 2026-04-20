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

export type MemoryScope = 'global' | `project:${string}` | `agent:${string}` | `session:${string}`;

export type MemoryDrawerSourceType =
  | 'session-jsonl'
  | 'runtime-checkpoint'
  | 'claude-mem-observation'
  | 'claude-mem-session-summary'
  | 'manual'
  | 'document'
  | 'diary';

export type MemoryDrawerSyncVisibility = 'local' | 'project' | 'global';

export type MemoryDrawerRedactionStatus = 'unreviewed' | 'sanitized' | 'quarantined' | 'approved';

export type MemoryDrawer = {
  id: string;
  scope: MemoryScope;
  topic: string;
  sourceType: MemoryDrawerSourceType;
  sourceId: string;
  sourceUri: string | null;
  chunkIndex: number;
  content: string;
  contentSha256: string;
  embeddingModel: string;
  embeddingVersion: number;
  tokenCount: number;
  sourceJson: Record<string, unknown>;
  syncVisibility: MemoryDrawerSyncVisibility;
  retentionExpiresAt: string | null;
  archivedAt: string | null;
  redactionStatus: MemoryDrawerRedactionStatus;
  createdAt: string;
  updatedAt: string;
};

export const MEMORY_ENTITY_TYPES = [
  'code_artifact',
  'decision',
  'pattern',
  'error',
  'person',
  'concept',
  'preference',
  'skill',
  'experience',
  'principle',
  'question',
] as const;

export type EntityType = (typeof MEMORY_ENTITY_TYPES)[number];

export type RelationType =
  | 'modifies'
  | 'depends_on'
  | 'caused_by'
  | 'resolves'
  | 'supersedes'
  | 'related_to'
  | 'summarizes'
  | 'derived_from'
  | 'validates'
  | 'contradicts';

export type FactSource = {
  session_id: string | null;
  agent_id: string | null;
  machine_id: string | null;
  turn_index: number | null;
  extraction_method: 'llm' | 'rule' | 'manual' | 'import';
  import_source_id?: string | null;
};

export type TriggerSpec = {
  tool?: string;
  file_pattern?: string;
  keyword?: string;
};

export type FeedbackSignal = 'used' | 'irrelevant' | 'outdated';

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
  tags?: string[];
  usage_count?: number;
  pinned?: boolean;
  trigger_spec?: TriggerSpec;
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

export type MemoryDedupRecommendation = 'skip' | 'merge' | 'store_new';

export type MemoryDedupNearestMatch = {
  id: string;
  score: number | null;
  content_preview: string;
  source_path: string | null;
};

export type MemoryDedupCheckRequest = {
  scope: MemoryScope;
  entity_type?: EntityType;
  content_preview: string;
  embedding_precomputed?: readonly number[];
};

export type MemoryDedupCheckResponse = {
  ok: true;
  is_duplicate: boolean;
  nearest_matches: MemoryDedupNearestMatch[];
  recommendation: MemoryDedupRecommendation;
  rationale: string;
};

export type InjectionTier = 'pinned' | 'on-demand' | 'triggered';

export type InjectionBudget = {
  maxTokens: number;
  maxFacts: number;
  priorityWeights: {
    relevance: number;
    recency: number;
    strength: number;
    scopeProximity: number;
  };
  tiers: readonly InjectionTier[];
  pinnedCap: number;
};

export const DEFAULT_INJECTION_BUDGET: InjectionBudget = {
  maxTokens: 2400,
  maxFacts: 20,
  priorityWeights: {
    relevance: 0.5,
    recency: 0.2,
    strength: 0.2,
    scopeProximity: 0.1,
  },
  tiers: ['pinned', 'on-demand', 'triggered'] as const,
  pinnedCap: 5,
};

export type TriggerContext = {
  tool?: string;
  filePath?: string;
  keywords?: readonly string[];
};

export type InjectionResult = {
  facts: readonly MemoryFact[];
  tokenCount: number;
  tierBreakdown: Readonly<Record<InjectionTier, number>>;
};

export type ConsolidationItemType = 'contradiction' | 'near-duplicate' | 'stale' | 'orphan';

export type ConsolidationSeverity = 'high' | 'medium' | 'low';

export type ConsolidationStatus = 'pending' | 'accepted' | 'skipped';

export type ConsolidationItem = {
  id: string;
  type: ConsolidationItemType;
  severity: ConsolidationSeverity;
  factIds: string[];
  suggestion: string;
  reason: string;
  status: ConsolidationStatus;
  createdAt: string;
};

export type MemoryReportType = 'project-progress' | 'knowledge-health' | 'activity-digest';

export type MemoryReport = {
  id: string;
  type: MemoryReportType;
  scope: string;
  periodStart: string;
  periodEnd: string;
  content: string;
  metadata: {
    factCount: number;
    newFacts: number;
    topEntities: string[];
  };
  generatedAt: string;
};

export type MemoryScopeType = 'global' | 'project' | 'agent' | 'session';

export type MemoryScopeRecord = {
  id: string;
  name: string;
  type: MemoryScopeType;
  parentId: string | null;
  factCount: number;
  createdAt: string;
};

export type ImportJobSource = 'claude-mem' | 'jsonl-history';

export type ImportJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type ImportJob = {
  id: string;
  source: ImportJobSource;
  status: ImportJobStatus;
  progress: {
    current: number;
    total: number;
  };
  imported: number;
  skipped: number;
  errors: number;
  startedAt: string;
  completedAt: string | null;
};

export type ImportPreview = {
  totalObservations: number;
  byType: Record<string, number>;
  alreadyImported: number;
  newToImport: number;
  sampleTitles: string[];
};

export type MemoryStats = {
  totalFacts: number;
  newThisWeek: number;
  avgConfidence: number;
  pendingConsolidation: number;
  byScope: Record<string, number>;
  byEntityType: Record<string, number>;
  strengthDistribution: {
    active: number;
    decaying: number;
    archived: number;
  };
  growthTrend: ReadonlyArray<{
    date: string;
    count: number;
  }>;
};
