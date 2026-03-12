// ── Approval Gates ──────────────────────────────────────────

export const APPROVAL_GATE_STATUSES = ['pending', 'approved', 'rejected', 'timed-out'] as const;
export type ApprovalGateStatus = (typeof APPROVAL_GATE_STATUSES)[number];

export const APPROVAL_DECISION_ACTIONS = ['approved', 'rejected', 'changes-requested'] as const;
export type ApprovalDecisionAction = (typeof APPROVAL_DECISION_ACTIONS)[number];

export const APPROVAL_TIMEOUT_POLICIES = ['auto-approve', 'escalate', 'pause', 'reject'] as const;
export type ApprovalTimeoutPolicy = (typeof APPROVAL_TIMEOUT_POLICIES)[number];

export function isApprovalGateStatus(v: string): v is ApprovalGateStatus {
  return (APPROVAL_GATE_STATUSES as readonly string[]).includes(v);
}

export function isApprovalDecisionAction(v: string): v is ApprovalDecisionAction {
  return (APPROVAL_DECISION_ACTIONS as readonly string[]).includes(v);
}

export function isApprovalTimeoutPolicy(v: string): v is ApprovalTimeoutPolicy {
  return (APPROVAL_TIMEOUT_POLICIES as readonly string[]).includes(v);
}

export type ApprovalGate = {
  readonly id: string;
  readonly taskDefinitionId: string;
  readonly taskRunId: string | null;
  readonly threadId: string | null;
  readonly requiredApprovers: readonly string[];
  readonly requiredCount: number;
  readonly timeoutMs: number;
  readonly timeoutPolicy: ApprovalTimeoutPolicy;
  readonly contextArtifactIds: readonly string[];
  readonly status: ApprovalGateStatus;
  readonly createdAt: string;
};

export type ApprovalDecision = {
  readonly id: string;
  readonly gateId: string;
  readonly decidedBy: string;
  readonly action: ApprovalDecisionAction;
  readonly comment: string | null;
  readonly viaTimeout: boolean;
  readonly decidedAt: string;
};
