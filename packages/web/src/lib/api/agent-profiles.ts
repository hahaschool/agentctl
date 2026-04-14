// ---------------------------------------------------------------------------
// Agent Profiles — CRUD over /api/agent-profiles. Profiles describe reusable
// agent identities (name + runtime + model + capabilities). Instances live on
// their own sub-routes and are not surfaced in the profile index page.
// ---------------------------------------------------------------------------

import type { AgentProfile, AgentRuntimeType } from '@agentctl/shared';

import { request } from './core';

export type { AgentProfile, AgentRuntimeType } from '@agentctl/shared';
export { AGENT_RUNTIME_TYPES, isAgentRuntimeType } from '@agentctl/shared';

export type CreateAgentProfileInput = {
  readonly name: string;
  readonly runtimeType: AgentRuntimeType;
  readonly modelId: string;
  readonly providerId: string;
  readonly capabilities?: readonly string[];
  readonly toolScopes?: readonly string[];
  readonly maxTokensPerTask?: number | null;
  readonly maxCostPerHour?: number | null;
};

export type UpdateAgentProfileInput = Partial<CreateAgentProfileInput>;

export type DeleteAgentProfileResponse = { ok: true };

export const agentProfilesApi = {
  listAgentProfiles: (): Promise<AgentProfile[]> => request<AgentProfile[]>('/api/agent-profiles'),

  createAgentProfile: (body: CreateAgentProfileInput): Promise<AgentProfile> =>
    request<AgentProfile>('/api/agent-profiles', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getAgentProfile: (id: string): Promise<AgentProfile> =>
    request<AgentProfile>(`/api/agent-profiles/${encodeURIComponent(id)}`),

  // Backend PATCH is not implemented yet; this is the forward-compatible shape
  // so callers (e.g., an edit dialog) can use the same surface once the route
  // lands. Safe to keep because the request helper surfaces HTTP errors.
  updateAgentProfile: (id: string, body: UpdateAgentProfileInput): Promise<AgentProfile> =>
    request<AgentProfile>(`/api/agent-profiles/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteAgentProfile: (id: string): Promise<DeleteAgentProfileResponse> =>
    request<DeleteAgentProfileResponse>(`/api/agent-profiles/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
};
