import type { RuntimeSessionInfo } from '../services/api-client.js';

export function getRuntimeTabBadgeCount(
  runtimeSessions: RuntimeSessionInfo[],
  pendingApprovalCount = 0,
): number {
  return (
    runtimeSessions.filter((session) => session.status === 'handing_off').length +
    pendingApprovalCount
  );
}
