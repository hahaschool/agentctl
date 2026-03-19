import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

import {
  type ApprovalNotificationRoute,
  getApprovalRouteFromNotificationData,
} from '../navigation/approval-notification-routing.js';
import type { PushNotificationPermission, PushNotificationRuntime } from './push-registration.js';

type NotificationContentData = Record<string, unknown> | null | undefined;
type ExpoRuntimeConstants = {
  easConfig?: {
    projectId?: unknown;
  } | null;
  expoConfig?: {
    extra?: {
      eas?: {
        projectId?: unknown;
      } | null;
    } | null;
    ios?: {
      bundleIdentifier?: unknown;
    } | null;
  } | null;
};

export function createExpoPushNotificationRuntime(): PushNotificationRuntime {
  return {
    getProjectId: resolveExpoProjectId,
    getAppId: resolveAppId,
    async getPermissionsAsync(): Promise<PushNotificationPermission> {
      const settings = await Notifications.getPermissionsAsync();
      return { status: settings.status };
    },
    async requestPermissionsAsync(): Promise<PushNotificationPermission> {
      const settings = await Notifications.requestPermissionsAsync();
      return { status: settings.status };
    },
    async getExpoPushTokenAsync(params: { projectId: string }): Promise<{ data: string | null }> {
      const token = await Notifications.getExpoPushTokenAsync(params);
      return { data: token.data ?? null };
    },
    async getLastNotificationRouteAsync(): Promise<ApprovalNotificationRoute | null> {
      const response = await Notifications.getLastNotificationResponseAsync();
      return getApprovalRouteFromNotificationData(extractNotificationData(response));
    },
    addNotificationResponseListener(listener: (route: ApprovalNotificationRoute | null) => void) {
      const subscription = Notifications.addNotificationResponseReceivedListener(
        (response: Notifications.NotificationResponse) => {
          listener(getApprovalRouteFromNotificationData(extractNotificationData(response)));
        },
      );

      return {
        remove(): void {
          subscription.remove();
        },
      };
    },
  };
}

function resolveExpoProjectId(): string | null {
  const runtimeConstants = Constants as unknown as ExpoRuntimeConstants;
  const easConfig = runtimeConstants.easConfig;
  if (typeof easConfig?.projectId === 'string' && easConfig.projectId.trim()) {
    return easConfig.projectId;
  }

  const expoConfig = runtimeConstants.expoConfig;

  if (typeof expoConfig?.extra?.eas?.projectId === 'string' && expoConfig.extra.eas.projectId) {
    return expoConfig.extra.eas.projectId;
  }

  return null;
}

function resolveAppId(): string | null {
  const runtimeConstants = Constants as unknown as ExpoRuntimeConstants;
  const expoConfig = runtimeConstants.expoConfig;

  if (
    typeof expoConfig?.ios?.bundleIdentifier === 'string' &&
    expoConfig.ios.bundleIdentifier.trim()
  ) {
    return expoConfig.ios.bundleIdentifier;
  }

  return null;
}

function extractNotificationData(
  response: Notifications.NotificationResponse | null | undefined,
): NotificationContentData {
  return (response?.notification.request.content.data as NotificationContentData) ?? null;
}
