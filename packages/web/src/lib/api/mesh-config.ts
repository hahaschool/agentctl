// ---------------------------------------------------------------------------
// Mesh config API — GET/PUT /api/mesh/config
// ---------------------------------------------------------------------------

import { request } from './core';

export type MeshConfigResponse = {
  machineId: string;
  hostname: string;
  tailscaleIp: string | null;
  tailscaleIpSource: string | null;
  syncUrl: string;
  syncUrlSource: string;
  registrationTokenConfigured: boolean;
  registrationTokenSource: string | null;
  publicKey: string | null;
};

export type MeshConfigUpdateBody = {
  tailscaleIpOverride?: string | null;
  syncUrlOverride?: string | null;
  registrationToken?: string | null;
};

export const meshConfigApi = {
  getMeshConfig: () => request<MeshConfigResponse>('/api/mesh/config'),

  updateMeshConfig: (body: MeshConfigUpdateBody) =>
    request<MeshConfigResponse>('/api/mesh/config', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
};
