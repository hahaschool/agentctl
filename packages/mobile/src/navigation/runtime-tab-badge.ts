import type { RuntimeSessionInfo } from '../services/api-client.js';

export type RuntimeTabBadgeSnapshot = {
  handoffCount: number;
  approvalCount: number;
};

export type RuntimeTabBadgeRefreshConfig = {
  previous: RuntimeTabBadgeSnapshot;
  includeApprovalCount?: boolean;
  loadRuntimeSessions: () => Promise<RuntimeSessionInfo[]>;
  loadPendingApprovalCount: () => Promise<number>;
};

export function countHandingOffSessions(runtimeSessions: RuntimeSessionInfo[]): number {
  return runtimeSessions.filter((session) => session.status === 'handing_off').length;
}

export function getRuntimeTabBadgeCount(
  runtimeSessions: RuntimeSessionInfo[],
  pendingApprovalCount = 0,
): number {
  return countHandingOffSessions(runtimeSessions) + pendingApprovalCount;
}

export function toRuntimeTabBadgeCount(snapshot: RuntimeTabBadgeSnapshot): number {
  return snapshot.handoffCount + snapshot.approvalCount;
}

export async function refreshRuntimeTabBadgeSnapshot(
  config: RuntimeTabBadgeRefreshConfig,
): Promise<RuntimeTabBadgeSnapshot> {
  const [runtimeResult, approvalResult] = await Promise.allSettled([
    config.loadRuntimeSessions(),
    config.includeApprovalCount === false
      ? Promise.resolve(config.previous.approvalCount)
      : config.loadPendingApprovalCount(),
  ]);

  const handoffCount =
    runtimeResult.status === 'fulfilled'
      ? countHandingOffSessions(runtimeResult.value)
      : config.previous.handoffCount;

  const approvalCount =
    approvalResult.status === 'fulfilled' ? approvalResult.value : config.previous.approvalCount;

  return {
    handoffCount,
    approvalCount,
  };
}
