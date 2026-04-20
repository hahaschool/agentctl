// ---------------------------------------------------------------------------
// Memory — facts, scopes, decay, synthesis, maintenance, reports,
// claude-mem compatibility, consolidation, import.
// ---------------------------------------------------------------------------

import type {
  ConsolidationItem,
  ConsolidationStatus,
  EntityType,
  FactSource,
  FeedbackSignal,
  ImportJob,
  ImportPreview,
  MemoryDrawer,
  MemoryDrawerSearchRequest,
  MemoryDrawerSearchResponse,
  MemoryEdge,
  MemoryFact,
  MemoryObservation,
  MemoryReport,
  MemoryScope,
  MemoryScopeRecord,
  MemoryScopeType,
  MemoryStats,
} from '@agentctl/shared';

import { request } from './core';

/**
 * Strength distribution buckets returned by `GET /api/memory/decay/stats`.
 * Each value is a count of active (non-archived) facts in that strength range.
 */
export type MemoryDecayStrengthBucket = {
  low: number;
  mediumLow: number;
  mediumHigh: number;
  high: number;
};

export type MemoryDecayStats = {
  strengthDistribution: MemoryDecayStrengthBucket;
  pinnedCount: number;
  archivedCount: number;
};

export type MemoryDecayResult = {
  decayed: number;
  archived: number;
  skipped: number;
};

export type MemoryReportType = 'project-progress' | 'knowledge-health' | 'activity-digest';
export type MemoryReportTimeRange = 'last-7d' | 'last-30d' | 'last-90d' | 'all-time';

export type GeneratedMemoryReport = {
  id: string;
  reportType: MemoryReportType;
  scope: string | null;
  timeRange: MemoryReportTimeRange;
  markdown: string;
  generatedAt: string;
};

// ---------------------------------------------------------------------------
// Memory knowledge synthesis — §3.6
//
// POST /api/memory/synthesis returns structural candidates that a reviewer
// (human or downstream LLM step) can act on. No LLM is invoked server-side.
// ---------------------------------------------------------------------------

export type MemorySynthesisNearDuplicate = {
  factIdA: string;
  factIdB: string;
  similarity: number;
  contentA: string;
  contentB: string;
};

export type MemorySynthesisStaleFact = {
  factId: string;
  content: string;
  lastAccessedDaysAgo: number;
};

export type MemorySynthesisOrphanFact = {
  factId: string;
  content: string;
  entityType: string;
  createdAt: string;
};

export type MemorySynthesisGroup = {
  entityType: string;
  factIds: readonly string[];
  factContents: readonly string[];
  proposalHint: string;
};

export type MemorySynthesisLint = {
  nearDuplicates: readonly MemorySynthesisNearDuplicate[];
  staleFacts: readonly MemorySynthesisStaleFact[];
  orphanFacts: readonly MemorySynthesisOrphanFact[];
};

export type MemorySynthesisResult = {
  lint: MemorySynthesisLint;
  synthesisGroups: readonly MemorySynthesisGroup[];
};

// Knowledge maintenance — section 7.4
// Wire shape mirrors packages/control-plane/src/memory/knowledge-maintenance.ts

export type MemoryMaintenanceStaleEntry = {
  factId: string;
  content: string;
  referencedPaths: readonly string[];
  reason: string;
};

export type MemoryMaintenanceDeletedFileEntry = {
  factId: string;
  content: string;
  deletedFile: string;
};

export type MemoryMaintenanceSynthesisCluster = {
  seedFactId: string;
  factIds: readonly string[];
  factContents: readonly string[];
  proposedPrinciple: string;
};

export type MemoryMaintenanceCoverageGap = {
  directory: string;
  factCount: number;
};

export type MemoryMaintenanceCoverageEntry = {
  directory: string;
  factCount: number;
};

export type MemoryMaintenanceCoverageReport = {
  covered: readonly MemoryMaintenanceCoverageEntry[];
  gaps: readonly MemoryMaintenanceCoverageGap[];
  totalDirectories: number;
  coveredCount: number;
  gapCount: number;
};

export type MemoryMaintenanceSummary = {
  staleEntries: number;
  deletedFileEntries: number;
  synthesisClusters: number;
  consolidationItems: number;
  coverageReport: {
    totalDirectories: number;
    covered: number;
    gaps: number;
  };
  reportId: string | null;
};

