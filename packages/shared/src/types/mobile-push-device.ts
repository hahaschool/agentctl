export const MOBILE_PUSH_PLATFORMS = ['ios'] as const;
export type MobilePushPlatform = (typeof MOBILE_PUSH_PLATFORMS)[number];

export function isMobilePushPlatform(value: string): value is MobilePushPlatform {
  return (MOBILE_PUSH_PLATFORMS as readonly string[]).includes(value);
}

export const MOBILE_PUSH_PROVIDERS = ['expo'] as const;
export type MobilePushProvider = (typeof MOBILE_PUSH_PROVIDERS)[number];

export function isMobilePushProvider(value: string): value is MobilePushProvider {
  return (MOBILE_PUSH_PROVIDERS as readonly string[]).includes(value);
}

export type MobilePushDevice = {
  readonly id: string;
  readonly userId: string;
  readonly platform: MobilePushPlatform;
  readonly provider: MobilePushProvider;
  readonly pushToken: string;
  readonly appId: string;
  readonly lastSeenAt: string;
  readonly disabledAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type UpsertMobilePushDeviceRequest = {
  readonly userId: string;
  readonly platform: MobilePushPlatform;
  readonly provider: MobilePushProvider;
  readonly pushToken: string;
  readonly appId: string;
  readonly lastSeenAt?: string;
};

export type UpsertMobilePushDeviceResponse = {
  readonly ok: true;
  readonly device: MobilePushDevice;
};

export type ListMobilePushDevicesResponse = {
  readonly devices: readonly MobilePushDevice[];
};

export type DeactivateMobilePushDeviceResponse = {
  readonly ok: true;
  readonly device: MobilePushDevice;
};
