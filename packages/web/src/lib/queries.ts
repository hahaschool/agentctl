import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';

import type { AgentConfig } from './api';
import { api } from './api';
import { STORAGE_KEYS } from './storage-keys';

type RuntimeSessionsQueryParams = Parameters<typeof api.listRuntimeSessions>[0];
type MemoryFactsQueryParams = Parameters<typeof api.searchMemoryFacts>[0];
type MemoryGraphQueryParams = Parameters<typeof api.getMemoryGraph>[0];

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
  machines: ['machines'] as const,
  agents: ['agents'] as const,
  agent: (id: string) => ['agents', id] as const,
  agentRuns: (agentId: string) => ['agents', agentId, 'runs'] as const,
  sessions: (params?: {
    status?: string;
    machineId?: string;
    agentId?: string;
    offset?: number;
    limit?: number;
  }) => (params ? (['sessions', params] as const) : (['sessions'] as const)),
  session: (id: string) => ['sessions', id] as const,
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
  runtimeSessionPreflight: (id: string, targetRuntime: string, targetMachineId?: string) =>
    targetMachineId
      ? (['runtime-sessions', id, 'preflight', targetRuntime, targetMachineId] as const)
      : (['runtime-sessions', id, 'preflight', targetRuntime] as const),
  sessionContent: (
    sessionId: string,
    params: { machineId: string; projectPath?: string; limit?: number },
  ) => ['session-content', sessionId, params] as const,
  discover: ['discovered-sessions'] as const,
  metrics: ['metrics'] as const,
  accounts: ['accounts'] as const,
  accountDefaults: ['account-defaults'] as const,
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
  gitStatus: (machineId: string, path: string) => ['git-status', machineId, path] as const,
  memory: {
    search: (q: string, opts?: { project?: string; type?: string }) =>
      ['memory', 'search', q, opts] as const,
    facts: (params?: MemoryFactsQueryParams) =>
      params ? (['memory', 'facts', params] as const) : (['memory', 'facts'] as const),
    fact: (id: string) => ['memory', 'fact', id] as const,
    graph: (params?: MemoryGraphQueryParams) =>
      params ? (['memory', 'graph', params] as const) : (['memory', 'graph'] as const),
    stats: ['memory', 'stats'] as const,
    timeline: (sessionId: string) => ['memory', 'timeline', sessionId] as const,
    observation: (id: number) => ['memory', 'observation', id] as const,
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

export function machinesQuery() {
  return queryOptions({
    queryKey: queryKeys.machines,
    queryFn: api.listMachines,
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

export function discoverQuery() {
  return queryOptions({
    queryKey: queryKeys.discover,
    queryFn: api.discoverSessions,
    refetchInterval: getRefetchInterval(),
    refetchOnWindowFocus: true,
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
    }) => api.updateAgent(id, body),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agent(variables.id) });
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

// ---------------------------------------------------------------------------
// Memory scope queries + mutations
// ---------------------------------------------------------------------------

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
    mutationFn: api.createMemoryScope,
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
      void qc.invalidateQueries({ queryKey: queryKeys.memory.stats });
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
