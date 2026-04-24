// ---------------------------------------------------------------------------
// Memory embedding providers — local machine provider custody for Memory Ops.
// ---------------------------------------------------------------------------

import type { EmbeddingProvider, EmbeddingProviderKind } from '@agentctl/shared';

import { request } from './core';

export type MemoryProvidersResponse = {
  providers: EmbeddingProvider[];
};

export type ProviderTestResult = {
  ok: boolean;
  dim: number;
  model: string;
  costUsd: number;
  latencyMs: number;
};

export type TestEphemeralResult = ProviderTestResult & {
  signedToken: string;
};

export type RecentProviderTestResult = {
  signedToken: string;
  apiKey: string;
};

export type ProviderMutationBody = {
  name?: string;
  provider?: EmbeddingProviderKind;
  model?: string;
  apiKey?: string;
  active?: boolean;
  recentTestResult?: RecentProviderTestResult;
};

export type CreateProviderBody = Required<Pick<ProviderMutationBody, 'name' | 'provider' | 'model' | 'apiKey'>> &
  Pick<ProviderMutationBody, 'active' | 'recentTestResult'>;

export type TestEphemeralBody = {
  provider: EmbeddingProviderKind;
  model: string;
  apiKey: string;
};

export const memoryProvidersApi = {
  list: () => request<MemoryProvidersResponse>('/api/memory/providers'),

  create: (body: CreateProviderBody) =>
    request<{ provider: EmbeddingProvider }>('/api/memory/providers', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  update: (id: string, body: ProviderMutationBody) =>
    request<{ provider: EmbeddingProvider }>(`/api/memory/providers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  setActive: (id: string) =>
    request<{ provider: EmbeddingProvider }>(`/api/memory/providers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: true }),
    }),

  remove: (id: string) =>
    request<{ ok: boolean }>(`/api/memory/providers/${id}`, {
      method: 'DELETE',
    }),

  testEphemeral: (body: TestEphemeralBody) =>
    request<TestEphemeralResult>('/api/memory/providers/test-ephemeral', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  testSaved: (id: string) =>
    request<ProviderTestResult>(`/api/memory/providers/${id}/test`, {
      method: 'POST',
    }),
};
