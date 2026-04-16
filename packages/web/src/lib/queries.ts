import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';

import type {
  AgentConfig,
  EventSenderType,
  EventVisibility,
  MemoryReportTimeRange,
  MemoryReportType,
  NotificationChannel,
  NotificationPriority,
  SecurityFindingSeverity,
  SpaceEventType,
  SpaceMemberRole,
  SpaceMemberType,
  SpaceType,
  SpaceVisibility,
  ThreadType,
} from './api';
import { api } from './api';
import { STORAGE_KEYS } from './storage-keys';

type RuntimeSessionsQueryParams = Parameters<typeof api.listRuntimeSessions>[0];
type MemoryFactsQueryParams = Parameters<typeof api.searchMemoryFacts>[0];
type MemoryGraphQueryParams = Parameters<typeof api.getMemoryGraph>[0];
type SecurityFindingsQueryParams = Parameters<typeof api.listSecurityFindings>[0];

export type TaskGraphSummary = {
  id: string;
  name: string;
  status: 'empty' | 'ready' | 'invalid';
  taskCount: number;
  createdAt: string;
};

// ---------------------------------------------------------------------------
// Helpers — read user preferences from localStorage
// ---------------------------------------------------------------------------

function getRefetchInterval(): number | false {
  if (typeof window === 'undefined') return 10_000;
  const raw = localStorage.getItem(STORAGE_KEYS.AUTO_REFRESH_INTERVAL);
  const ms = raw ? Number(raw) : 10_000;
  return ms > 0 ? ms : false;
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const queryKeys = {
  health: ['health'] as const,
  versionCompat: ['version-compat'] as const,
  machines: ['machines'] as const,
  workerNodes: ['worker-nodes'] as const,
  agents: ['agents'] as const,
  taskGraphs: ['task-graphs'] as const,
  taskGraph: (id: string) => ['task-graphs', id] as const,
  taskRuns: ['task-runs'] as const,
  agent: (id: string) => ['agents', id] as const,
  agentRuns: (agentId: string) => ['agents', agentId, 'runs'] as const,
  agentHealth: (agentId: string) => ['agents', agentId, 'health'] as const,
  approvals: (threadId: string) => ['approvals', threadId] as const,
  approvalGate: (id: string) => ['approvals', 'gate', id] as const,
  approvalDecisions: (id: string) => ['approvals', 'gate', id, 'decisions'] as const,
  runSummary: (runId: string) => ['runs', runId, 'summary'] as const,
  sessions: (params?: {
    status?: string;
    machineId?: string;
    agentId?: string;
    offset?: number;
    limit?: number;
  }) => (params ? (['sessions', params] as const) : (['sessions'] as const)),
  session: (id: string) => ['sessions', id] as const,
  sessionDispatchConfig: (id: string) => ['sessions', id, 'dispatch-config'] as const,
  runtimeSessions: (params?: RuntimeSessionsQueryParams) =>
    params ? (['runtime-sessions', params] as const) : (['runtime-sessions'] as const),
  runtimeHandoffSummary: (limit?: number) =>
    limit !== undefined
      ? (['runtime-sessions', 'handoffs', 'summary', limit] as const)
      : (['runtime-sessions', 'handoffs', 'summary'] as const),
  runtimeSessionHandoffs: (id: string, limit?: number) =>
    limit !== undefined
      ? (['runtime-sessions', id, 'handoffs', limit] as const)
      : (['runtime-sessions', id, 'handoffs'] as const),
  runtimeSessionManualTakeover: (id: string) =>
    ['runtime-sessions', id, 'manual-takeover'] as const,
  runtimeSessionTerminalTakeover: (id: string) =>
    ['runtime-sessions', id, 'terminal-takeover'] as const,
  runtimeSessionPreflight: (id: string, targetRuntime: string, targetMachineId?: string) =>
    targetMachineId
      ? (['runtime-sessions', id, 'preflight', targetRuntime, targetMachineId] as const)
      : (['runtime-sessions', id, 'preflight', targetRuntime] as const),
  sessionContent: (
    sessionId: string,
    params: { machineId: string; projectPath?: string; limit?: number },
  ) => ['session-content', sessionId, params] as const,
  permissionRequests: (status?: string, agentId?: string) =>
    ['permission-requests', status ?? 'all', agentId ?? 'all'] as const,
  discover: ['discovered-sessions'] as const,
  metrics: ['metrics'] as const,
  accounts: ['accounts'] as const,
  accountDefaults: ['account-defaults'] as const,
  meshAutoUpdate: ['mesh-auto-update'] as const,
  runtimeConfigDefaults: ['runtime-config', 'defaults'] as const,
  runtimeConfigDrift: (machineId?: string) =>
    machineId
      ? (['runtime-config', 'drift', machineId] as const)
      : (['runtime-config', 'drift'] as const),
  projectAccounts: ['project-accounts'] as const,
  routerModels: ['router', 'models'] as const,
  routerModelsInfo: ['router', 'models-info'] as const,
  audit: (params?: {
    agentId?: string;
    tool?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }) => (params ? (['audit', params] as const) : (['audit'] as const)),
  auditSummary: (params?: { agentId?: string; from?: string; to?: string }) =>
    params ? (['audit-summary', params] as const) : (['audit-summary'] as const),
  securityFindings: (params?: SecurityFindingsQueryParams) =>
    params ? (['security-findings', params] as const) : (['security-findings'] as const),
  securityFindingsSummary: ['security-findings', 'summary'] as const,
  gitStatus: (machineId: string, path: string) => ['git-status', machineId, path] as const,
  mcpDiscover: (machineId: string, runtime: string, projectPath?: string) =>
    projectPath
      ? (['mcp', 'discover', machineId, runtime, projectPath] as const)
      : (['mcp', 'discover', machineId, runtime] as const),
  mcpTemplates: ['mcp', 'templates'] as const,
  skillDiscover: (machineId: string, runtime: string, projectPath?: string) =>
    projectPath
      ? (['skills', 'discover', machineId, runtime, projectPath] as const)
      : (['skills', 'discover', machineId, runtime] as const),
  agentConfigPreview: (agentId: string) => ['agents', agentId, 'config-preview'] as const,
  spaces: {
    all: ['spaces'] as const,
    detail: (id: string) => ['spaces', id] as const,
    threads: (spaceId: string) => ['spaces', spaceId, 'threads'] as const,
    contextRefs: (spaceId: string) => ['spaces', spaceId, 'context-refs'] as const,
    subscriptions: (spaceId: string) => ['spaces', spaceId, 'subscriptions'] as const,
    events: (spaceId: string, threadId: string) =>
      ['spaces', spaceId, 'threads', threadId, 'events'] as const,
  },
  deploymentTiers: ['deployment-tiers'] as const,
  promotionHistory: ['promotion-history'] as const,
  notificationPreferences: (userId: string) => ['notification-preferences', userId] as const,
  pushDevices: (userId: string) => ['push-devices', userId] as const,
  syncConflicts: (params?: { status?: string; table?: string; remoteNodeId?: string }) =>
    params ? (['sync-conflicts', params] as const) : (['sync-conflicts'] as const),
  syncConflict: (id: string) => ['sync-conflicts', id] as const,
  syncConflictCount: ['sync-conflict-count'] as const,
  syncPeers: ['sync-peers'] as const,
  syncPeerCursors: (machineId: string) => ['sync-peer-cursors', machineId] as const,
  webhooks: ['webhooks'] as const,
  webhookDeliveries: (id: string) => ['webhook-deliveries', id] as const,
  memory: {
    search: (q: string, opts?: { project?: string; type?: string }) =>
      ['memory', 'search', q, opts] as const,
    facts: (params?: MemoryFactsQueryParams) =>
      params ? (['memory', 'facts', params] as const) : (['memory', 'facts'] as const),
    fact: (id: string) => ['memory', 'fact', id] as const,
    graph: (params?: MemoryGraphQueryParams) =>
      params ? (['memory', 'graph', params] as const) : (['memory', 'graph'] as const),
    stats: ['memory', 'stats'] as const,
    decayStats: ['memory', 'decay', 'stats'] as const,
    timeline: (sessionId: string) => ['memory', 'timeline', sessionId] as const,
    observation: (id: number) => ['memory', 'observation', id] as const,
    reports: (params?: { reportType?: MemoryReportType; scope?: string; limit?: number }) =>
      params ? (['memory', 'reports', params] as const) : (['memory', 'reports'] as const),
    consolidation: (params?: { type?: string; status?: string; limit?: number }) =>
      params
        ? (['memory', 'consolidation', params] as const)
        : (['memory', 'consolidation'] as const),
    scopes: ['memory', 'scopes'] as const,
    importStatus: ['memory', 'import', 'status'] as const,
  },
};

// ---------------------------------------------------------------------------
// Query options — use with useQuery(healthQuery()) or useSuspenseQuery
// ---------------------------------------------------------------------------

export function healthQuery() {
  return queryOptions({
    queryKey: queryKeys.health,
    queryFn: api.health,
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

/**
 * Roadmap §33.11 — low-churn compatibility surface. Kept deliberately quiet
 * (60s staleTime, no refocus refetch) so it doesn't flood the control plane
 * while the banner only needs a pre-login bootstrap value.
 */
export function versionCompatQuery() {
  return queryOptions({
    queryKey: queryKeys.versionCompat,
    queryFn: api.versionCompat,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function machinesQuery() {
  return queryOptions({
    queryKey: queryKeys.machines,
    queryFn: api.listMachines,
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

export function workerNodesQuery() {
  return queryOptions({
    queryKey: queryKeys.workerNodes,
    queryFn: api.listWorkerNodes,
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

export function taskGraphsQuery() {
  return queryOptions({
    queryKey: queryKeys.taskGraphs,
    queryFn: async (): Promise<TaskGraphSummary[]> => {
      const graphs = await api.listTaskGraphs();
      const summaries = await Promise.all(
        graphs.map(async (graph) => {
          const [detail, validation] = await Promise.all([
            api.getTaskGraph(graph.id),
            api
              .validateTaskGraph(graph.id)
              .catch<import('./api').TaskGraphValidation | null>(() => null),
          ]);

          const taskCount = detail.definitions.length;
          const status: TaskGraphSummary['status'] =
            taskCount === 0 ? 'empty' : validation && !validation.valid ? 'invalid' : 'ready';

          return {
            id: graph.id,
            name: graph.name,
            status,
            taskCount,
            createdAt: graph.createdAt,
          };
        }),
      );

      return summaries.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    },
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

export function taskGraphQuery(id: string) {
  return queryOptions({
    queryKey: queryKeys.taskGraph(id),
    queryFn: () => api.getTaskGraph(id),
    enabled: !!id,
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

export function taskRunsQuery() {
  return queryOptions({
    queryKey: queryKeys.taskRuns,
    queryFn: api.listTaskRuns,
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

export function agentsQuery() {
  return queryOptions({
    queryKey: queryKeys.agents,
    queryFn: api.listAgents,
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

export function agentQuery(id: string) {
  return queryOptions({
    queryKey: queryKeys.agent(id),
    queryFn: () => api.getAgent(id),
    enabled: !!id,
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

export function agentRunsQuery(agentId: string) {
  return queryOptions({
    queryKey: queryKeys.agentRuns(agentId),
    queryFn: () => api.getAgentRuns(agentId),
    enabled: !!agentId,
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

export function agentHealthQuery(agentId: string) {
  return queryOptions({
    queryKey: queryKeys.agentHealth(agentId),
    queryFn: () => api.getAgentHealth(agentId),
    enabled: !!agentId,
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
}

export function sessionsQuery(params?: {
  status?: string;
  machineId?: string;
  agentId?: string;
  offset?: number;
  limit?: number;
}) {
  return queryOptions({
    queryKey: queryKeys.sessions(params),
    queryFn: () => api.listSessions(params),
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

export function sessionQuery(id: string) {
  return queryOptions({
    queryKey: queryKeys.session(id),
    queryFn: () => api.getSession(id),
    enabled: !!id,
    refetchInterval: 5_000, // Poll session status to detect worker restarts / status changes
    refetchOnWindowFocus: true,
  });
}

export function sessionDispatchConfigQuery(sessionId: string) {
  return queryOptions({
    queryKey: queryKeys.sessionDispatchConfig(sessionId),
    queryFn: () => api.getSessionDispatchConfig(sessionId),
    enabled: !!sessionId,
    staleTime: 60_000, // Config doesn't change after dispatch
  });
}

export function runtimeSessionsQuery(params?: RuntimeSessionsQueryParams) {
  return queryOptions({
    queryKey: queryKeys.runtimeSessions(params),
    queryFn: () => api.listRuntimeSessions(params),
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

export function runtimeHandoffSummaryQuery(limit?: number) {
  return queryOptions({
    queryKey: queryKeys.runtimeHandoffSummary(limit),
    queryFn: () => api.listRuntimeHandoffSummary(limit),
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

export function runtimeSessionHandoffsQuery(id: string, limit?: number) {
  return queryOptions({
    queryKey: queryKeys.runtimeSessionHandoffs(id, limit),
    queryFn: () => api.listRuntimeSessionHandoffs(id, limit),
    enabled: !!id,
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

export function runtimeSessionManualTakeoverQuery(id: string) {
  return queryOptions({
    queryKey: queryKeys.runtimeSessionManualTakeover(id),
    queryFn: () => api.getRuntimeSessionManualTakeover(id),
    enabled: !!id,
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

export function runtimeSessionTerminalTakeoverQuery(id: string) {
  return queryOptions({
    queryKey: queryKeys.runtimeSessionTerminalTakeover(id),
    queryFn: () => api.getRuntimeSessionTerminalTakeover(id),
    enabled: !!id,
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

export function runtimeSessionPreflightQuery(
  id: string,
  params: {
    targetRuntime: 'claude-code' | 'codex';
    targetMachineId?: string;
  },
) {
  return queryOptions({
    queryKey: queryKeys.runtimeSessionPreflight(id, params.targetRuntime, params.targetMachineId),
    queryFn: () => api.preflightRuntimeSessionHandoff(id, params),
    enabled: !!id,
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

export function sessionContentQuery(
  sessionId: string,
  params: { machineId: string; projectPath?: string; limit?: number },
) {
  return queryOptions({
    queryKey: queryKeys.sessionContent(sessionId, params),
    queryFn: () => api.getSessionContent(sessionId, params),
    enabled: !!sessionId && !!params.machineId,
  });
}

export function pendingPermissionRequestsQuery(agentId?: string) {
  return queryOptions({
    queryKey: queryKeys.permissionRequests('pending', agentId),
    queryFn: () =>
      api.getPermissionRequests({ status: 'pending', ...(agentId ? { agentId } : {}) }),
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
  });
}

export function discoverQuery() {
  return queryOptions({
    queryKey: queryKeys.discover,
    queryFn: async () => {
      const result = await api.discoverSessions();
      // When ALL machines fail, treat as an error so React Query keeps
      // the previous successful data instead of replacing it with an
      // empty result (which causes the UI to flash "0 sessions").
      if (
        result.machinesQueried > 0 &&
        result.machinesFailed === result.machinesQueried &&
        result.sessions.length === 0
      ) {
        throw new Error(`All ${String(result.machinesQueried)} machine(s) failed to respond`);
      }
      return result;
    },
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
    // Don't retry aggressively on transient failures.
    retry: 1,
  });
}

export function metricsQuery() {
  return queryOptions({
    queryKey: queryKeys.metrics,
    queryFn: api.metrics,
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

export function accountsQuery() {
  return queryOptions({
    queryKey: queryKeys.accounts,
    queryFn: api.listAccounts,
  });
}

export function accountDefaultsQuery() {
  return queryOptions({
    queryKey: queryKeys.accountDefaults,
    queryFn: api.getDefaults,
  });
}

export function runtimeConfigDefaultsQuery() {
  return queryOptions({
    queryKey: queryKeys.runtimeConfigDefaults,
    queryFn: api.getRuntimeConfigDefaults,
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

export function runtimeConfigDriftQuery(machineId?: string) {
  return queryOptions({
    queryKey: queryKeys.runtimeConfigDrift(machineId),
    queryFn: () => api.getRuntimeConfigDrift(machineId),
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

export function meshAutoUpdateQuery() {
  return queryOptions({
    queryKey: queryKeys.meshAutoUpdate,
    queryFn: api.getAutoUpdateStatus,
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

export function useToggleMeshAutoUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.toggleAutoUpdate,
    onSuccess: (status) => {
      qc.setQueryData(queryKeys.meshAutoUpdate, status);
    },
  });
}

export function projectAccountsQuery() {
  return queryOptions({
    queryKey: queryKeys.projectAccounts,
    queryFn: api.listProjectAccounts,
  });
}

export function auditQuery(params?: {
  agentId?: string;
  tool?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}) {
  return queryOptions({
    queryKey: queryKeys.audit(params),
    queryFn: () => api.queryAudit(params),
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

export function auditSummaryQuery(params?: { agentId?: string; from?: string; to?: string }) {
  return queryOptions({
    queryKey: queryKeys.auditSummary(params),
    queryFn: () => api.getAuditSummary(params),
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

export function securityFindingsQuery(params?: {
  severity?: SecurityFindingSeverity;
  category?: string;
  agentId?: string;
  limit?: number;
  offset?: number;
}) {
  return queryOptions({
    queryKey: queryKeys.securityFindings(params),
    queryFn: () => api.listSecurityFindings(params),
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

export function securityFindingsSummaryQuery() {
  return queryOptions({
    queryKey: queryKeys.securityFindingsSummary,
    queryFn: api.getSecurityFindingsSummary,
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

export function routerModelsQuery() {
  return queryOptions({
    queryKey: queryKeys.routerModels,
    queryFn: api.getRouterModels,
    staleTime: 30_000,
  });
}

export function routerModelsInfoQuery() {
  return queryOptions({
    queryKey: queryKeys.routerModelsInfo,
    queryFn: api.getRouterModelsInfo,
    staleTime: 30_000,
  });
}

export function gitStatusQuery(machineId: string, path: string) {
  return queryOptions({
    queryKey: queryKeys.gitStatus(machineId, path),
    queryFn: () => api.getGitStatus(machineId, path),
    enabled: !!machineId && !!path,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function deploymentTiersQuery() {
  return queryOptions({
    queryKey: queryKeys.deploymentTiers,
    queryFn: api.getDeploymentTiers,
    refetchInterval: 10_000,
    staleTime: 8_000,
    refetchIntervalInBackground: false,
  });
}

export function promotionHistoryQuery() {
  return queryOptions({
    queryKey: queryKeys.promotionHistory,
    queryFn: () => api.getPromotionHistory(),
  });
}

export function agentConfigPreviewQuery(agentId: string) {
  return queryOptions({
    queryKey: queryKeys.agentConfigPreview(agentId),
    queryFn: () => api.getAgentConfigPreview(agentId),
    enabled: !!agentId,
    staleTime: 10_000,
  });
}

export function mcpDiscoverQuery(machineId: string, runtime: string, projectPath?: string) {
  return queryOptions({
    queryKey: queryKeys.mcpDiscover(machineId, runtime, projectPath),
    queryFn: () => api.discoverMcpServers(machineId, runtime, projectPath),
    enabled: !!machineId,
    staleTime: 30_000,
  });
}

export function skillDiscoverQuery(machineId: string, runtime: string, projectPath?: string) {
  return queryOptions({
    queryKey: queryKeys.skillDiscover(machineId, runtime, projectPath),
    queryFn: () => api.discoverSkills(machineId, runtime, projectPath),
    enabled: !!machineId,
    staleTime: 30_000,
  });
}

export function mcpTemplatesQuery() {
  return queryOptions({
    queryKey: queryKeys.mcpTemplates,
    queryFn: api.getMcpTemplates,
    staleTime: 5 * 60_000, // Templates rarely change
  });
}

export function memorySearchQuery(q: string, opts?: { project?: string; type?: string }) {
  return queryOptions({
    queryKey: queryKeys.memory.search(q, opts),
    queryFn: () => api.searchMemory({ q, ...opts }),
    enabled: q.length >= 2,
    staleTime: 60_000,
  });
}

export function memoryFactsQuery(params?: MemoryFactsQueryParams) {
  return queryOptions({
    queryKey: queryKeys.memory.facts(params),
    queryFn: () => api.searchMemoryFacts(params ?? {}),
    staleTime: 30_000,
  });
}

export function memoryFactQuery(id: string) {
  return queryOptions({
    queryKey: queryKeys.memory.fact(id),
    queryFn: () => api.getMemoryFact(id),
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function memoryGraphQuery(params?: MemoryGraphQueryParams) {
  return queryOptions({
    queryKey: queryKeys.memory.graph(params),
    queryFn: () => api.getMemoryGraph(params),
    staleTime: 30_000,
  });
}

export function memoryStatsQuery() {
  return queryOptions({
    queryKey: queryKeys.memory.stats,
    queryFn: api.getMemoryStats,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function memoryDecayStatsQuery() {
  return queryOptions({
    queryKey: queryKeys.memory.decayStats,
    queryFn: api.getMemoryDecayStats,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function machineMemoryFactsQuery(machineId: string) {
  return queryOptions({
    queryKey: queryKeys.memory.facts({ machineId }),
    queryFn: () => api.searchMemoryFacts({ machineId, limit: 200 }),
    enabled: !!machineId,
    staleTime: 30_000,
  });
}

export function memoryTimelineQuery(sessionId: string | undefined) {
  return queryOptions({
    queryKey: queryKeys.memory.timeline(sessionId ?? ''),
    queryFn: () => api.getMemoryTimeline(sessionId as string),
    enabled: !!sessionId,
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Mutation hooks
// ---------------------------------------------------------------------------

export function useCreateTaskRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.createTaskRun,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskRuns });
    },
  });
}

/**
 * Preview LLM-based task decomposition (dry run, no persistence).
 * Used by the AutoDecomposeDialog to show proposed subtasks before apply.
 */
export function useDecomposeTaskPreview() {
  return useMutation({
    mutationFn: api.decomposeTaskPreview,
  });
}

/**
 * Apply LLM-based task decomposition — creates a new TaskGraph.
 * Invalidates task-graphs list so the new graph shows up immediately.
 */
export function useDecomposeTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.decomposeTask,
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskGraphs });
      // New graph has its own id — ensure any cached entry is invalidated.
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskGraph(data.graphId) });
    },
  });
}

export function useCreateAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.createAgent,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents });
    },
  });
}

export function useStartAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, prompt }: { id: string; prompt: string }) => api.startAgent(id, prompt),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents });
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions() });
    },
  });
}

export function useStopAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.stopAgent(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents });
    },
  });
}

export function useEmergencyStopAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.emergencyStopAgent(id),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agent(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions() });
    },
  });
}

export function useEmergencyStopAll() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.emergencyStopAll(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents });
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions() });
    },
  });
}

export function useUpdateAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      accountId?: string | null;
      name?: string;
      machineId?: string;
      type?: string;
      schedule?: string | null;
      config?: AgentConfig;
      runtime?: string;
    }) => api.updateAgent(id, body),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agent(variables.id) });
      // Delay preview invalidation so worker-side config state has time to settle.
      setTimeout(() => {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.agentConfigPreview(variables.id),
        });
      }, 500);
    },
  });
}

export function useResumeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, prompt, model }: { id: string; prompt: string; model?: string }) =>
      api.resumeSession(id, prompt, model),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions() });
    },
  });
}

export function useSendMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, message }: { id: string; message: string }) => api.sendMessage(id, message),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.session(variables.id) });
    },
  });
}

export function useSteerAgent() {
  return useMutation({
    mutationFn: ({ agentId, message }: { agentId: string; message: string }) =>
      api.steerAgent(agentId, message),
  });
}

export function useDeleteSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteSession(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions() });
    },
  });
}

export function useForkSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      prompt: string;
      model?: string;
      strategy?: 'jsonl-truncation' | 'context-injection' | 'resume';
      forkAtIndex?: number;
      selectedMessages?: Array<{
        type: string;
        content: string;
        toolName?: string;
        timestamp?: string;
      }>;
    }) => api.forkSession(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions() });
    },
  });
}

export function useCreateRuntimeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.createRuntimeSession,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.runtimeSessions() });
    },
  });
}

