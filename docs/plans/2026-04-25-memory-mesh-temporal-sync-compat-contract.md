# Memory Mesh Temporal Sync Compatibility Contract

**Status:** Current contract before any drawer sync or temporal `memory_edges` payload work
**Roadmap:** 3.6 / 4.8 / 7.3 MemPalace-Inspired Memory Evolution
**Created:** 2026-04-25
**Checkpoint:** `main@0d507c5d` is current through PR #862. PR #853 introduced this contract, PR #854 moved aggregate-only private memory eval fixture validation into the Memory Evals workflow before live runs, PR #855 added dry-run canonicalization proposals without mesh sync or fact/edge mutations, PR #857 added private eval fixture/changelog scaffold tooling, PR #858 added the first read-only memory timeline API slice without schema or mesh payload changes, PR #859 added dry-run Memory Operations rollout preflight tooling, PR #861 hardened equivalent `as_of`/`asOf` timeline aliases, PR #862 added the worker MCP timeline route without schema or mesh payload changes, and post-#862 main CI `24931385074`, Security Audit `24931385101`, and Build & Publish Docker Images `24931385068` passed.

## Context

- `memory_edges` is a synced table today. `packages/control-plane/drizzle/0021_mesh_change_log.sql` attaches `sync_capture_change('id')`, and that trigger serializes `to_jsonb(NEW)` for INSERT/UPDATE and `NULL` for DELETE.
- `memory_drawers` exists via `0030_add_memory_drawers.sql`, but no `sync_capture` trigger is attached today. Drawer rows are local-only until a later PR says otherwise.
- Mesh envelopes already carry schema/protocol metadata. `docs/MESH_COMPAT.md` documents the current policy: accept same-schema and `local + 1`, reject `local + 2` with `MESH_ENVELOPE_SCHEMA_AHEAD`, continue accepting older envelopes, and keep the current protocol window at `[1, 1]`.

## Contract

1. No implicit sync payload expansion.
   - Adding a column to `memory_edges` while it still syncs `to_jsonb(NEW)` is a mesh payload change.
   - Adding a `sync_capture` trigger to `memory_drawers` is also a mesh payload change.
   - Neither may ship as a "schema-only" or "local-only" follow-up.

2. Drawer sync default.
   - `memory_drawers` stays unsynced on `main`, `dev-1`, `dev-2`, and beta until a later PR defines an explicit drawer envelope.
   - Local drawer search, provenance, import, and injection work may keep using the table locally without changing mesh behavior.
   - Any future drawer-sync proposal must specify exact synced fields, sanitization/redaction expectations, retention behavior, and payload size constraints before a trigger is added.

3. Temporal edge fields default.
   - Future `memory_edges.valid_from`, `valid_until`, `source_drawer_id`, `confidence`, or similar temporal/provenance columns remain local-only or unused until the producer path is explicit.
   - A later schema PR must choose one of two models before merge:
     - explicit payload projection that keeps new columns out of mesh envelopes, or
     - version-gated envelope expansion that intentionally syncs them.
   - "Whole-row trigger now, compat later" is not allowed.

4. Schema-version and protocol gates.
   - If a later PR intentionally changes synced payload shape, it must use the existing 33.10 compat policy: same-schema and `local + 1` accepted, `local + 2` rejected, older envelopes accepted, protocol window `[1, 1]` until widened.
   - Legacy envelopes without `meta` stay accepted unless `docs/MESH_COMPAT.md` is explicitly updated to deprecate that tolerance on a separate timeline.
   - Any protocol change must widen the protocol window deliberately; it cannot piggyback on drawer or temporal-field work silently.

5. Forward/backward compatibility rules.
   - New readers must tolerate missing temporal or drawer fields.
   - Old readers must not receive new temporal or drawer fields unless the version gate, apply tests, and operator guidance are already in place.
   - Until mixed-version testing passes, no runtime path may require peers to replicate or query drawer content or temporal edge fields for correctness.

6. Environment non-disruption.
   - `dev-1`, `dev-2`, and beta must remain behaviorally identical to current `main` for mesh payloads while this work is still docs-only: no drawer sync trigger, no temporal edge payload expansion, and no protocol bump.
   - Beta stays on the existing promotion stack; later drawer or temporal sync work must first prove mixed-version safety outside beta.
   - Rollout verification belongs in isolated local or two-node fixtures, or in opt-in dev environments, not in opportunistic beta drift.

7. Rollout sequence for later schema work.
   - Step 1: land the schema columns and keep them local-only, or land an explicit payload projection that preserves old envelopes.
   - Step 2: add or update compat tests for same-schema, `local + 1`, `local + 2`, and legacy/no-`meta` behavior.
   - Step 3: prove mixed-version apply behavior in the existing two-node mesh coverage before enabling any new producer payload.
   - Step 4: enable the new payload in `dev-1`, then `dev-2`, with operator-visible rollback instructions.
   - Step 5: promote to beta only after the mixed-version window is proven non-disruptive and the operator path is documented.

8. Rollback rules.
   - Before any new sync trigger or payload projection ships, rollback means keeping the new columns unused or feature-flagged off.
   - After a version-gated payload change ships, rollback follows `docs/MESH_COMPAT.md`: stop the ahead producer first, let lagging peers catch up or roll back through the documented schema-ahead remediation path, and avoid destructive column removal during the skew window.
   - Do not depend on a beta-only hotfix to restore compat after a drawer or temporal payload break.

## Must Be True Before Later Schema Work Starts

- A written decision exists on whether drawer content syncs at all.
- The exact synced fields or payload format are enumerated.
- Mixed-version tests cover same-schema, `+1`, `+2`, and legacy/no-`meta`.
- Operator rollout and rollback steps are written for `dev-1`, `dev-2`, and beta.
- The MemPalace plan and roadmap rows point at the same contract.