export type MemoryMaintenanceResult = {
  staleEntries: readonly MemoryMaintenanceStaleEntry[];
  deletedFileEntries: readonly MemoryMaintenanceDeletedFileEntry[];
  synthesisClusters: readonly MemoryMaintenanceSynthesisCluster[];
  coverageReport: MemoryMaintenanceCoverageReport;
  consolidationItems: readonly ConsolidationItem[];
  report: MemoryReport | null;
};

export type MemoryMaintenanceResponse = {
  ok: boolean;
  summary: MemoryMaintenanceSummary;
  result: MemoryMaintenanceResult;
};

export const memoryApi = {
  // Unified memory foundation
  searchMemoryFacts: (params: {
    q?: string;
    scope?: MemoryScope;
    entityType?: EntityType;
    sessionId?: string;
    agentId?: string;
    machineId?: string;
    minConfidence?: number;
    limit?: number;
    offset?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.scope) qs.set('scope', params.scope);
    if (params.entityType) qs.set('entityType', params.entityType);
    if (params.sessionId) qs.set('sessionId', params.sessionId);
    if (params.agentId) qs.set('agentId', params.agentId);
    if (params.machineId) qs.set('machineId', params.machineId);
    if (params.minConfidence !== undefined) qs.set('minConfidence', String(params.minConfidence));
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    if (params.offset !== undefined) qs.set('offset', String(params.offset));
    const suffix = qs.toString();

    return request<{ ok: boolean; facts: MemoryFact[]; total: number }>(
      suffix ? `/api/memory/facts?${suffix}` : '/api/memory/facts',
    );
  },

  getMemoryFact: (id: string) =>
    request<{ ok: boolean; fact: MemoryFact; edges: MemoryEdge[] }>(
      `/api/memory/facts/${encodeURIComponent(id)}`,
    ),

  createMemoryFact: (body: {
    content: string;
    scope: MemoryScope;
    entityType: EntityType;
    confidence?: number;
    source?: FactSource;
  }) =>
    request<{ ok: boolean; fact: MemoryFact }>('/api/memory/facts', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateMemoryFact: (
    id: string,
    patch: {
      scope?: MemoryScope;
      content?: string;
      entityType?: EntityType;
      confidence?: number;
      strength?: number;
    },
  ) =>
    request<{ ok: boolean; fact: MemoryFact }>(`/api/memory/facts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  deleteMemoryFact: (id: string) =>
    request<{ ok: boolean; id: string }>(`/api/memory/facts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  submitFactFeedback: (id: string, signal: FeedbackSignal) =>
    request<{ ok: boolean; fact: MemoryFact }>(
      `/api/memory/facts/${encodeURIComponent(id)}/feedback`,
      {
        method: 'POST',
        body: JSON.stringify({ signal }),
      },
    ),

  getMemoryGraph: (params?: { scope?: MemoryScope; entityType?: EntityType; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.scope) qs.set('scope', params.scope);
    if (params?.entityType) qs.set('entityType', params.entityType);
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    const suffix = qs.toString();

    return request<{ ok: boolean; nodes: MemoryFact[]; edges: MemoryEdge[] }>(
      suffix ? `/api/memory/graph?${suffix}` : '/api/memory/graph',
    );
  },

  getMemoryStats: () => request<{ ok: boolean; stats: MemoryStats }>('/api/memory/stats'),

  // Memory decay (Ebbinghaus-curve archival of stale facts)
  getMemoryDecayStats: () =>
    request<{ ok: boolean; stats: MemoryDecayStats }>('/api/memory/decay/stats'),

  runMemoryDecay: () =>
    request<{ ok: boolean; result: MemoryDecayResult }>('/api/memory/decay/run', {
      method: 'POST',
    }),

  // Memory scope management
  listMemoryScopes: () =>
    request<{ ok: boolean; scopes: MemoryScopeRecord[] }>('/api/memory/scopes'),

  createMemoryScope: (body: { name: string; type: MemoryScopeType }) =>
    request<{ ok: boolean; scope: MemoryScopeRecord }>('/api/memory/scopes', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  renameMemoryScope: (id: string, name: string) =>
    request<{ ok: boolean; scope: MemoryScopeRecord }>(
      `/api/memory/scopes/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify({ name }) },
    ),

  deleteMemoryScope: (id: string, cascade?: boolean) =>
    request<{ ok: boolean; id: string; deleted: number }>(
      `/api/memory/scopes/${encodeURIComponent(id)}${cascade ? '?cascade=true' : ''}`,
      { method: 'DELETE' },
    ),

  promoteScopeFacts: (id: string) =>
    request<{ ok: boolean; promoted: number; fromScope: string; toScope: string }>(
      `/api/memory/scopes/${encodeURIComponent(id)}/promote`,
      { method: 'POST' },
    ),

  mergeScopes: (sourceId: string, targetId: string) =>
    request<{ ok: boolean; merged: number; fromScope: string; toScope: string }>(
      `/api/memory/scopes/${encodeURIComponent(sourceId)}/merge`,
      { method: 'POST', body: JSON.stringify({ targetId }) },
    ),

  // Claude-mem compatibility
  searchMemory: (params: { q: string; project?: string; type?: string; limit?: number }) => {
    const qs = new URLSearchParams({ q: params.q });
    if (params.project) qs.set('project', params.project);
    if (params.type) qs.set('type', params.type);
    if (params.limit) qs.set('limit', String(params.limit));
    return request<{ observations: MemoryObservation[] }>(
      `/api/claude-mem/search?${qs.toString()}`,
    );
  },

  getMemoryObservation: (id: number) =>
    request<{ observation: MemoryObservation }>(`/api/claude-mem/observations/${id}`),

  getMemoryTimeline: (sessionId: string, limit?: number) => {
    const qs = new URLSearchParams({ sessionId });
    if (limit) qs.set('limit', String(limit));
    return request<{ observations: MemoryObservation[] }>(
      `/api/claude-mem/timeline?${qs.toString()}`,
    );
  },

  generateMemoryReport: (body: {
    reportType: MemoryReportType;
    scope?: string;
    timeRange?: MemoryReportTimeRange;
  }) =>
    request<{ ok: boolean; report: GeneratedMemoryReport }>('/api/memory/reports/generate', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  listMemoryReports: (params?: {
    reportType?: MemoryReportType;
    scope?: string;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.reportType) qs.set('reportType', params.reportType);
    if (params?.scope) qs.set('scope', params.scope);
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<{ ok: boolean; reports: GeneratedMemoryReport[]; total: number }>(
      `/api/memory/reports${suffix}`,
    );
  },

  runMemorySynthesis: (body?: { scope?: string }) =>
    request<{ ok: boolean; result: MemorySynthesisResult }>('/api/memory/synthesis', {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),

  runMemoryMaintenance: (body?: { scope?: string }) =>
    request<MemoryMaintenanceResponse>('/api/memory/maintenance', {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),

  getConsolidationItems: (params?: { type?: string; status?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.type) qs.set('type', params.type);
    if (params?.status) qs.set('status', params.status);
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<{ ok: boolean; items: ConsolidationItem[]; total: number }>(
      `/api/memory/consolidation${suffix}`,
    );
  },

  resolveConsolidationItem: (
    id: string,
    body: {
      action: string;
      status: ConsolidationStatus;
    },
  ) =>
    request<{ ok: boolean }>(`/api/memory/consolidation/${id}/action`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Memory import
  previewImport: (body: { source: ImportJob['source']; dbPath: string }) =>
    request<{ ok: boolean; preview: ImportPreview; error?: string }>('/api/memory/import/preview', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  startMemoryImport: (body: { source: ImportJob['source']; dbPath: string }) =>
    request<{ ok: boolean; job: ImportJob }>('/api/memory/import', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getImportStatus: () => request<{ ok: boolean; job: ImportJob }>('/api/memory/import/status'),

  cancelImport: (id: string) =>
    request<{ ok: boolean; job: ImportJob }>(`/api/memory/import/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
};

// ---------------------------------------------------------------------------
// MemPalace drawer layer — §4.16 Memory Evolution Plan, PR F.
//
// Thin wrapper around `GET /api/memory/drawers/search` and `/:drawerId` so the
// web UI can render sanitized verbatim snippets with evidence links. Request
// and response shapes come from `@agentctl/shared` — do not redefine them.
// ---------------------------------------------------------------------------

export const memoryDrawersApi = {
  search: (params: MemoryDrawerSearchRequest) => {
    const qs = new URLSearchParams({ q: params.query });
    if (params.scope) qs.set('scope', params.scope);
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    return request<MemoryDrawerSearchResponse>(`/api/memory/drawers/search?${qs.toString()}`);
  },

  get: (drawerId: string) =>
    request<{ ok: true; drawer: MemoryDrawer }>(
      `/api/memory/drawers/${encodeURIComponent(drawerId)}`,
    ),
};