export function useResumeRuntimeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
    } & Parameters<typeof api.resumeRuntimeSession>[1]) => api.resumeRuntimeSession(id, body),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.runtimeSessions() });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.runtimeSessionHandoffs(variables.id),
      });
    },
  });
}

export function useForkRuntimeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
    } & Parameters<typeof api.forkRuntimeSession>[1]) => api.forkRuntimeSession(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.runtimeSessions() });
    },
  });
}

export function useHandoffRuntimeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
    } & Parameters<typeof api.handoffRuntimeSession>[1]) => api.handoffRuntimeSession(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.runtimeSessions() });
    },
  });
}

export function useStartRuntimeSessionManualTakeover() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
    } & Parameters<typeof api.startRuntimeSessionManualTakeover>[1]) =>
      api.startRuntimeSessionManualTakeover(id, body),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.runtimeSessions() });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.runtimeSessionManualTakeover(variables.id),
      });
    },
  });
}

export function useStopRuntimeSessionManualTakeover() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => api.stopRuntimeSessionManualTakeover(id),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.runtimeSessions() });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.runtimeSessionManualTakeover(variables.id),
      });
    },
  });
}

export function useStartRuntimeSessionTerminalTakeover() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => api.startRuntimeSessionTerminalTakeover(id),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.runtimeSessions() });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.runtimeSessionTerminalTakeover(variables.id),
      });
    },
  });
}

