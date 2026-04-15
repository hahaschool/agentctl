import type { ChangeLogEntry, MeshEnvelopeMeta } from '@agentctl/shared';
import { MESH_PROTOCOL_MAX, MESH_PROTOCOL_MIN, MESH_PROTOCOL_VERSION } from '@agentctl/shared';
import type { Logger } from 'pino';
import { getSchemaVersion } from '../build-info.js';

/**
 * Typed error raised when an inbound mesh envelope carries a `schemaVersion`
 * that is more than one ahead of the local node's shipped migration version.
 *
 * The apply path rejects rather than attempting to half-apply a change whose
 * shape we cannot guarantee we understand. See docs/MESH_COMPAT.md.
 */
export class MeshEnvelopeSchemaAheadError extends Error {
  constructor(
    public readonly code: 'MESH_ENVELOPE_SCHEMA_AHEAD',
    message: string,
    public readonly context: {
      localSchemaVersion: number;
      envelopeSchemaVersion: number;
      producerVersion?: string;
      producerMachineId?: string;
    },
  ) {
    super(message);
    this.name = 'MeshEnvelopeSchemaAheadError';
  }
}

/**
 * Typed error raised when an inbound mesh envelope carries a `protocolVersion`
 * outside the declared compat window `[MESH_PROTOCOL_MIN, MESH_PROTOCOL_MAX]`.
 */
export class MeshProtocolUnsupportedError extends Error {
  constructor(
    public readonly code: 'MESH_PROTOCOL_UNSUPPORTED',
    message: string,
    public readonly context: {
      envelopeProtocolVersion: number;
      supportedMin: number;
      supportedMax: number;
      producerVersion?: string;
      producerMachineId?: string;
    },
  ) {
    super(message);
    this.name = 'MeshProtocolUnsupportedError';
  }
}

let cachedSchemaVersion: number | null = null;

/**
 * Return the local `schemaVersion`, defined as the highest numeric migration
 * prefix shipped with this build. This matches `/health` and avoids treating
 * duplicate or sparse migration numbers as valid schema progress.
 */
export function getLocalSchemaVersion(): number {
  if (cachedSchemaVersion !== null) {
    return cachedSchemaVersion;
  }

  cachedSchemaVersion = getSchemaVersion();
  return cachedSchemaVersion;
}

/**
 * Reset the cached schema version. Test-only helper.
 * @internal
 */
export function __resetSchemaVersionCacheForTests(): void {
  cachedSchemaVersion = null;
}

/** Override the cached schema version. Test-only helper. @internal */
export function __setSchemaVersionForTests(value: number | null): void {
  cachedSchemaVersion = value;
}

/**
 * Validate an inbound envelope's compat metadata before its payload is
 * applied. Throws a typed error on unsupported envelopes; returns silently
 * when the envelope is accepted. Legacy envelopes missing `meta` are accepted
 * with a WARN log for backward compatibility.
 *
 * Policy (see docs/MESH_COMPAT.md):
 * - `schemaVersion` is tolerated at `local ± ∞` below, `local + 1` above.
 *   `local + 2` or higher is rejected.
 * - `protocolVersion` must satisfy `MESH_PROTOCOL_MIN <= v <= MESH_PROTOCOL_MAX`.
 * - Missing `meta` is accepted (legacy producer) but logged at WARN.
 */
export function assertEnvelopeCompat(
  change: ChangeLogEntry,
  localSchemaVersion: number,
  logger?: Logger,
): void {
  const meta = change.meta;
  const producerMachineId = change.nodeId;

  if (!meta) {
    logger?.warn(
      {
        producerMachineId,
        changeId: change.id,
        tableName: change.tableName,
      },
      'Mesh envelope missing meta (legacy producer) — applying for backward compat',
    );
    return;
  }

  const { schemaVersion: envelopeSchemaVersion, protocolVersion, producerVersion } = meta;

  if (
    typeof envelopeSchemaVersion !== 'number' ||
    typeof protocolVersion !== 'number' ||
    typeof producerVersion !== 'string'
  ) {
    logger?.warn(
      {
        producerMachineId,
        changeId: change.id,
        tableName: change.tableName,
        meta,
      },
      'Mesh envelope meta malformed — applying for backward compat',
    );
    return;
  }

  if (protocolVersion < MESH_PROTOCOL_MIN || protocolVersion > MESH_PROTOCOL_MAX) {
    throw new MeshProtocolUnsupportedError(
      'MESH_PROTOCOL_UNSUPPORTED',
      `Mesh protocol version ${protocolVersion} is outside supported window [${MESH_PROTOCOL_MIN}, ${MESH_PROTOCOL_MAX}]`,
      {
        envelopeProtocolVersion: protocolVersion,
        supportedMin: MESH_PROTOCOL_MIN,
        supportedMax: MESH_PROTOCOL_MAX,
        producerVersion,
        producerMachineId,
      },
    );
  }

  if (envelopeSchemaVersion > localSchemaVersion + 1) {
    throw new MeshEnvelopeSchemaAheadError(
      'MESH_ENVELOPE_SCHEMA_AHEAD',
      `Envelope schemaVersion ${envelopeSchemaVersion} exceeds local ${localSchemaVersion} by more than 1`,
      {
        localSchemaVersion,
        envelopeSchemaVersion,
        producerVersion,
        producerMachineId,
      },
    );
  }
}

/**
 * Build the `meta` block this node stamps on every outbound envelope.
 * The caller supplies `producerVersion` (read from package.json).
 */
export function buildLocalEnvelopeMeta(producerVersion: string): MeshEnvelopeMeta {
  return {
    schemaVersion: getLocalSchemaVersion(),
    protocolVersion: MESH_PROTOCOL_VERSION,
    producerVersion,
  };
}
