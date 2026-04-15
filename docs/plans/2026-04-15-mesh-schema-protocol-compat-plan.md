# Mesh Schema + Protocol Compat Plan

**Status:** Partial — backend envelope stamping, apply gate, compat docs, and unit coverage landed in PR #557
**Roadmap:** 33.10 Mesh Schema + Protocol Compat Policy
**Created:** 2026-04-15

## Context

The mesh change-log apply path now carries an explicit schema/protocol
compatibility contract after PR #557. During a rolling upgrade, an older peer
can still receive a change authored against a newer schema, but the apply side
rejects unsupported envelopes before database side effects and leaves the
cursor positioned for retry after the lagging node upgrades.

## Scope

1. Version every sync envelope. *(Delivered in PR #557.)*
   - Include `schemaVersion`, `protocolVersion`, and `producerVersion`.
   - Prefer adding the metadata where sync payloads are serialized, unless a
     trigger-level change is less invasive and easier to verify.

2. Gate apply on compatibility. *(Delivered in PR #557.)*
   - Accept same-version and one-schema-ahead envelopes.
   - Reject envelopes more than one schema version ahead with a typed
     `MESH_ENVELOPE_SCHEMA_AHEAD` error.
   - Reject unknown or out-of-window protocol versions with a typed protocol
     compatibility error.
   - Continue accepting older envelopes until a documented sunset point.

3. Surface operator feedback.
   - Record the peer and reason when apply rejects on compatibility.
   - Show a `/mesh-peers` row warning such as "Peer ahead — update this node".
   - Link to manual upgrade instructions until 33.11 peer-update UI exists.

4. Document the policy. *(Delivered in PR #557.)*
   - Add `docs/MESH_COMPAT.md`.
   - State the one-schema-version skew policy.
   - State protocol deprecation windows and rollout expectations.

## Non-Goals

- Do not implement fleet rollout or auto-update here.
- Do not make destructive migration decisions automatically.
- Do not block older peers from pulling older compatible envelopes.

## Verification

- Unit tests for same, +1, +2, and -1 schema-version apply behavior.
- Unit tests for supported and unsupported protocol versions.
- Integration coverage simulating a rolling upgrade across two peers.
- `/mesh-peers` UI coverage for schema-ahead warnings.