export function useStopRuntimeSessionTerminalTakeover() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...options }: { id: string; resume?: boolean }) =>
      api.stopRuntimeSessionTerminalTakeover(id, options),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.runtimeSessions() });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.runtimeSessionTerminalTakeover(variables.id),
      });
    },
  });
}

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createAccount,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.accounts });
    },
  });
}

export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: { id: string } & Partial<
      Pick<import('./api').ApiAccount, 'name' | 'priority' | 'isActive'>
    >) => api.updateAccount(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.accounts });
    },
  });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.deleteAccount,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.accounts });
    },
  });
}

export function useTestAccount() {
  return useMutation({ mutationFn: api.testAccount });
}

export function useUpdateDefaults() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.updateDefaults,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.accountDefaults });
      void qc.invalidateQueries({ queryKey: queryKeys.projectAccounts });
    },
  });
}

export function useUpsertProjectAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.upsertProjectAccount,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.projectAccounts });
    },
  });
}

export function useDeleteProjectAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.deleteProjectAccount,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.projectAccounts });
    },
  });
}

export function useUpdateRuntimeConfigDefaults() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.updateRuntimeConfigDefaults,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.runtimeConfigDefaults });
      void qc.invalidateQueries({ queryKey: queryKeys.runtimeConfigDrift() });
    },
  });
}

