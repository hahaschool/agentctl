export const MOBILE_PUSH_DEVICE_PLATFORMS = ['ios'] as const;
export type MobilePushDevicePlatform = (typeof MOBILE_PUSH_DEVICE_PLATFORMS)[number];

export const MOBILE_PUSH_PROVIDERS = ['expo'] as const;
export type MobilePushProvider = (typeof MOBILE_PUSH_PROVIDERS)[number];

export function isMobilePushDevicePlatform(value: string): value is MobilePushDevicePlatform {
  return (MOBILE_PUSH_DEVICE_PLATFORMS as readonly string[]).includes(value);
}

export function isMobilePushProvider(value: string): value is MobilePushProvider {
  return (MOBILE_PUSH_PROVIDERS as readonly string[]).includes(value);
}

export type MobilePushDevice = {
  id: string;
  userId: string;
  platform: MobilePushDevicePlatform;
  provider: MobilePushProvider;
  pushToken: string;
  appId: string;
  lastSeenAt: string;
  disabledAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type UpsertMobilePushDeviceRequest = {
  userId: string;
  platform: MobilePushDevicePlatform;
  provider: MobilePushProvider;
  pushToken: string;
  appId: string;
  lastSeenAt?: string;
};

export type ListMobilePushDevicesQuery = {
  userId?: string;
  includeDisabled?: boolean;
  platform?: MobilePushDevicePlatform;
  provider?: MobilePushProvider;
};

export type DeactivateMobilePushDeviceRequest = {
  disabledAt?: string;
};
