/**
 * §33.12 Phase 2 — Dynamic mesh configuration provider.
 *
 * Replaces static startup configuration with a resolution chain that reads
 * from `mesh_local_config` (DB) → env vars → auto-detected values. The DB
 * layer wins when a value is present, allowing runtime config changes via
 * the web UI without restarting the control plane.
 */

import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { Database } from '../db/index.js';
import { meshLocalConfig } from '../db/schema.js';
import { isValidTailscaleIp } from '../sync/peer-discovery.js';

// ── Config keys ────────────────────────────────────────────────

const CONFIG_KEYS = {
  TAILSCALE_IP_OVERRIDE: 'tailscale_ip_override',
  SYNC_URL_OVERRIDE: 'sync_url_override',
  REGISTRATION_TOKEN: 'registration_token',
} as const;

// ── Types ──────────────────────────────────────────────────────

export type MeshConfigSource = 'db' | 'env' | 'auto-detect' | 'derived';

export type MeshConfig = {
  tailscaleIp: string | null;
  tailscaleIpSource: MeshConfigSource | null;
  syncUrl: string;
  syncUrlSource: MeshConfigSource;
  registrationToken: string | null;
  registrationTokenSource: 'db' | 'env' | null;
};

export type MeshConfigInput = {
  tailscaleIpOverride?: string | null;
  syncUrlOverride?: string | null;
  registrationToken?: string | null;
};

// ── Provider ───────────────────────────────────────────────────

export class MeshConfigProvider {
  private readonly db: Database;
  private readonly autoDetectedIp: string | null;
  private readonly port: number;
  private readonly controlPlaneUrl: string;
  private readonly logger: Logger;

  constructor(opts: {
    db: Database;
    autoDetectedIp: string | null;
    port: number;
    controlPlaneUrl: string;
    logger: Logger;
  }) {
    this.db = opts.db;
    this.autoDetectedIp = opts.autoDetectedIp;
    this.port = opts.port;
    this.controlPlaneUrl = opts.controlPlaneUrl;
    this.logger = opts.logger.child({ component: 'mesh-config' });
  }

  /**
   * Resolve current mesh config using the priority chain:
   *   DB override → env var → auto-detect → fallback
   */
  async resolve(): Promise<MeshConfig> {
    const dbValues = await this.readDbConfig();

    // 1. Tailscale IP: DB → env → auto-detect
    const tailscaleIp = this.resolveTailscaleIp(dbValues);

    // 2. Sync URL: DB → derived from Tailscale IP → CONTROL_PLANE_URL
    const syncUrl = this.resolveSyncUrl(dbValues, tailscaleIp.value);

    // 3. Registration token: DB → env
    const token = this.resolveRegistrationToken(dbValues);

    return {
      tailscaleIp: tailscaleIp.value,
      tailscaleIpSource: tailscaleIp.source,
      syncUrl: syncUrl.value,
      syncUrlSource: syncUrl.source,
      registrationToken: token.value,
      registrationTokenSource: token.source,
    };
  }

  /**
   * Update mesh config in `mesh_local_config`. Null values clear the
   * override (reverts to env/auto-detect). Returns the resolved config
   * after the update.
   */
  async update(changes: MeshConfigInput): Promise<MeshConfig> {
    const entries: Array<{ key: string; value: string | null }> = [];

    if (changes.tailscaleIpOverride !== undefined) {
      entries.push({
        key: CONFIG_KEYS.TAILSCALE_IP_OVERRIDE,
        value: changes.tailscaleIpOverride,
      });
    }
    if (changes.syncUrlOverride !== undefined) {
      entries.push({
        key: CONFIG_KEYS.SYNC_URL_OVERRIDE,
        value: changes.syncUrlOverride,
      });
    }
    if (changes.registrationToken !== undefined) {
      entries.push({
        key: CONFIG_KEYS.REGISTRATION_TOKEN,
        value: changes.registrationToken,
      });
    }

    for (const entry of entries) {
      if (entry.value === null) {
        await this.db.delete(meshLocalConfig).where(eq(meshLocalConfig.key, entry.key));
      } else {
        await this.db
          .insert(meshLocalConfig)
          .values({ key: entry.key, value: entry.value, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: meshLocalConfig.key,
            set: { value: entry.value, updatedAt: new Date() },
          });
      }
    }

    this.logger.info({ keys: entries.map((e) => e.key) }, 'Mesh config updated');

    return this.resolve();
  }

  // ── Private helpers ────────────────────────────────────────────

  private async readDbConfig(): Promise<Map<string, string>> {
    const rows = await this.db
      .select({ key: meshLocalConfig.key, value: meshLocalConfig.value })
      .from(meshLocalConfig);

    const map = new Map<string, string>();
    for (const row of rows) {
      if (row.value !== null) {
        map.set(row.key, row.value);
      }
    }
    return map;
  }

  private resolveTailscaleIp(dbValues: Map<string, string>): {
    value: string | null;
    source: MeshConfigSource | null;
  } {
    // DB override
    const dbIp = dbValues.get(CONFIG_KEYS.TAILSCALE_IP_OVERRIDE);
    if (dbIp && isValidTailscaleIp(dbIp)) {
      return { value: dbIp, source: 'db' };
    }
    if (dbIp) {
      this.logger.warn(
        { dbValue: dbIp },
        'mesh_local_config tailscale_ip_override is invalid — skipping',
      );
    }

    // Env var
    const envIp = process.env.TAILSCALE_IP;
    if (envIp && isValidTailscaleIp(envIp)) {
      return { value: envIp, source: 'env' };
    }

    // Auto-detect (cached from startup)
    if (this.autoDetectedIp) {
      return { value: this.autoDetectedIp, source: 'auto-detect' };
    }

    return { value: null, source: null };
  }

  private resolveSyncUrl(
    dbValues: Map<string, string>,
    tailscaleIp: string | null,
  ): { value: string; source: MeshConfigSource } {
    // DB override
    const dbUrl = dbValues.get(CONFIG_KEYS.SYNC_URL_OVERRIDE);
    if (dbUrl) {
      return { value: dbUrl, source: 'db' };
    }

    // Env var (CONTROL_PLANE_URL set explicitly)
    if (process.env.CONTROL_PLANE_URL) {
      return { value: process.env.CONTROL_PLANE_URL, source: 'env' };
    }

    // Derived from Tailscale IP
    if (tailscaleIp) {
      return {
        value: `http://${tailscaleIp}:${String(this.port)}`,
        source: 'derived',
      };
    }

    // Fallback
    return { value: this.controlPlaneUrl, source: 'derived' };
  }

  private resolveRegistrationToken(dbValues: Map<string, string>): {
    value: string | null;
    source: 'db' | 'env' | null;
  } {
    // DB override
    const dbToken = dbValues.get(CONFIG_KEYS.REGISTRATION_TOKEN);
    if (dbToken) {
      return { value: dbToken, source: 'db' };
    }

    // Env var (either name)
    const envToken =
      process.env.SYNC_PEER_REVERSE_REGISTRATION_TOKEN ?? process.env.SYNC_PEER_REGISTRATION_TOKEN;
    if (envToken) {
      return { value: envToken, source: 'env' };
    }

    return { value: null, source: null };
  }
}