export function useSyncRuntimeConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.syncRuntimeConfig,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.runtimeConfigDrift() });
    },
  });
}

export function useRefreshRuntimeConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (machineId?: string) => api.refreshRuntimeConfig(machineId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.runtimeConfigDrift() });
    },
  });
}

// ---------------------------------------------------------------------------
// Memory fact mutations
// ---------------------------------------------------------------------------

export function useCreateMemoryFact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createMemoryFact,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.memory.facts() });
      void qc.invalidateQueries({ queryKey: queryKeys.memory.stats });
    },
  });
}

export function useUpdateMemoryFact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...patch
    }: {
      id: string;
      scope?: import('@agentctl/shared').MemoryScope;
      content?: string;
      entityType?: import('@agentctl/shared').EntityType;
      confidence?: number;
      strength?: number;
    }) => api.updateMemoryFact(id, patch),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: queryKeys.memory.facts() });
      void qc.invalidateQueries({ queryKey: queryKeys.memory.fact(variables.id) });
      void qc.invalidateQueries({ queryKey: queryKeys.memory.stats });
    },
  });
}

export function useDeleteMemoryFact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteMemoryFact(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.memory.facts() });
      void qc.invalidateQueries({ queryKey: queryKeys.memory.stats });
    },
  });
}

