# Playwright Two-Node Mesh Fixture

This fixture is an opt-in live check for roadmap 33.8/33.11 mesh work. It is
not part of the default web E2E lane and does not start Docker or mutate
dev/beta/prod CD behavior.

The first slice verifies the 33.11 version-drift path:

1. Open the primary node's `/mesh-peers` page.
2. Trigger one live peer ping through the primary node.
3. Poll `GET /api/sync/peers` until the configured peer reports the expected
   `peerVersion`.
4. Reload `/mesh-peers` and assert that the row and update-available banner show
   the expected version.

The second slice is separately gated and verifies the 33.8 A-to-B machine
visibility path:

1. Open the secondary node's `/machines` page.
2. Search for a machine row that was authored on the primary node and already
   replicated to the secondary node.
3. Assert that the row is visible and carries the `Synced from ...` provenance
   badge for the configured primary-node label.

The third slice is separately gated and verifies the peer-update dry-run path:

1. Call the primary node's `POST /api/mesh/auto-update/dry-run` SSE endpoint.
2. Assert that the streamed command is `pnpm agentctl peer update --dry-run`.
3. Parse the emitted JSON result and assert that the run succeeded, every
   planned step is marked `dryRun`, and the expected update steps are reported.

The fourth slice is separately gated and verifies the schema-ahead rejection path:

1. Read the primary node's `schemaVersion` from `GET /api/version-compat`.
2. Inject a synthetic mesh envelope with `schemaVersion + 2` through the
   primary node's real `applyChange()` compat gate.
3. Persist the same `MESH_ENVELOPE_SCHEMA_AHEAD` rejection marker that the sync
   loop writes for a real peer pull.
4. Reload `/mesh-peers` and assert that the 33.10 schema-ahead badge appears on
   the configured peer row.

## Prerequisites

- Two AgentCTL nodes are already running and peered.
- The primary node's web UI can reach its control-plane API.
- The peer row already exists in the primary node's mesh peer registry.
- The peer has already been moved to the expected app version, for example by
  installing a newly pushed tag before running the fixture.
- For the dry-run assertion, the primary node's control plane must expose
  `/api/mesh/auto-update/dry-run` and be able to run `pnpm agentctl peer update
  --dry-run` from its configured repository root. The command must complete with
  exit code 0.
- For the A-to-B machine visibility assertion, provide the secondary node web
  URL plus a machine hostname that originated on the primary node and has
  already replicated to the secondary node. The fixture asserts the browser row
  and its `Synced from ...` provenance badge only when
  `AGENTCTL_MESH_MACHINE_VISIBILITY_E2E=1` is set.
- For the schema-ahead assertion, provide the primary node database URL through
  `AGENTCTL_MESH_PRIMARY_DATABASE_URL`. The fixture uses it only when
  `AGENTCTL_MESH_SCHEMA_AHEAD_E2E=1` is also set.

## Run

From the repository root:

```bash
AGENTCTL_PLAYWRIGHT_NO_WEBSERVER=1 \
AGENTCTL_MESH_TWO_NODE_E2E=1 \
AGENTCTL_MESH_PRIMARY_WEB_URL=http://localhost:5173 \
AGENTCTL_MESH_PRIMARY_API_URL=http://localhost:8080 \
AGENTCTL_MESH_PEER_MACHINE_ID=macmini \
AGENTCTL_MESH_EXPECTED_PEER_VERSION=v0.7.1 \
pnpm --filter @agentctl/web exec playwright test \
  e2e/mesh-two-node.fixture.spec.ts \
  --project=chromium \
  --reporter=line
```

`AGENTCTL_MESH_PRIMARY_API_URL` is optional. When omitted, the fixture calls the
primary web URL's `/api/*` paths and relies on the web proxy.

The dry-run assertion is disabled by default even when the live two-node fixture
is enabled. Add this flag to run it:

```bash
AGENTCTL_MESH_DRY_RUN_E2E=1
```

The A-to-B machine visibility assertion is disabled by default. Add these flags
to run it against an already-replicated machine row:

```bash
AGENTCTL_MESH_MACHINE_VISIBILITY_E2E=1
AGENTCTL_MESH_SECONDARY_WEB_URL=http://localhost:5174
AGENTCTL_MESH_SYNCED_MACHINE_HOSTNAME=primary-laptop
AGENTCTL_MESH_SYNCED_MACHINE_ORIGIN_LABEL=pinnacle-laptop
```

The schema-ahead assertion is also disabled by default. Add these flags to run
it:

```bash
AGENTCTL_MESH_SCHEMA_AHEAD_E2E=1
AGENTCTL_MESH_PRIMARY_DATABASE_URL=postgresql://...
```

Optional polling controls:

```bash
AGENTCTL_MESH_POLL_TIMEOUT_MS=30000
AGENTCTL_MESH_POLL_INTERVAL_MS=1000
AGENTCTL_MESH_DRY_RUN_TIMEOUT_MS=60000
AGENTCTL_MESH_SCHEMA_AHEAD_TIMEOUT_MS=30000
AGENTCTL_MESH_MACHINE_VISIBILITY_TIMEOUT_MS=30000
```

Without `AGENTCTL_MESH_TWO_NODE_E2E=1`, the spec is skipped. Use
`AGENTCTL_PLAYWRIGHT_NO_WEBSERVER=1` when the primary web UI is already running
outside Playwright's local dev server.

## Follow-Up Coverage

Remaining 33.8 browser assertions are add-peer/reverse-registration and the
one-way warning/retry failure path.

The remaining 33.11 rollout item is outside this Playwright fixture: exercise
`deploy-fleet.yml` first in dry-run, then in canary mode against a non-critical
target.
