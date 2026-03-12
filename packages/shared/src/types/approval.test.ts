import { describe, expect, it } from 'vitest';

import {
  APPROVAL_DECISION_ACTIONS,
  APPROVAL_GATE_STATUSES,
  APPROVAL_TIMEOUT_POLICIES,
  isApprovalDecisionAction,
  isApprovalGateStatus,
  isApprovalTimeoutPolicy,
} from './approval.js';

describe('Approval types', () => {
  it('APPROVAL_GATE_STATUSES contains expected values', () => {
    expect(APPROVAL_GATE_STATUSES).toEqual(['pending', 'approved', 'rejected', 'timed-out']);
  });

  it('APPROVAL_DECISION_ACTIONS contains expected values', () => {
    expect(APPROVAL_DECISION_ACTIONS).toEqual(['approved', 'rejected', 'changes-requested']);
  });

  it('APPROVAL_TIMEOUT_POLICIES contains expected values', () => {
    expect(APPROVAL_TIMEOUT_POLICIES).toEqual(['auto-approve', 'escalate', 'pause', 'reject']);
  });

  it('isApprovalGateStatus validates correctly', () => {
    expect(isApprovalGateStatus('pending')).toBe(true);
    expect(isApprovalGateStatus('timed-out')).toBe(true);
    expect(isApprovalGateStatus('invalid')).toBe(false);
  });

  it('isApprovalDecisionAction validates correctly', () => {
    expect(isApprovalDecisionAction('approved')).toBe(true);
    expect(isApprovalDecisionAction('changes-requested')).toBe(true);
    expect(isApprovalDecisionAction('invalid')).toBe(false);
  });

  it('isApprovalTimeoutPolicy validates correctly', () => {
    expect(isApprovalTimeoutPolicy('auto-approve')).toBe(true);
    expect(isApprovalTimeoutPolicy('reject')).toBe(true);
    expect(isApprovalTimeoutPolicy('invalid')).toBe(false);
  });
});