export function useSubmitFactFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      signal,
    }: {
      id: string;
      signal: import('@agentctl/shared').FeedbackSignal;
    }) => api.submitFactFeedback(id, signal),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: queryKeys.memory.facts() });
      void qc.invalidateQueries({ queryKey: queryKeys.memory.fact(variables.id) });
      void qc.invalidateQueries({ queryKey: queryKeys.memory.stats });
    },
  });
}

// ---------------------------------------------------------------------------
// Memory reports
// ---------------------------------------------------------------------------

export function memoryReportsQuery(params?: {
  reportType?: MemoryReportType;
  scope?: string;
  limit?: number;
}) {
  return queryOptions({
    queryKey: queryKeys.memory.reports(params),
    queryFn: () => api.listMemoryReports(params),
    staleTime: 60_000,
  });
}

export function useGenerateMemoryReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      reportType: MemoryReportType;
      scope?: string;
      timeRange?: MemoryReportTimeRange;
    }) => api.generateMemoryReport(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.memory.reports() });
    },
  });
}

// ---------------------------------------------------------------------------
// Memory knowledge synthesis — §3.6
//
// Synthesis is expensive (four parallel scans over memory_facts / memory_edges)
// and rate-limited at 20 req/min. Modeled as a mutation: the user explicitly
// triggers a run rather than polling automatically on mount.
// ---------------------------------------------------------------------------

