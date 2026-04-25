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

export type MemoryDrawerBackfillSourceType = 'session-jsonl' | 'claude-mem';

export type MemoryDrawerBackfillStatus = 'running' | 'paused' | 'complete' | 'failed';

export type MemoryDrawerBackfillState = {
  id: string;
  sourceType: MemoryDrawerBackfillSourceType;
  sourceRoot: string;
  cursorJson: Record<string, unknown>;
  status: MemoryDrawerBackfillStatus;
  lastError: string | null;
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

export const MEMORY_RELATION_TYPES = [
  'modifies',
  'depends_on',
  'caused_by',
  'resolves',
  'supersedes',
  'related_to',
  'summarizes',
  'derived_from',
  'validates',
  'contradicts',
] as const;

export type RelationType = (typeof MEMORY_RELATION_TYPES)[number];

export type FactSource = {
  session_id: string | null;
  agent_id: string | null;
  machine_id: string | null;
  turn_index: number | null;
  extraction_method: 'llm' | 'rule' | 'manual' | 'import';
  import_source_id?: string | null;
  import_job_id?: string | null;
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

export type MemoryFactSourcePreviewStatus = 'available' | 'archived';

export type MemoryFactSourcePreview = {
  drawer_id: string;
  drawer_scope: MemoryScope;
  drawer_topic: string;
  drawer_chunk_index: number;
  drawer_source_type: MemoryDrawerSourceType;
  drawer_source_id: string;
  start_offset: number;
  end_offset: number;
  quote_preview: string | null;
  status: MemoryFactSourcePreviewStatus;
  created_at: string;
};

export type MemoryEdge = {
  id: string;
  source_fact_id: string;
  target_fact_id: string;
  relation: RelationType;
  weight: number;
  created_at: string;
};

export type MemoryTraverseRequest = {
  start_entity_canonical_id: string;
  max_hops?: number;
  relation_types?: readonly RelationType[];
  min_confidence?: number;
  as_of?: string;
};

export type MemoryTraverseNode = {
  canonical_id: string;
  entity_name: string | null;
  hop_distance: number;
  earliest_seen: string | null;
};

export type MemoryTraverseEdge = {
  subject_id: string;
  object_id: string;
  relation: string;
  confidence: number | null;
  valid_from: string | null;
  valid_until: string | null;
};

export type MemoryTraverseResponse = {
  ok: true;
  start_entity_canonical_id: string;
  max_hops: number;
  node_cap: number;
  nodes: MemoryTraverseNode[];
  edges: MemoryTraverseEdge[];
  partial: boolean;
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
  match_id: string | null;
};

// ---------------------------------------------------------------------------
// MCP: memory_drawer_search
//
// First-slice contract: lock request schema and empty-DB behaviour. Actual
// drawer index lookup is deferred to a later control-plane PR; see Phase 4
// Step 6 of docs/plans/2026-04-15-mempalace-inspired-memory-evolution-plan.md.
// ---------------------------------------------------------------------------

export type MemoryDrawerSearchRequest = {
  query: string;
  scope?: string;
  limit?: number;
};

export type MemoryDrawerSearchResultMatchType = 'vector' | 'keyword' | 'grep';

export type MemoryDrawerSearchResult = {
  id: string;
  scope: string;
  topic: string;
  source_type: MemoryDrawerSourceType;
  source_id: string;
  chunk_index: number;
  content_preview: string;
  score: number | null;
  match_type: MemoryDrawerSearchResultMatchType | null;
};

export type MemoryDrawerSearchResponse = {
  ok: true;
  results: MemoryDrawerSearchResult[];
};

// ---------------------------------------------------------------------------
// MCP: memory_drawer_get
//
// First-slice contract: lock request schema, missing-drawer contract, and
// drawer_id validation. Control-plane drawer fetch endpoint lands later.
// ---------------------------------------------------------------------------

export type MemoryDrawerGetRequest = {
  drawer_id: string;
};

export type MemoryDrawerGetResponse = {
  ok: true;
  drawer: MemoryDrawer;
};

export type InjectionTier = 'pinned' | 'on-demand' | 'triggered';

export const MEMORY_INJECTION_RESULT_MODES = [
  'fact-only',
  'fact-plus-snippet',
  'full-drawer',
] as const;

export type MemoryInjectionResultMode = (typeof MEMORY_INJECTION_RESULT_MODES)[number];

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
  /**
   * Optional per-tier token ceilings. When set, a tier's total injected-fact
   * tokens cannot exceed its entry. Absent entries mean no per-tier limit for
   * that tier. The global `maxTokens` always applies on top.
   */
  tierTokenCaps?: Partial<Record<InjectionTier, number>>;
  resultMode: MemoryInjectionResultMode;
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
  resultMode: 'fact-only',
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

export type ImportJobStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'rolled_back';

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
  rolledBack?: number;
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
