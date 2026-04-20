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

## Prerequisites

- Two AgentCTL nodes are already running and peered.
- The primary node's web UI can reach its control-plane API.
- The peer row already exists in the primary node's mesh peer registry.
- The peer has already been moved to the expected app version, for example by
  installing a newly pushed tag before running the fixture.

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

Optional polling controls:

```bash
AGENTCTL_MESH_POLL_TIMEOUT_MS=30000
AGENTCTL_MESH_POLL_INTERVAL_MS=1000
```

Without `AGENTCTL_MESH_TWO_NODE_E2E=1`, the spec is skipped. Use
`AGENTCTL_PLAYWRIGHT_NO_WEBSERVER=1` when the primary web UI is already running
outside Playwright's local dev server.

## Follow-Up Coverage

The remaining roadmap assertions should extend the same fixture:

- Force a `schemaVersion + 2` envelope and assert the 33.10 schema-ahead banner.
- Run `agentctl peer update --dry-run` against the peer and assert planned steps
  without changing state.