export function useRunMemorySynthesis() {
  return useMutation({
    mutationFn: (body?: { scope?: string }) => api.runMemorySynthesis(body),
  });
}

// ---------------------------------------------------------------------------
// Knowledge maintenance — section 7.4
//
// Maintenance is a full memory sweep (stale lint, deleted-file cross-ref,
// synthesis clustering, coverage). It writes a maintenance report and can
// enqueue consolidation items, so it's modeled as a mutation triggered by
// the operator rather than a passive query. Rate-limited at 20 req/min on
// the control plane; the UI should debounce button clicks too.
// ---------------------------------------------------------------------------

export function useRunMemoryMaintenance() {
  return useMutation({
    mutationFn: (body?: { scope?: string }) => api.runMemoryMaintenance(body),
  });
}

// ---------------------------------------------------------------------------
// Memory consolidation
// ---------------------------------------------------------------------------

type ConsolidationQueryParams = Parameters<typeof api.getConsolidationItems>[0];

export function consolidationQuery(params?: ConsolidationQueryParams) {
  return queryOptions({
    queryKey: queryKeys.memory.consolidation(params),
    queryFn: () => api.getConsolidationItems(params),
    staleTime: 30_000,
  });
}

export function useResolveConsolidationItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (variables: { id: string; action: 'accept' | 'skip' | 'delete' }) => {
      const statusMap = { accept: 'accepted', skip: 'skipped', delete: 'skipped' } as const;
      return api.resolveConsolidationItem(variables.id, {
        action: variables.action,
        status: statusMap[variables.action],
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.memory.consolidation() });
      void qc.invalidateQueries({ queryKey: queryKeys.memory.facts() });
      void qc.invalidateQueries({ queryKey: queryKeys.memory.stats });
    },
  });
}

// ---------------------------------------------------------------------------
// Memory scope queries + mutations
// ---------------------------------------------------------------------------

/** Query for the flat list of memory scopes. */
export function memoryScopesQuery() {
  return queryOptions({
    queryKey: queryKeys.memory.scopes,
    queryFn: api.listMemoryScopes,
    staleTime: 30_000,
  });
}

export function useCreateScope() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string;
      type: import('@agentctl/shared').MemoryScopeType;
      parentId?: string;
    }) => api.createMemoryScope(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.memory.scopes });
    },
  });
}

export function useRenameScope() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.renameMemoryScope(id, name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.memory.scopes });
    },
  });
}

export function useDeleteScope() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, cascade }: { id: string; cascade?: boolean }) =>
      api.deleteMemoryScope(id, cascade),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.memory.scopes });
      void qc.invalidateQueries({ queryKey: queryKeys.memory.facts() });
    },
  });
}

export function usePromoteScope() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.promoteScopeFacts(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.memory.scopes });
      void qc.invalidateQueries({ queryKey: queryKeys.memory.facts() });
    },
  });
}

export function useMergeScopes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sourceId, targetId }: { sourceId: string; targetId: string }) =>
      api.mergeScopes(sourceId, targetId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.memory.scopes });
      void qc.invalidateQueries({ queryKey: queryKeys.memory.facts() });
    },
  });
}

// ---------------------------------------------------------------------------
// Memory import queries + mutations
// ---------------------------------------------------------------------------

/** Polling query for an active import job. Polls every 2s while running. */
export function importStatusQuery(isRunning: boolean) {
  return queryOptions({
    queryKey: queryKeys.memory.importStatus,
    queryFn: api.getImportStatus,
    refetchInterval: isRunning ? 2_000 : false,
    retry: false,
  });
}

export function useStartImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { source: import('./api').ImportJob['source']; dbPath: string }) =>
      api.startMemoryImport(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.memory.importStatus });
    },
  });
}

export function useCancelImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cancelImport(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.memory.importStatus });
      void qc.invalidateQueries({ queryKey: queryKeys.memory.stats });
      void qc.invalidateQueries({ queryKey: queryKeys.memory.facts() });
    },
  });
}

// ---------------------------------------------------------------------------
// Collaboration spaces queries + mutations
// ---------------------------------------------------------------------------

export function spacesQuery() {
  return queryOptions({
    queryKey: queryKeys.spaces.all,
    queryFn: api.getSpaces,
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

export function spaceQuery(id: string) {
  return queryOptions({
    queryKey: queryKeys.spaces.detail(id),
    queryFn: () => api.getSpace(id),
    enabled: !!id,
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

export function spaceThreadsQuery(spaceId: string) {
  return queryOptions({
    queryKey: queryKeys.spaces.threads(spaceId),
    queryFn: () => api.getThreads(spaceId),
    enabled: !!spaceId,
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

export function spaceContextRefsQuery(spaceId: string) {
  return queryOptions({
    queryKey: queryKeys.spaces.contextRefs(spaceId),
    queryFn: () => api.getSpaceContextRefs(spaceId),
    enabled: !!spaceId,
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

export function spaceSubscriptionsQuery(spaceId: string) {
  return queryOptions({
    queryKey: queryKeys.spaces.subscriptions(spaceId),
    queryFn: () => api.getSpaceSubscriptions(spaceId),
    enabled: !!spaceId,
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

export function spaceEventsQuery(
  spaceId: string,
  threadId: string,
  params?: { after?: number; limit?: number },
) {
  return queryOptions({
    queryKey: queryKeys.spaces.events(spaceId, threadId),
    queryFn: () => api.getEvents(spaceId, threadId, params),
    enabled: !!spaceId && !!threadId,
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
  });
}

export function useCreateSpace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      name: string;
      description?: string;
      type?: SpaceType;
      visibility?: SpaceVisibility;
    }) => api.createSpace(data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.spaces.all });
    },
  });
}

export function useDeleteSpace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteSpace(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.spaces.all });
    },
  });
}

export function useAddSpaceMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      spaceId,
      ...data
    }: {
      spaceId: string;
      memberType: SpaceMemberType;
      memberId: string;
      role?: SpaceMemberRole;
    }) => api.addSpaceMember(spaceId, data),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: queryKeys.spaces.detail(variables.spaceId) });
    },
  });
}

