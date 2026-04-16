// ---------------------------------------------------------------------------
// Security — audit trail queries + security findings.
// ---------------------------------------------------------------------------

import { request } from './core';

export type AuditAction = {
  id: string;
  runId: string;
  timestamp: string;
  actionType: string;
  toolName: string | null;
  toolInput: Record<string, unknown> | null;
  toolOutputHash: string | null;
  durationMs: number | null;
  approvedBy: string | null;
  agentId: string | null;
};

export type AuditQueryResult = {
  actions: AuditAction[];
  total: number;
  hasMore: boolean;
};

export type AuditSummary = {
  totalActions: number;
  toolBreakdown: Record<string, number>;
  actionTypeBreakdown: Record<string, number>;
  avgDurationMs: number | null;
};

export type SecurityFindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type SecurityFinding = {
  id: string;
  agentId: string;
  runId: string;
  severity: SecurityFindingSeverity;
  category: string;
  title: string;
  description: string;
  file: string | null;
  line: number | null;
  recommendation: string;
  acknowledged: boolean;
  acknowledgedBy: string | null;
  acknowledgeReason: string | null;
  issueCreated: boolean;
  createdAt: string;
};

export type SecurityFindingsResult = {
  findings: SecurityFinding[];
  total: number;
};

export type SecurityFindingsSummary = {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  byCategory: Record<string, number>;
};

export type AcknowledgeFindingInput = {
  acknowledgedBy: string;
  reason?: string;
};

export type AcknowledgeFindingResult = {
  ok: boolean;
};

export type DeleteFindingResult = {
  ok: boolean;
};

export type CreateGithubIssuesInput = {
  owner: string;
  repo: string;
  labels?: string[];
};

export type CreateGithubIssuesResult = {
  ok: boolean;
  issuesCreated: number;
};

export const securityApi = {
  // Audit Trail
  queryAudit: (params?: {
    agentId?: string;
    tool?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.agentId) qs.set('agentId', params.agentId);
    if (params?.tool) qs.set('tool', params.tool);
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    if (params?.offset !== undefined) qs.set('offset', String(params.offset));
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<AuditQueryResult>(`/api/audit${suffix}`);
  },
  getAuditSummary: (params?: { agentId?: string; from?: string; to?: string }) => {
    const qs = new URLSearchParams();
    if (params?.agentId) qs.set('agentId', params.agentId);
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<AuditSummary>(`/api/audit/summary${suffix}`);
  },
  listSecurityFindings: (params?: {
    severity?: SecurityFindingSeverity;
    category?: string;
    agentId?: string;
    limit?: number;
    offset?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.severity) qs.set('severity', params.severity);
    if (params?.category) qs.set('category', params.category);
    if (params?.agentId) qs.set('agentId', params.agentId);
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    if (params?.offset !== undefined) qs.set('offset', String(params.offset));
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<SecurityFindingsResult>(`/api/security/findings${suffix}`);
  },
  getSecurityFindingsSummary: () =>
    request<SecurityFindingsSummary>('/api/security/findings/summary'),

  // Write operations
  acknowledgeSecurityFinding: (id: string, body: AcknowledgeFindingInput) =>
    request<AcknowledgeFindingResult>(
      `/api/security/findings/${encodeURIComponent(id)}/acknowledge`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    ),
  deleteSecurityFinding: (id: string) =>
    request<DeleteFindingResult>(`/api/security/findings/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  createGithubIssuesFromFindings: (body: CreateGithubIssuesInput) =>
    request<CreateGithubIssuesResult>('/api/security/findings/github-issues', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
