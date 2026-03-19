import type { PermissionRequest } from '@agentctl/shared';

import type { ApiClient } from './api-client.js';
import { MobileClientError } from './api-client.js';
import { requestWithApiClient } from './request-with-api-client.js';

export type PermissionRequestDecision = 'approved' | 'denied';

export type PermissionRequestListParams = {
  status?: PermissionRequest['status'];
  agentId?: string;
  sessionId?: string;
};

function assertNonEmptyId(label: string, value: string): void {
  if (!value.trim()) {
    throw new MobileClientError(
      `INVALID_${label.toUpperCase()}`,
      `${label} must be a non-empty string`,
    );
  }
}

export class PermissionRequestApi {
  constructor(private readonly apiClient: ApiClient) {}

  async listRequests(params?: PermissionRequestListParams): Promise<PermissionRequest[]> {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.agentId) qs.set('agentId', params.agentId);
    if (params?.sessionId) qs.set('sessionId', params.sessionId);
    const suffix = qs.toString() ? `?${qs}` : '';

    return requestWithApiClient<PermissionRequest[]>(
      this.apiClient,
      'GET',
      `/api/permission-requests${suffix}`,
    );
  }

  async resolveRequest(
    id: string,
    decision: PermissionRequestDecision,
  ): Promise<PermissionRequest> {
    assertNonEmptyId('permission request id', id);

    return requestWithApiClient<PermissionRequest>(
      this.apiClient,
      'PATCH',
      `/api/permission-requests/${encodeURIComponent(id)}`,
      { decision },
    );
  }
}