export function useRemoveSpaceMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ spaceId, memberId }: { spaceId: string; memberId: string }) =>
      api.removeSpaceMember(spaceId, memberId),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: queryKeys.spaces.detail(variables.spaceId) });
    },
  });
}

export function useCreateThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ spaceId, ...data }: { spaceId: string; title?: string; type?: ThreadType }) =>
      api.createThread(spaceId, data),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: queryKeys.spaces.threads(variables.spaceId) });
    },
  });
}

export function usePostEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      spaceId,
      threadId,
      ...data
    }: {
      spaceId: string;
      threadId: string;
      type: SpaceEventType;
      senderType: EventSenderType;
      senderId: string;
      payload: Record<string, unknown>;
      visibility?: EventVisibility;
      idempotencyKey?: string;
    }) => api.postEvent(spaceId, threadId, data),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({
        queryKey: queryKeys.spaces.events(variables.spaceId, variables.threadId),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Notification preferences
// ---------------------------------------------------------------------------

export function notificationPreferencesQuery(userId: string) {
  return queryOptions({
    queryKey: queryKeys.notificationPreferences(userId),
    queryFn: () => api.getNotificationPreferences(userId),
    enabled: !!userId,
  });
}

export function useSetNotificationPreference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      userId: string;
      priority: NotificationPriority;
      channels: NotificationChannel[];
      quietHoursStart?: string;
      quietHoursEnd?: string;
      timezone?: string;
    }) => api.setNotificationPreference(body),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({
        queryKey: queryKeys.notificationPreferences(variables.userId),
      });
    },
  });
}

export function useDeleteNotificationPreference() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, userId }: { id: string; userId: string }) =>
      api.deleteNotificationPreference(id).then((res) => ({ ...res, userId })),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({
        queryKey: queryKeys.notificationPreferences(variables.userId),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Mobile push devices
// ---------------------------------------------------------------------------

export function pushDevicesQuery(userId: string, includeDisabled = false) {
  return queryOptions({
    queryKey: queryKeys.pushDevices(userId),
    queryFn: () => api.listPushDevices(userId, includeDisabled),
    enabled: !!userId,
  });
}

export function useDeactivatePushDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, userId }: { id: string; userId: string }) =>
      api.deactivatePushDevice(id).then((res) => ({ ...res, userId })),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({
        queryKey: queryKeys.pushDevices(variables.userId),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Approval Gates queries + mutations
// ---------------------------------------------------------------------------

export function approvalsQuery(threadId: string) {
  return queryOptions({
    queryKey: queryKeys.approvals(threadId),
    queryFn: () => api.listApprovals(threadId),
    enabled: !!threadId,
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

export function approvalGateQuery(id: string) {
  return queryOptions({
    queryKey: queryKeys.approvalGate(id),
    queryFn: () => api.getApprovalGate(id),
    enabled: !!id,
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

export function approvalDecisionsQuery(id: string) {
  return queryOptions({
    queryKey: queryKeys.approvalDecisions(id),
    queryFn: () => api.getApprovalDecisions(id),
    enabled: !!id,
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

export function useCreateApprovalGate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Parameters<typeof api.createApprovalGate>[0]) =>
      api.createApprovalGate(body),
    onSuccess: (_data, variables) => {
      if (variables.threadId) {
        void qc.invalidateQueries({ queryKey: queryKeys.approvals(variables.threadId) });
      }
    },
  });
}

export function useAddApprovalDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Parameters<typeof api.addApprovalDecision>[1]) =>
      api.addApprovalDecision(id, body),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: queryKeys.approvalGate(variables.id) });
      void qc.invalidateQueries({ queryKey: queryKeys.approvalDecisions(variables.id) });
    },
  });
}

// ---------------------------------------------------------------------------
// Run Summary query
// ---------------------------------------------------------------------------

export function runSummaryQuery(runId: string) {
  return queryOptions({
    queryKey: queryKeys.runSummary(runId),
    queryFn: () => api.getRunSummary(runId),
    enabled: !!runId,
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Context Bridge mutations
// ---------------------------------------------------------------------------

export function useCreateContextRef() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      spaceId,
      ...body
    }: { spaceId: string } & Parameters<typeof api.createContextRef>[1]) =>
      api.createContextRef(spaceId, body),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: queryKeys.spaces.contextRefs(variables.spaceId) });
    },
  });
}

export function useDeleteContextRef() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ spaceId, refId }: { spaceId: string; refId: string }) =>
      api.deleteContextRef(spaceId, refId),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: queryKeys.spaces.contextRefs(variables.spaceId) });
    },
  });
}

export function useCreateSpaceSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      spaceId,
      ...body
    }: { spaceId: string } & Parameters<typeof api.createSpaceSubscription>[1]) =>
      api.createSpaceSubscription(spaceId, body),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: queryKeys.spaces.subscriptions(variables.spaceId) });
    },
  });
}

export function useUpdateSpaceSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ spaceId, subId, active }: { spaceId: string; subId: string; active: boolean }) =>
      api.updateSpaceSubscription(spaceId, subId, active),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: queryKeys.spaces.subscriptions(variables.spaceId) });
    },
  });
}

