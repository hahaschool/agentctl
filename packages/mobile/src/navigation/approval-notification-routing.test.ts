import { describe, expect, it } from 'vitest';

import {
  approvalRouteToPath,
  getApprovalRouteFromNotificationData,
} from './approval-notification-routing.js';

describe('approval notification routing', () => {
  it('routes route=approvals payloads into the approvals tab', () => {
    expect(getApprovalRouteFromNotificationData({ route: 'approvals' })).toBe('approvals');
  });

  it('routes approval.pending payloads into the approvals tab', () => {
    expect(getApprovalRouteFromNotificationData({ type: 'approval.pending' })).toBe('approvals');
  });

  it('ignores unrelated notification payloads', () => {
    expect(getApprovalRouteFromNotificationData({ type: 'handoff', route: 'sessions' })).toBeNull();
  });

  it('maps approvals routes to the app deep link path', () => {
    expect(approvalRouteToPath('approvals')).toBe('agentctl://approvals');
  });
});
