export const APP_SCHEME = 'agentctl';
export const APPROVALS_DEEP_LINK_PATH = 'approvals';
export const APPROVALS_DEEP_LINK_URL = `${APP_SCHEME}://${APPROVALS_DEEP_LINK_PATH}`;

type NotificationDataRecord = Record<string, unknown>;

export type NotificationResponseLike = {
  notification?: {
    request?: {
      content?: {
        data?: unknown;
      };
    };
  };
};

export type NotificationResponseSubscriptionLike = {
  remove: () => void;
};

export type InitialApprovalNotificationHandlerConfig = {
  getLastNotificationResponseAsync: () => Promise<NotificationResponseLike | null>;
  openUrl: (url: string) => Promise<void>;
};

export type ApprovalNotificationListenerConfig = {
  addNotificationResponseReceivedListener: (
    listener: (response: NotificationResponseLike) => void,
  ) => NotificationResponseSubscriptionLike;
  openUrl: (url: string) => Promise<void>;
};

function isRecord(value: unknown): value is NotificationDataRecord {
  return typeof value === 'object' && value !== null;
}

function getResponseData(response: NotificationResponseLike | null | undefined): unknown {
  return response?.notification?.request?.content?.data;
}

export function getApprovalNotificationDeepLink(data: unknown): string | null {
  if (!isRecord(data)) {
    return null;
  }

  const route = typeof data.route === 'string' ? data.route.trim() : '';
  const type = typeof data.type === 'string' ? data.type.trim() : '';

  if (route === APPROVALS_DEEP_LINK_PATH || type === 'approval.pending') {
    return APPROVALS_DEEP_LINK_URL;
  }

  return null;
}

async function openApprovalNotificationDeepLink(
  response: NotificationResponseLike | null | undefined,
  openUrl: (url: string) => Promise<void>,
): Promise<void> {
  const url = getApprovalNotificationDeepLink(getResponseData(response));
  if (!url) {
    return;
  }

  try {
    await openUrl(url);
  } catch {
    // The navigation layer owns the actual route handling, so ignore transient open failures.
  }
}

export async function handleInitialApprovalNotificationResponse(
  config: InitialApprovalNotificationHandlerConfig,
): Promise<void> {
  const response = await config.getLastNotificationResponseAsync();
  await openApprovalNotificationDeepLink(response, config.openUrl);
}

export function registerApprovalNotificationResponseListener(
  config: ApprovalNotificationListenerConfig,
): () => void {
  const subscription = config.addNotificationResponseReceivedListener((response) => {
    void openApprovalNotificationDeepLink(response, config.openUrl);
  });

  return () => {
    subscription.remove();
  };
}
