import type { MobilePushDevice, MobilePushPlatform, MobilePushProvider } from '@agentctl/shared';
import { ControlPlaneError } from '@agentctl/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';
import { mobilePushDevices } from '../db/index.js';

export type UpsertMobilePushDeviceInput = {
  readonly userId: string;
  readonly platform: MobilePushPlatform;
  readonly provider: MobilePushProvider;
  readonly pushToken: string;
  readonly appId: string;
  readonly lastSeenAt?: Date | null;
};

export type ListMobilePushDevicesInput = {
  readonly userId?: string;
  readonly includeDisabled?: boolean;
  readonly platform?: MobilePushPlatform;
  readonly provider?: MobilePushProvider;
};

export type DeactivateMobilePushDeviceByTokenInput = {
  readonly provider: MobilePushProvider;
  readonly pushToken: string;
  readonly disabledAt?: Date;
};

export class MobilePushDeviceStore {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  async upsertDevice(input: UpsertMobilePushDeviceInput): Promise<MobilePushDevice> {
    const now = new Date();
    const lastSeenAt = input.lastSeenAt ?? now;

    const rows = await this.db
      .insert(mobilePushDevices)
      .values({
        userId: input.userId,
        platform: input.platform,
        provider: input.provider,
        pushToken: input.pushToken,
        appId: input.appId,
        lastSeenAt,
        disabledAt: null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [mobilePushDevices.provider, mobilePushDevices.pushToken],
        set: {
          userId: input.userId,
          platform: input.platform,
          appId: input.appId,
          lastSeenAt,
          disabledAt: null,
          updatedAt: now,
        },
      })
      .returning();

    const row = rows[0];
    if (!row) {
      throw new ControlPlaneError(
        'MOBILE_PUSH_DEVICE_UPSERT_FAILED',
        'Failed to upsert mobile push device',
        { input },
      );
    }

    this.logger.info(
      {
        deviceId: row.id,
        userId: row.userId,
        platform: row.platform,
        provider: row.provider,
      },
      'Mobile push device upserted',
    );

    return mapMobilePushDevice(row);
  }

  async listDevices(input: ListMobilePushDevicesInput = {}): Promise<MobilePushDevice[]> {
    const conditions = [];

    if (input.userId) {
      conditions.push(eq(mobilePushDevices.userId, input.userId));
    }
    if (!input.includeDisabled) {
      conditions.push(isNull(mobilePushDevices.disabledAt));
    }
    if (input.platform) {
      conditions.push(eq(mobilePushDevices.platform, input.platform));
    }
    if (input.provider) {
      conditions.push(eq(mobilePushDevices.provider, input.provider));
    }

    const rows =
      conditions.length === 0
        ? await this.db.select().from(mobilePushDevices).orderBy(desc(mobilePushDevices.updatedAt))
        : await this.db
            .select()
            .from(mobilePushDevices)
            .where(conditions.length === 1 ? conditions[0] : and(...conditions))
            .orderBy(desc(mobilePushDevices.updatedAt));

    return rows.map(mapMobilePushDevice);
  }

  async deactivateDevice(id: string, disabledAt = new Date()): Promise<MobilePushDevice> {
    const rows = await this.db
      .update(mobilePushDevices)
      .set({
        disabledAt,
        updatedAt: new Date(),
      })
      .where(eq(mobilePushDevices.id, id))
      .returning();

    const row = rows[0];
    if (!row) {
      throw new ControlPlaneError(
        'MOBILE_PUSH_DEVICE_NOT_FOUND',
        `Mobile push device '${id}' does not exist`,
        { id },
      );
    }

    this.logger.info({ deviceId: id }, 'Mobile push device deactivated');
    return mapMobilePushDevice(row);
  }

  async deactivateByToken(
    input: DeactivateMobilePushDeviceByTokenInput,
  ): Promise<MobilePushDevice> {
    const disabledAt = input.disabledAt ?? new Date();
    const rows = await this.db
      .update(mobilePushDevices)
      .set({
        disabledAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(mobilePushDevices.provider, input.provider),
          eq(mobilePushDevices.pushToken, input.pushToken),
        ),
      )
      .returning();

    const row = rows[0];
    if (!row) {
      throw new ControlPlaneError(
        'MOBILE_PUSH_DEVICE_NOT_FOUND',
        `Mobile push device '${input.provider}:${input.pushToken}' does not exist`,
        { provider: input.provider, pushToken: input.pushToken },
      );
    }

    this.logger.info(
      { deviceId: row.id, provider: input.provider },
      'Mobile push device deactivated by token',
    );
    return mapMobilePushDevice(row);
  }
}

function mapMobilePushDevice(row: typeof mobilePushDevices.$inferSelect): MobilePushDevice {
  return {
    id: row.id,
    userId: row.userId,
    platform: row.platform,
    provider: row.provider,
    pushToken: row.pushToken,
    appId: row.appId,
    lastSeenAt: (row.lastSeenAt ?? new Date()).toISOString(),
    disabledAt: row.disabledAt ? row.disabledAt.toISOString() : null,
    createdAt: (row.createdAt ?? new Date()).toISOString(),
    updatedAt: (row.updatedAt ?? new Date()).toISOString(),
  };
}
