// ---------------------------------------------------------------------------
// Deployment — tier status, preflight checks, promotion triggers + history.
// ---------------------------------------------------------------------------

import { request } from './core';

export type DeploymentTierStatus = {
  name: string;
  label: string;
  status: 'running' | 'degraded' | 'stopped';
  services: Array<{
    name: string;
    port: number;
    healthy: boolean;
    memoryMb?: number;
    uptimeSeconds?: number;
    restarts?: number;
    pid?: number;
  }>;
  config: {
    cpPort: number;
    workerPort: number;
    webPort: number;
    database: string;
    redisDb: number;
  };
};

export type DeploymentPreflightCheck = {
  name: string;
  status: 'pass' | 'fail' | 'running' | 'skipped';
  message?: string;
  durationMs?: number;
};

export type DeploymentPromotionRecord = {
  id: string;
  sourceTier: string;
  targetTier: string;
  status: string;
  checks: DeploymentPreflightCheck[];
  error?: string;
  gitSha?: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  triggeredBy: string;
};

export const deploymentApi = {
  getDeploymentTiers: () => request<{ tiers: DeploymentTierStatus[] }>('/api/deployment/tiers'),

  runPreflight: (source: string) =>
    request<{ ready: boolean; checks: DeploymentPreflightCheck[] }>(
      '/api/deployment/promote/preflight',
      {
        method: 'POST',
        body: JSON.stringify({ source }),
      },
    ),

  triggerPromotion: (source: string) =>
    request<{ id: string; status: string }>('/api/deployment/promote', {
      method: 'POST',
      body: JSON.stringify({ source }),
    }),

  getPromotionHistory: (limit = 20, offset = 0) =>
    request<{ records: DeploymentPromotionRecord[]; total: number }>(
      `/api/deployment/history?limit=${limit}&offset=${offset}`,
    ),
};
