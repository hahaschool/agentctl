import type {
  DeactivateMobilePushDeviceRequest,
  ListMobilePushDevicesQuery,
  MobilePushDevice,
  MobilePushProvider,
  UpsertMobilePushDeviceRequest,
} from '@agentctl/shared';
import { ControlPlaneError } from '@agentctl/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';
import { mobilePushDevices } from '../db/index.js';

type DeactivateByTokenInput = {
  provider: MobilePushProvider;
  pushToken: string;
  disabledAt?: string;
};

export class MobilePushDeviceStore {
  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
  ) {}

  async listDevices(filters: ListMobilePushDevicesQuery = {}): Promise<MobilePushDevice[]> {
    const conditions = [];

    if (filters.userId) {
      conditions.push(eq(mobilePushDevices.userId, filters.userId));
    }
    if (filters.platform) {
      conditions.push(eq(mobilePushDevices.platform, filters.platform));
    }
    if (filters.provider) {
      conditions.push(eq(mobilePushDevices.provider, filters.provider));
    }
    if (!filters.includeDisabled) {
      conditions.push(isNull(mobilePushDevices.disabledAt));
    }

    const baseQuery = this.db.select().from(mobilePushDevices);
    const rows =
      conditions.length > 0
        ? await baseQuery
            .where(conditions.length === 1 ? conditions[0] : and(...conditions))
            .orderBy(desc(mobilePushDevices.updatedAt))
        : await baseQuery.orderBy(desc(mobilePushDevices.updatedAt));

    return rows.map((row) => this.toDevice(row));
  }

  async listActiveDevices(
    filters: Omit<ListMobilePushDevicesQuery, 'includeDisabled'> = {},
  ): Promise<MobilePushDevice[]> {
    return await this.listDevices({ ...filters, includeDisabled: false });
  }

  async upsertDevice(input: UpsertMobilePushDeviceRequest): Promise<MobilePushDevice> {
    const lastSeenAt = parseTimestamp(input.lastSeenAt, 'lastSeenAt', true);

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
        updatedAt: lastSeenAt,
      })
      .onConflictDoUpdate({
        target: [mobilePushDevices.provider, mobilePushDevices.pushToken],
        set: {
          userId: input.userId,
          platform: input.platform,
          appId: input.appId,
          lastSeenAt,
          disabledAt: null,
          updatedAt: lastSeenAt,
        },
      })
      .returning();

    if (rows.length === 0) {
      throw new ControlPlaneError('DEVICE_UPSERT_FAILED', 'Failed to upsert mobile push device', {
        input,
      });
    }

    this.logger.info(
      { deviceId: rows[0].id, userId: input.userId, provider: input.provider },
      'Mobile push device upserted',
    );
    return this.toDevice(rows[0]);
  }

  async deactivateDevice(
    id: string,
    input: DeactivateMobilePushDeviceRequest = {},
  ): Promise<MobilePushDevice> {
    const disabledAt = parseTimestamp(input.disabledAt, 'disabledAt');

    const rows = await this.db
      .update(mobilePushDevices)
      .set({
        disabledAt,
        updatedAt: disabledAt,
      })
      .where(eq(mobilePushDevices.id, id))
      .returning();

    if (rows.length === 0) {
      throw new ControlPlaneError('DEVICE_NOT_FOUND', `Mobile push device '${id}' does not exist`, {
        id,
      });
    }

    this.logger.info({ deviceId: id }, 'Mobile push device deactivated');
    return this.toDevice(rows[0]);
  }

  async deactivateByToken(input: DeactivateByTokenInput): Promise<MobilePushDevice> {
    const disabledAt = parseTimestamp(input.disabledAt, 'disabledAt');

    const rows = await this.db
      .update(mobilePushDevices)
      .set({
        disabledAt,
        updatedAt: disabledAt,
      })
      .where(
        and(
          eq(mobilePushDevices.provider, input.provider),
          eq(mobilePushDevices.pushToken, input.pushToken),
        ),
      )
      .returning();

    if (rows.length === 0) {
      throw new ControlPlaneError(
        'DEVICE_NOT_FOUND',
        `Mobile push device '${input.provider}:${input.pushToken}' does not exist`,
        { provider: input.provider, pushToken: input.pushToken },
      );
    }

    this.logger.info(
      { deviceId: rows[0].id, provider: input.provider },
      'Mobile push device deactivated by token',
    );
    return this.toDevice(rows[0]);
  }

  private toDevice(row: typeof mobilePushDevices.$inferSelect): MobilePushDevice {
    return {
      id: row.id,
      userId: row.userId,
      platform: row.platform,
      provider: row.provider,
      pushToken: row.pushToken,
      appId: row.appId,
      lastSeenAt: row.lastSeenAt.toISOString(),
      disabledAt: row.disabledAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

function parseTimestamp(value: string | undefined, fieldName: string, useNow = false): Date {
  if (!value) {
    return useNow ? new Date() : new Date();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ControlPlaneError(
      'INVALID_TIMESTAMP',
      `"${fieldName}" must be a valid ISO timestamp`,
      { fieldName, value },
    );
  }

  return parsed;
}
