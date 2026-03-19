import type { ApiClient } from './api-client.js';
import { requestWithApiClient } from './request-with-api-client.js';

export type MobilePushDeviceUpsertRequest = {
  userId: string;
  platform: 'ios';
  provider: 'expo';
  pushToken: string;
  appId: string;
  lastSeenAt: string;
};

export class MobilePushDeviceApi {
  constructor(private readonly apiClient: ApiClient) {}

  async upsertDevice(payload: MobilePushDeviceUpsertRequest): Promise<unknown> {
    return requestWithApiClient<unknown>(
      this.apiClient,
      'POST',
      '/api/mobile-push-devices',
      payload,
    );
  }
}
