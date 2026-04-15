# Mesh Schema + Protocol Compatibility Policy

Roadmap tracker: [33.10 Mesh Schema + Protocol Compat Policy (P0)](./ROADMAP.md#3310-mesh-schema--protocol-compat-policy-p0--planned).
Related: [33.9 Mesh Version Observability (P1)](./ROADMAP.md#339-mesh-version-observability-p1--planned).

## Scope

Every mesh envelope (one row returned by `GET /api/sync/changes`) carries a
`meta` block with three required fields:

```ts
type MeshEnvelopeMeta = {
  schemaVersion: number;      // producer's highest applied migration seq
  protocolVersion: number;    // mesh wire-format version (starts at 1)
  producerVersion: string;    // producer's appVersion, e.g. "0.4.0"
};
```

The **apply-side compat gate** lives in
`packages/control-plane/src/sync/mesh-compat.ts` and is invoked by
`apply-change.ts` before any database side effect.

**What the gate does:**

- Rejects envelopes whose `schemaVersion` is more than one ahead of the local
  schema.
- Rejects envelopes whose `protocolVersion` is outside the declared window.
- Accepts envelopes with missing/malformed `meta` (legacy producers) with a
  WARN log, for backward compat.
- Accepts envelopes whose `schemaVersion` is lower than local.

**What the gate does not do:**

- It does not attempt to rewrite, migrate, or "fix up" envelope payloads.
  Unsupported envelopes are rejected; they will be re-pulled after the local
  node has itself caught up.
- It does not enforce `producerVersion` — that field is informational
  (surfaced on `/mesh-peers` once 33.9 lands).
- It does not authenticate the producer; that is handled separately by
  `sync-auth.ts`.

## Policy

### `schemaVersion` skew: ±1 during rolling updates

- **Definition** — `schemaVersion` is the count of `.sql` files in the
  producer's `packages/control-plane/drizzle/` directory, matching
  roadmap 33.9's definition of "highest applied migration sequence number".
- **Tolerance** — an inbound envelope is accepted when
  `envelope.schemaVersion <= localSchemaVersion + 1`. This covers the normal
  rolling-update window: one peer has picked up a new migration, others are
  still catching up.
- **Operator expectation** — operators SHOULD complete a fleet update within
  **one heartbeat cycle** (default: `30 s × peer count`). After that window,
  nothing breaks — backward compat still accepts old envelopes — but the
  producer risks falling more than one schema ahead of laggard peers and
  having its envelopes rejected until the laggards are updated.
- **Rejection** — envelopes with `schemaVersion > localSchemaVersion + 1` are
  rejected with `MESH_ENVELOPE_SCHEMA_AHEAD`. The sync loop stops advancing
  the cursor at the last-successfully-applied change, so the rejected
  envelope will be re-offered on the next pull.

### Backward-compat sunset

Envelopes older than local (`envelope.schemaVersion < localSchemaVersion`)
continue to apply indefinitely. There is no automatic sunset. Sunset decisions
are explicit and require:

1. A roadmap entry noting the sunset target version.
2. A deprecation note in this document at least one minor release ahead.
3. A code change in `mesh-compat.ts` to tighten the lower bound.

### `protocolVersion` deprecation window

- **Current window** — `MESH_PROTOCOL_MIN = 1`, `MESH_PROTOCOL_MAX = 1`.
  Exported from `@agentctl/shared`.
- **Widening policy** — when the wire format changes, bump
  `MESH_PROTOCOL_VERSION` to 2, raise `MESH_PROTOCOL_MAX` to 2, and **keep**
  `MESH_PROTOCOL_MIN` at 1 for one full minor-version window. Example:
  ship v2 in 0.5.0, keep accepting v1 through 0.5.x, bump
  `MESH_PROTOCOL_MIN` to 2 in 0.6.0.
- **Rejection** — envelopes with `protocolVersion` outside the window fail
  with `MESH_PROTOCOL_UNSUPPORTED`.

## Error codes

| Code                          | When it is raised                                                                   | What to do                                                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `MESH_ENVELOPE_SCHEMA_AHEAD`  | `envelope.schemaVersion > localSchemaVersion + 1`                                   | Update the local node's migrations (it is the laggard). The producer's envelopes will apply cleanly on the next sync cycle. |
| `MESH_PROTOCOL_UNSUPPORTED`   | `envelope.protocolVersion` outside `[MESH_PROTOCOL_MIN, MESH_PROTOCOL_MAX]`         | Check `MESH_COMPAT.md` and `@agentctl/shared` for the current window, then upgrade whichever side is lagging.                |

Both errors carry a `context` block including `producerMachineId`,
`producerVersion`, and the offending version numbers. Operators can correlate
the rejected envelope with the peer on `/mesh-peers` once 33.9 renders peer
versions there.

## Implementation pointers

- Type + constants — `packages/shared/src/types/sync.ts`
  (`MeshEnvelopeMeta`, `MESH_PROTOCOL_VERSION`, `MESH_PROTOCOL_MIN`,
  `MESH_PROTOCOL_MAX`).
- Apply gate — `packages/control-plane/src/sync/mesh-compat.ts`
  (`assertEnvelopeCompat`, `getLocalSchemaVersion`,
  `MeshEnvelopeSchemaAheadError`, `MeshProtocolUnsupportedError`).
- Producer stamp — `packages/control-plane/src/api/routes/sync.ts`
  (`mapChangeLogRow` calls `buildLocalEnvelopeMeta` at serialize time; no
  trigger or migration change was required).
- Apply integration — `packages/control-plane/src/sync/apply-change.ts`
  (`applyChange` calls `assertEnvelopeCompat` before routing to append-only
  or mutable logic).
- Tests — `packages/control-plane/src/sync/apply-change.compat.test.ts`.