export function useDeleteSpaceSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ spaceId, subId }: { spaceId: string; subId: string }) =>
      api.deleteSpaceSubscription(spaceId, subId),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: queryKeys.spaces.subscriptions(variables.spaceId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Sync Conflicts
// ---------------------------------------------------------------------------

const CONFLICT_POLL_INTERVAL = 60_000;

export function syncConflictsQuery(params?: {
  status?: string;
  table?: string;
  remoteNodeId?: string;
}) {
  return queryOptions({
    queryKey: queryKeys.syncConflicts(params),
    queryFn: () => api.listSyncConflicts(params),
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
  });
}

export function syncConflictQuery(id: string) {
  return queryOptions({
    queryKey: queryKeys.syncConflict(id),
    queryFn: () => api.getSyncConflict(id),
    enabled: !!id,
  });
}

export function syncConflictCountQuery() {
  return queryOptions({
    queryKey: queryKeys.syncConflictCount,
    queryFn: api.getSyncConflictCount,
    refetchInterval: CONFLICT_POLL_INTERVAL,
    refetchOnWindowFocus: true,
  });
}

/**
 * Trigger a memory-decay cycle. Invalidates both decay stats and the global
 * memory stats so the dashboard reflects the new strength distribution.
 */
export function useRunMemoryDecay() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.runMemoryDecay,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.memory.decayStats });
      void queryClient.invalidateQueries({ queryKey: queryKeys.memory.stats });
    },
  });
}

const SYNC_PEER_POLL_INTERVAL = 30_000;

export function syncPeersQuery() {
  return queryOptions({
    queryKey: queryKeys.syncPeers,
    queryFn: api.listSyncPeers,
    refetchInterval: SYNC_PEER_POLL_INTERVAL,
    refetchOnWindowFocus: true,
  });
}

/**
 * §33.8 — Fetch raw `sync_peer_cursors` state for a single peer. Gated by
 * `enabled` so the mesh health panel only requests cursor data once the row
 * has been expanded.
 */
export function syncPeerCursorsQuery(machineId: string, enabled: boolean) {
  return queryOptions({
    queryKey: queryKeys.syncPeerCursors(machineId),
    queryFn: () => api.getSyncPeerCursors(machineId),
    enabled,
    staleTime: 15_000,
  });
}

export function useUpsertSyncPeer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.upsertSyncPeer,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.syncPeers });
    },
  });
}

export function useDeleteSyncPeer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (machineId: string) => api.deleteSyncPeer(machineId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.syncPeers });
    },
  });
}

/**
 * Ping a mesh sync peer via its `/health` endpoint. Invalidates the peers
 * list so the UI reflects the updated `syncStatus` and `lastSeen` values.
 */
export function usePingSyncPeer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (machineId: string) => api.pingSyncPeer(machineId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.syncPeers });
    },
  });
}

/**
 * Ask a mesh peer to self-update via `POST /api/sync/peers/:peerId/update`
 * (roadmap §33.11 slice 1). The *local* CP proxies the signed request to the
 * peer's CP; the peer's CP is the only one that actually runs the update
 * script — it rejects any `peerId` that doesn't match its own machine id.
 */
export function useUpdateSyncPeer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (machineId: string) => api.updateSyncPeer(machineId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.syncPeers });
    },
  });
}

/**
 * §33.7 — Discover candidate Tailscale peers. Fetched on demand when the
 * operator opens the add-peer dialog (query disabled by default).
 */
export function useDiscoverSyncPeers() {
  return useMutation({
    mutationFn: () => api.discoverSyncPeers(),
  });
}

/**
 * §33.7 — Probe a sync URL's `/health` endpoint before persisting it. This is
 * a side-effectful but idempotent request so it uses `useMutation` to stay in
 * lockstep with the add-peer dialog's user interactions.
 */
export function useProbeSyncUrl() {
  return useMutation({
    mutationFn: (syncUrl: string) => api.probeSyncUrl(syncUrl),
  });
}

/**
 * §33.8 — Retry reverse registration against an existing peer.
 *
 * Always invalidates the peer list so the "one-way" badge reflects the
 * latest reverse-registration outcome, regardless of success or failure.
 */
export function useRegisterReverseSyncPeer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (machineId: string) => api.registerReverseSyncPeer(machineId),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.syncPeers });
    },
  });
}

export function useResolveSyncConflict() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      resolution,
      payload,
    }: {
      id: string;
      resolution: 'local' | 'remote' | 'merged';
      payload?: Record<string, unknown> | null;
    }) => api.resolveSyncConflict(id, { resolution, payload }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sync-conflicts'] });
      void qc.invalidateQueries({ queryKey: queryKeys.syncConflictCount });
    },
  });
}

// ---------------------------------------------------------------------------
// Webhook subscriptions
// ---------------------------------------------------------------------------

const WEBHOOK_POLL_INTERVAL = 30_000;

export function webhooksQuery() {
  return queryOptions({
    queryKey: queryKeys.webhooks,
    queryFn: api.listWebhooks,
    refetchInterval: WEBHOOK_POLL_INTERVAL,
    refetchOnWindowFocus: true,
  });
}

export function useCreateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createWebhook,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.webhooks });
    },
  });
}

export function useUpdateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string } & Parameters<typeof api.updateWebhook>[1]) =>
      api.updateWebhook(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.webhooks });
    },
  });
}

export function useDeleteWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteWebhook(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.webhooks });
    },
  });
}

export function useTestWebhook() {
  return useMutation({
    mutationFn: (id: string) => api.testWebhook(id),
  });
}

export function webhookDeliveriesQuery(id: string) {
  return queryOptions({
    queryKey: queryKeys.webhookDeliveries(id),
    queryFn: () => api.listWebhookDeliveries(id),
    enabled: id.length > 0,
    refetchOnWindowFocus: true,
  });
}
