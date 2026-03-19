import type { ApprovalNotificationRoute } from '../navigation/approval-notification-routing.js';
import { MobileClientError } from './api-client.js';
import type { MobilePushDeviceUpsertRequest } from './mobile-push-device-api.js';

export type PushNotificationPermissionStatus = 'granted' | 'denied' | 'undetermined';

export type PushNotificationPermission = {
  status: PushNotificationPermissionStatus;
};

export type PushNotificationRuntime = {
  getProjectId: () => string | null | undefined;
  getAppId: () => string | null | undefined;
  getPermissionsAsync: () => Promise<PushNotificationPermission>;
  requestPermissionsAsync: () => Promise<PushNotificationPermission>;
  getExpoPushTokenAsync: (params: {
    projectId: string;
  }) => Promise<{ data: string | null | undefined }>;
  getLastNotificationRouteAsync: () => Promise<ApprovalNotificationRoute | null>;
  addNotificationResponseListener: (
    listener: (route: ApprovalNotificationRoute | null) => void,
  ) => { remove: () => void };
};

type PushRegistrationBootstrapResult =
  | {
      status: 'registered';
      projectId: string;
      token: string;
      payload: MobilePushDeviceUpsertRequest;
    }
  | {
      status: 'skipped';
      reason: 'permission-denied' | 'missing-project-id' | 'missing-token';
    }
  | {
      status: 'deferred';
      reason: 'endpoint-unavailable' | 'registration-failed';
      payload: MobilePushDeviceUpsertRequest;
    };

type PushRegistrationServiceConfig = {
  runtime: PushNotificationRuntime;
  upsertDevice: (payload: MobilePushDeviceUpsertRequest) => Promise<unknown>;
  operatorId?: string;
  now?: () => Date;
};

const DEFAULT_OPERATOR_ID = 'mobile-operator';
const DEFAULT_APP_ID = 'com.agentctl.mobile';

export class PushRegistrationService {
  private readonly runtime: PushNotificationRuntime;
  private readonly upsertDevice: (payload: MobilePushDeviceUpsertRequest) => Promise<unknown>;
  private readonly operatorId: string;
  private readonly now: () => Date;

  constructor(config: PushRegistrationServiceConfig) {
    this.runtime = config.runtime;
    this.upsertDevice = config.upsertDevice;
    this.operatorId = config.operatorId ?? DEFAULT_OPERATOR_ID;
    this.now = config.now ?? (() => new Date());
  }

  async bootstrap(): Promise<PushRegistrationBootstrapResult> {
    const permission = await this.getResolvedPermission();
    if (permission.status !== 'granted') {
      return {
        status: 'skipped',
        reason: 'permission-denied',
      };
    }

    const projectId = this.runtime.getProjectId()?.trim();
    if (!projectId) {
      return {
        status: 'skipped',
        reason: 'missing-project-id',
      };
    }

    const token = (await this.runtime.getExpoPushTokenAsync({ projectId })).data?.trim();
    if (!token) {
      return {
        status: 'skipped',
        reason: 'missing-token',
      };
    }

    const payload: MobilePushDeviceUpsertRequest = {
      userId: this.operatorId,
      platform: 'ios',
      provider: 'expo',
      pushToken: token,
      appId: this.runtime.getAppId()?.trim() || DEFAULT_APP_ID,
      lastSeenAt: this.now().toISOString(),
    };

    try {
      await this.upsertDevice(payload);
    } catch (error) {
      return {
        status: 'deferred',
        reason: isEndpointUnavailable(error) ? 'endpoint-unavailable' : 'registration-failed',
        payload,
      };
    }

    return {
      status: 'registered',
      projectId,
      token,
      payload,
    };
  }

  async getInitialNotificationRoute(): Promise<ApprovalNotificationRoute | null> {
    return this.runtime.getLastNotificationRouteAsync();
  }

  addNotificationResponseListener(listener: (route: ApprovalNotificationRoute | null) => void): {
    remove: () => void;
  } {
    return this.runtime.addNotificationResponseListener(listener);
  }

  private async getResolvedPermission(): Promise<PushNotificationPermission> {
    const existing = await this.runtime.getPermissionsAsync();
    if (existing.status === 'granted') {
      return existing;
    }

    return this.runtime.requestPermissionsAsync();
  }
}

function isEndpointUnavailable(error: unknown): boolean {
  if (!(error instanceof MobileClientError)) {
    return false;
  }

  return (
    error.code === 'HTTP_404' ||
    error.code === 'HTTP_405' ||
    error.code === 'HTTP_501' ||
    error.context?.status === 404 ||
    error.context?.status === 405 ||
    error.context?.status === 501
  );
}

export type { PushRegistrationBootstrapResult };
