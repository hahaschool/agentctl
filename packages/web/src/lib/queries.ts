import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from './api';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const queryKeys = {
  health: ['health'] as const,
  machines: ['machines'] as const,
  agents: ['agents'] as const,
  agent: (id: string) => ['agents', id] as const,
  agentRuns: (agentId: string) => ['agents', agentId, 'runs'] as const,
  sessions: (params?: { status?: string; machineId?: string }) =>
    params ? (['sessions', params] as const) : (['sessions'] as const),
  session: (id: string) => ['sessions', id] as const,
  sessionContent: (
    sessionId: string,
    params: { machineId: string; projectPath?: string; limit?: number },
  ) => ['session-content', sessionId, params] as const,
  discover: ['discovered-sessions'] as const,
  metrics: ['metrics'] as const,
  accounts: ['accounts'] as const,
  accountDefaults: ['account-defaults'] as const,
  projectAccounts: ['project-accounts'] as const,
};

// ---------------------------------------------------------------------------
// Query options — use with useQuery(healthQuery()) or useSuspenseQuery
// ---------------------------------------------------------------------------

export function healthQuery() {
  return queryOptions({
    queryKey: queryKeys.health,
    queryFn: api.health,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
}

export function machinesQuery() {
  return queryOptions({
    queryKey: queryKeys.machines,
    queryFn: api.listMachines,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
}

export function agentsQuery() {
  return queryOptions({
    queryKey: queryKeys.agents,
    queryFn: api.listAgents,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });
}

export function agentQuery(id: string) {
  return queryOptions({
    queryKey: queryKeys.agent(id),
    queryFn: () => api.getAgent(id),
    enabled: !!id,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });
}

export function agentRunsQuery(agentId: string) {
  return queryOptions({
    queryKey: queryKeys.agentRuns(agentId),
    queryFn: () => api.getAgentRuns(agentId),
    enabled: !!agentId,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });
}

export function sessionsQuery(params?: { status?: string; machineId?: string }) {
  return queryOptions({
    queryKey: queryKeys.sessions(params),
    queryFn: () => api.listSessions(params),
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
  });
}

export function sessionQuery(id: string) {
  return queryOptions({
    queryKey: queryKeys.session(id),
    queryFn: () => api.getSession(id),
    enabled: !!id,
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
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function metricsQuery() {
  return queryOptions({
    queryKey: queryKeys.metrics,
    queryFn: api.metrics,
    refetchInterval: 15_000,
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

export function projectAccountsQuery() {
  return queryOptions({
    queryKey: queryKeys.projectAccounts,
    queryFn: api.listProjectAccounts,
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
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
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
    mutationFn: ({ id, ...body }: { id: string; accountId?: string | null }) =>
      api.updateAgent(id, body),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agent(variables.id) });
    },
  });
}

export function useCreateSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.createSession,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}

export function useResumeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, prompt }: { id: string; prompt: string }) => api.resumeSession(id, prompt),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}

export function useSendMessage() {
  return useMutation({
    mutationFn: ({ id, message }: { id: string; message: string }) => api.sendMessage(id, message),
  });
}

export function useDeleteSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteSession(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
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
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      api.updateAccount(id, body),
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
