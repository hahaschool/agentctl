export type ApprovalNotificationRoute = 'approvals';

export function getApprovalRouteFromNotificationData(
  data: Record<string, unknown> | null | undefined,
): ApprovalNotificationRoute | null {
  const route = typeof data?.route === 'string' ? data.route.trim().toLowerCase() : undefined;
  const type = typeof data?.type === 'string' ? data.type.trim().toLowerCase() : undefined;

  if (route === 'approvals' || type === 'approval.pending') {
    return 'approvals';
  }

  return null;
}

export function approvalRouteToPath(route: ApprovalNotificationRoute): string {
  switch (route) {
    case 'approvals':
      return 'agentctl://approvals';
  }
}
