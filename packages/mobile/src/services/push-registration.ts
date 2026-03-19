import { MobileClientError } from './api-client.js';

export const DEFAULT_PUSH_OPERATOR_ID = 'operator';
export const MOBILE_PUSH_DEVICE_UPSERT_PATH = '/api/mobile-push-devices';

const BACKEND_UNAVAILABLE_ERROR_CODES = new Set(['HTTP_404', 'HTTP_405', 'HTTP_501']);

export type NotificationPermissionStatus = 'granted' | 'denied' | 'undetermined';

export type ExpoProjectIdSource = {
  expoConfig?: {
    extra?: {
      eas?: {
        projectId?: unknown;
      };
    };
  };
  easConfig?: {
    projectId?: unknown;
  };
};

export type MobilePushDeviceUpsertPayload = {
  userId: string;
  platform: 'ios';
  provider: 'expo';
  pushToken: string;
  appId: string | null;
  lastSeenAt: string;
};

export type PushRegistrationResult =
  | {
      status: 'unsupported-platform';
      platform: string;
    }
  | {
      status: 'physical-device-required';
      platform: string;
    }
  | {
      status: 'missing-project-id';
    }
  | {
      status: 'permission-denied';
      permissionStatus: NotificationPermissionStatus;
    }
  | {
      status: 'token-acquired';
      projectId: string;
      pushToken: string;
      payload: MobilePushDeviceUpsertPayload;
    }
  | {
      status: 'registered';
      projectId: string;
      pushToken: string;
      payload: MobilePushDeviceUpsertPayload;
    }
  | {
      status: 'backend-unavailable';
      projectId: string;
      pushToken: string;
      payload: MobilePushDeviceUpsertPayload;
      error: MobileClientError;
    }
  | {
      status: 'registration-failed';
      projectId: string;
      pushToken: string;
      payload: MobilePushDeviceUpsertPayload;
      error: unknown;
    };

export type PushRegistrationServiceConfig = {
  platform: string;
  isDevice: boolean;
  constants?: ExpoProjectIdSource | null;
  getPermissionsAsync: () => Promise<{ status: NotificationPermissionStatus }>;
  requestPermissionsAsync: () => Promise<{ status: NotificationPermissionStatus }>;
  getExpoPushTokenAsync: (params: { projectId: string }) => Promise<{ data: string }>;
  getApplicationId: () => string | null;
  upsertDevice?: (payload: MobilePushDeviceUpsertPayload) => Promise<void>;
  now?: () => string;
  userId?: string;
};

function toNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function resolveExpoProjectId(
  constants: ExpoProjectIdSource | null | undefined,
): string | null {
  return (
    toNonEmptyString(constants?.expoConfig?.extra?.eas?.projectId) ??
    toNonEmptyString(constants?.easConfig?.projectId)
  );
}

export function buildPushDeviceUpsertPayload(params: {
  pushToken: string;
  appId: string | null;
  lastSeenAt: string;
  userId?: string;
}): MobilePushDeviceUpsertPayload {
  return {
    userId: params.userId?.trim() || DEFAULT_PUSH_OPERATOR_ID,
    platform: 'ios',
    provider: 'expo',
    pushToken: params.pushToken.trim(),
    appId: params.appId?.trim() || null,
    lastSeenAt: params.lastSeenAt,
  };
}

export class PushRegistrationService {
  private readonly now: () => string;

  constructor(private readonly config: PushRegistrationServiceConfig) {
    this.now = config.now ?? (() => new Date().toISOString());
  }

  async bootstrap(): Promise<PushRegistrationResult> {
    if (this.config.platform !== 'ios') {
      return {
        status: 'unsupported-platform',
        platform: this.config.platform,
      };
    }

    if (!this.config.isDevice) {
      return {
        status: 'physical-device-required',
        platform: this.config.platform,
      };
    }

    const projectId = resolveExpoProjectId(this.config.constants);
    if (!projectId) {
      return { status: 'missing-project-id' };
    }

    let permissions = await this.config.getPermissionsAsync();
    if (permissions.status !== 'granted') {
      permissions = await this.config.requestPermissionsAsync();
    }

    if (permissions.status !== 'granted') {
      return {
        status: 'permission-denied',
        permissionStatus: permissions.status,
      };
    }

    const pushToken = (await this.config.getExpoPushTokenAsync({ projectId })).data;
    const payload = buildPushDeviceUpsertPayload({
      pushToken,
      appId: this.config.getApplicationId(),
      lastSeenAt: this.now(),
      userId: this.config.userId,
    });

    if (!this.config.upsertDevice) {
      return {
        status: 'token-acquired',
        projectId,
        pushToken,
        payload,
      };
    }

    try {
      await this.config.upsertDevice(payload);
      return {
        status: 'registered',
        projectId,
        pushToken,
        payload,
      };
    } catch (error: unknown) {
      if (error instanceof MobileClientError && BACKEND_UNAVAILABLE_ERROR_CODES.has(error.code)) {
        return {
          status: 'backend-unavailable',
          projectId,
          pushToken,
          payload,
          error,
        };
      }

      return {
        status: 'registration-failed',
        projectId,
        pushToken,
        payload,
        error,
      };
    }
  }
}
