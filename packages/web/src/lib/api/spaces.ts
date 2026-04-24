// ---------------------------------------------------------------------------
// Spaces — collaboration spaces, members, threads, events, context refs,
// cross-space subscriptions. Task graphs + auto-decompose live here too since
// they are scheduled/invoked from spaces in practice.
// ---------------------------------------------------------------------------

import type {
  ContextRef,
  CrossSpaceSubscription,
  DecompositionConstraints,
  DecompositionRequest,
  DecompositionResponse,
  DecompositionResult,
  EventSenderType,
  EventVisibility,
  Space,
  SpaceEvent,
  SpaceEventType,
  SpaceMember,
  SpaceMemberRole,
  SpaceMemberType,
  SpaceType,
  SpaceVisibility,
  TaskDefinition,
  TaskEdge,
  TaskGraph,
  TaskRun,
  Thread,
  ThreadType,
} from '@agentctl/shared';

import { request } from './core';

export type SpaceWithMembers = Space & { members: SpaceMember[] };

export type TaskGraphDetail = TaskGraph & {
  definitions: TaskDefinition[];
  edges: TaskEdge[];
};

export type TaskGraphValidation = {
  valid: boolean;
  errors: string[];
  topologicalOrder?: string[];
};

/**
 * Response from `POST /api/decompose/preview` — dry run of a decomposition.
 * Only the LLM result + validation errors; no graph is persisted.
 */
export type DecompositionPreviewResponse = {
  result: DecompositionResult;
  validationErrors: readonly string[];
};

export type BudgetedContextRefsResponse = {
  refs: ContextRef[];
  excluded: ContextRef[];
  budget: Record<string, unknown>;
};

export type ResolvedContextRefResponse = {
  ref: ContextRef;
  resolved: unknown;
  resolvedAt: string;
  hint?: string;
};

// Temporary local operator identity until auth owns space creation.
export const DEFAULT_SPACE_CREATED_BY = 'local';

