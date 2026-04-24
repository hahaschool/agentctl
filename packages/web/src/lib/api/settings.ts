// ---------------------------------------------------------------------------
// Settings — accounts, OAuth, defaults, runtime config, project account
// mappings, notification preferences, mobile push devices, router/LiteLLM.
// ---------------------------------------------------------------------------

import type {
  ManagedRuntimeConfig,
  MobilePushDevice,
  NotificationChannel,
  NotificationPreference,
  NotificationPriority,
  RuntimeConfigSyncRequest,
  RuntimeConfigSyncResponse,
  ApiAccount as SharedApiAccount,
} from '@agentctl/shared';

import { request } from './core';

export type ApiAccount = SharedApiAccount;

export type ProjectAccountMapping = {
  id: string;
  projectPath: string;
  accountId: string;
  createdAt: string;
};

export type AccountDefaults = {
  defaultAccountId: string | null;
  failoverPolicy: 'none' | 'priority' | 'round_robin';
};

export type RuntimeConfigDefaultsResponse = {
  version: number;
  hash: string;
  config: ManagedRuntimeConfig;
};

export type RuntimeConfigDriftItem = {
  id: string;
  machineId: string;
  runtime: import('@agentctl/shared').ManagedRuntime;
  isInstalled: boolean;
  isAuthenticated: boolean;
  syncStatus: string;
  configVersion: number | null;
  configHash: string | null;
  metadata: Record<string, unknown>;
  lastConfigAppliedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  drifted: boolean;
};

export type RuntimeConfigDriftResponse = {
  activeVersion: number;
  activeHash: string;
  items: RuntimeConfigDriftItem[];
};

export type RouterModelsResponse = {
  models: string[];
};

export type ModelDeploymentInfo = {
  modelName: string;
  litellmParams: Record<string, unknown>;
  modelInfo: Record<string, unknown>;
};

export type RouterModelsInfoResponse = {
  deployments: ModelDeploymentInfo[];
};

export const settingsApi = {
  // OAuth
  initiateOAuth: (provider: string, accountName: string) =>
    request<{ authorizationUrl: string; state: string }>('/api/oauth/initiate', {
      method: 'POST',
      body: JSON.stringify({
        provider,
        accountName,
        redirectUri: `${window.location.origin}/api/oauth/callback`,
      }),
    }),

  // Accounts
  listAccounts: () => request<ApiAccount[]>('/api/settings/accounts'),
  createAccount: (body: {
    name: string;
    provider: string;
    credential: string;
    priority?: number;
  }) =>
    request<ApiAccount>('/api/settings/accounts', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateAccount: (id: string, body: Partial<Pick<ApiAccount, 'name' | 'priority' | 'isActive'>>) =>
    request<ApiAccount>(`/api/settings/accounts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteAccount: (id: string) =>
    request<{ ok: boolean }>(`/api/settings/accounts/${id}`, { method: 'DELETE' }),
  testAccount: (id: string) =>
    request<{ ok: boolean; latencyMs?: number }>(`/api/settings/accounts/${id}/test`, {
      method: 'POST',
    }),

  // Settings
  getDefaults: () => request<AccountDefaults>('/api/settings/defaults'),
  updateDefaults: (body: Partial<AccountDefaults>) =>
    request<AccountDefaults>('/api/settings/defaults', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  getRuntimeConfigDefaults: () =>
    request<RuntimeConfigDefaultsResponse>('/api/runtime-config/defaults'),
  updateRuntimeConfigDefaults: (config: ManagedRuntimeConfig) =>
    request<RuntimeConfigDefaultsResponse>('/api/runtime-config/defaults', {
      method: 'PUT',
      body: JSON.stringify({ config }),
    }),
  getRuntimeConfigDrift: (machineId?: string) => {
    const qs = new URLSearchParams();
    if (machineId) qs.set('machineId', machineId);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<RuntimeConfigDriftResponse>(`/api/runtime-config/drift${suffix}`);
  },
  syncRuntimeConfig: (body: RuntimeConfigSyncRequest) =>
    request<RuntimeConfigSyncResponse>('/api/runtime-config/sync', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  refreshRuntimeConfig: (machineId?: string) =>
    request<{ refreshed: number; items: unknown[] }>('/api/runtime-config/refresh', {
      method: 'POST',
      body: JSON.stringify(machineId ? { machineId } : {}),
    }),

  // Project account mappings
  listProjectAccounts: () => request<ProjectAccountMapping[]>('/api/settings/project-accounts'),
  upsertProjectAccount: (body: { projectPath: string; accountId: string }) =>
    request<ProjectAccountMapping>('/api/settings/project-accounts', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteProjectAccount: (id: string) =>
    request<{ ok: boolean }>(`/api/settings/project-accounts/${id}`, { method: 'DELETE' }),

  // Notification preferences
  getNotificationPreferences: (userId: string) =>
    request<{ preferences: NotificationPreference[] }>(
      `/api/notifications/preferences/${encodeURIComponent(userId)}`,
    ),
  setNotificationPreference: (body: {
    userId: string;
    priority: NotificationPriority;
    channels: NotificationChannel[];
    quietHoursStart?: string;
    quietHoursEnd?: string;
    timezone?: string;
  }) =>
    request<{ ok: boolean; preference: NotificationPreference }>('/api/notifications/preferences', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteNotificationPreference: (id: string) =>
    request<{ ok: boolean; deletedId: string }>(
      `/api/notifications/preferences/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    ),

  // Mobile push devices — iOS push notification registrations.
  // The backend scopes devices by userId; web and mobile share
  // DEFAULT_NOTIFICATION_USER_ID from @agentctl/shared until auth owns it.
  listPushDevices: (userId: string, includeDisabled = false) => {
    const params = new URLSearchParams({ userId });
    if (includeDisabled) params.set('includeDisabled', 'true');
    return request<{ devices: MobilePushDevice[] }>(
      `/api/mobile-push-devices?${params.toString()}`,
    );
  },
  deactivatePushDevice: (id: string) =>
    request<{ ok: boolean; device: MobilePushDevice }>(
      `/api/mobile-push-devices/${encodeURIComponent(id)}/deactivate`,
      { method: 'POST' },
    ),

  // Router / LiteLLM
  getRouterModels: () => request<RouterModelsResponse>('/api/router/models'),
  getRouterModelsInfo: () => request<RouterModelsInfoResponse>('/api/router/models/info'),
};