export const spacesApi = {
  // ---------------------------------------------------------------------------
  // Collaboration Spaces
  // ---------------------------------------------------------------------------

  getSpaces: () => request<Space[]>('/api/spaces'),

  createSpace: (data: {
    name: string;
    description?: string;
    type?: SpaceType;
    visibility?: SpaceVisibility;
    createdBy: string;
  }) =>
    request<Space>('/api/spaces', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getSpace: (id: string) => request<SpaceWithMembers>(`/api/spaces/${encodeURIComponent(id)}`),

  deleteSpace: (id: string) =>
    request<void>(`/api/spaces/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Space members
  addSpaceMember: (
    spaceId: string,
    data: { memberType: SpaceMemberType; memberId: string; role?: SpaceMemberRole },
  ) =>
    request<SpaceMember>(`/api/spaces/${encodeURIComponent(spaceId)}/members`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  removeSpaceMember: (spaceId: string, memberId: string) =>
    request<void>(
      `/api/spaces/${encodeURIComponent(spaceId)}/members/${encodeURIComponent(memberId)}`,
      { method: 'DELETE' },
    ),

  // Threads
  getThreads: (spaceId: string) =>
    request<Thread[]>(`/api/spaces/${encodeURIComponent(spaceId)}/threads`),

  createThread: (spaceId: string, data: { title?: string; type?: ThreadType }) =>
    request<Thread>(`/api/spaces/${encodeURIComponent(spaceId)}/threads`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Events
  getEvents: (spaceId: string, threadId: string, params?: { after?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.after !== undefined) qs.set('after', String(params.after));
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<SpaceEvent[]>(
      `/api/spaces/${encodeURIComponent(spaceId)}/threads/${encodeURIComponent(threadId)}/events${suffix}`,
    );
  },

  postEvent: (
    spaceId: string,
    threadId: string,
    data: {
      type: SpaceEventType;
      senderType: EventSenderType;
      senderId: string;
      payload: Record<string, unknown>;
      visibility?: EventVisibility;
      idempotencyKey?: string;
    },
  ) =>
    request<SpaceEvent>(
      `/api/spaces/${encodeURIComponent(spaceId)}/threads/${encodeURIComponent(threadId)}/events`,
      { method: 'POST', body: JSON.stringify(data) },
    ),

  // Context bridge (cross-space refs + subscriptions)
  getSpaceContextRefs: (spaceId: string) =>
    request<ContextRef[]>(`/api/spaces/${encodeURIComponent(spaceId)}/context-refs`),

  createContextRef: (
    spaceId: string,
    body: {
      sourceSpaceId: string;
      sourceThreadId?: string;
      sourceEventId?: string;
      targetThreadId: string;
      mode: string;
      snapshotPayload?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
      createdBy: string;
    },
  ) =>
    request<ContextRef>(`/api/spaces/${encodeURIComponent(spaceId)}/context-refs`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getBudgetedContextRefs: (
    spaceId: string,
    params?: { perSpaceLimit?: number; totalLimit?: number; overflowStrategy?: string },
  ) => {
    const qs = new URLSearchParams();
    if (params?.perSpaceLimit !== undefined) qs.set('perSpaceLimit', String(params.perSpaceLimit));
    if (params?.totalLimit !== undefined) qs.set('totalLimit', String(params.totalLimit));
    if (params?.overflowStrategy) qs.set('overflowStrategy', params.overflowStrategy);
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<BudgetedContextRefsResponse>(
      `/api/spaces/${encodeURIComponent(spaceId)}/context-refs/budgeted${suffix}`,
    );
  },

  resolveContextRef: (spaceId: string, refId: string) =>
    request<ResolvedContextRefResponse>(
      `/api/spaces/${encodeURIComponent(spaceId)}/context-refs/${encodeURIComponent(refId)}/resolve`,
    ),

  deleteContextRef: (spaceId: string, refId: string) =>
    request<{ ok: boolean }>(
      `/api/spaces/${encodeURIComponent(spaceId)}/context-refs/${encodeURIComponent(refId)}`,
      { method: 'DELETE' },
    ),

  getSpaceSubscriptions: (spaceId: string) =>
    request<CrossSpaceSubscription[]>(`/api/spaces/${encodeURIComponent(spaceId)}/subscriptions`),

  createSpaceSubscription: (
    spaceId: string,
    body: {
      sourceSpaceId: string;
      filterCriteria?: Record<string, unknown>;
      createdBy: string;
    },
  ) =>
    request<CrossSpaceSubscription>(`/api/spaces/${encodeURIComponent(spaceId)}/subscriptions`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateSpaceSubscription: (spaceId: string, subId: string, active: boolean) =>
    request<CrossSpaceSubscription>(
      `/api/spaces/${encodeURIComponent(spaceId)}/subscriptions/${encodeURIComponent(subId)}`,
      { method: 'PATCH', body: JSON.stringify({ active }) },
    ),

  deleteSpaceSubscription: (spaceId: string, subId: string) =>
    request<{ ok: boolean }>(
      `/api/spaces/${encodeURIComponent(spaceId)}/subscriptions/${encodeURIComponent(subId)}`,
      { method: 'DELETE' },
    ),

  // Task graphs
  listTaskGraphs: () => request<TaskGraph[]>('/api/task-graphs'),

  getTaskGraph: (id: string) =>
    request<TaskGraphDetail>(`/api/task-graphs/${encodeURIComponent(id)}`),

  validateTaskGraph: (id: string) =>
    request<TaskGraphValidation>(`/api/task-graphs/${encodeURIComponent(id)}/validate`, {
      method: 'POST',
    }),

  createTaskGraph: (data: { name: string; spaceId?: string }) =>
    request<{ graphId: string; name: string }>('/api/task-graphs', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteTaskGraph: (id: string) =>
    request<void>(`/api/task-graphs/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Task runs
  listTaskRuns: () => request<TaskRun[]>('/api/task-runs'),

  createTaskRun: (body: { definitionId: string; spaceId?: string; threadId?: string }) =>
    request<TaskRun>('/api/task-runs', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // ---------------------------------------------------------------------------
  // Auto-decompose (LLM-powered task breakdown)
  // ---------------------------------------------------------------------------

  decomposeTaskPreview: (body: { description: string; constraints?: DecompositionConstraints }) =>
    request<DecompositionPreviewResponse>('/api/decompose/preview', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  decomposeTask: (body: DecompositionRequest) =>
    request<DecompositionResponse>('/api/decompose', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
