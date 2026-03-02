# Tailscale Mesh Networking -- AgentCTL Fleet

## Overview

AgentCTL uses a Tailscale WireGuard mesh to connect all machines in the fleet.
Every device -- control plane servers, agent workers, iOS clients, CI runners,
and developer laptops -- joins a single tailnet and is assigned a tag that
determines what it can reach.

### Topology

```
                 tag:mobile (iPhone / iPad)
                       |
                       | :8080
                       v
  tag:dev -----> tag:control (control plane)  <----- tag:ci (:22)
  (all ports)    |  :5432 PostgreSQL           |
                 |  :6379 Redis                |
                 |  :4000 LiteLLM              |
                 |  :8000 Mem0                 |
                 |  :8080 API                  |
                 |                             |
                 | :9000                       | :22
                 v                             v
            tag:worker  ----X----  tag:worker
            (isolated)             (isolated)
```

Key constraints enforced by the ACL policy:

- Workers **cannot** communicate with other workers (lateral isolation).
- Mobile devices **cannot** reach workers; all traffic routes through the
  control plane.
- CI runners can only reach SSH (port 22) on control and worker nodes.
- Only `tag:dev` machines have unrestricted access (development convenience).

## Files

| File             | Purpose                                   |
|------------------|-------------------------------------------|
| `acl-policy.json`| Tailscale ACL policy (JSON with comments) |

## Applying the ACL Policy

### Via the admin console (recommended for first-time setup)

1. Open <https://login.tailscale.com/admin/acls/file>.
2. Replace the entire contents with `acl-policy.json`.
3. Click **Save**. Tailscale runs the embedded tests automatically; the save
   will fail if any test does not pass.

### Via the Tailscale API

```bash
# Set your API key (never commit this value)
export TS_API_KEY="tskey-api-..."

# Your tailnet name (e.g., "example.com" or "user@github")
export TS_TAILNET="your-tailnet"

curl -X POST "https://api.tailscale.com/api/v2/tailnet/${TS_TAILNET}/acl" \
  -H "Authorization: Bearer ${TS_API_KEY}" \
  -H "Content-Type: application/hujson" \
  --data-binary @acl-policy.json
```

### Via the `tailscale` CLI (preview/validate only)

```bash
# Validate the policy without applying it
tailscale policy validate acl-policy.json
```

## Tagging Machines

Tags are assigned when a machine authenticates or re-authenticates with
Tailscale. Only admin users can assign tags (configured in `tagOwners`).

### Control plane

```bash
sudo tailscale up --advertise-tags=tag:control --hostname=agentctl-control
```

### Agent worker

```bash
sudo tailscale up --advertise-tags=tag:worker --hostname=agentctl-worker-01
```

### Development machine

```bash
sudo tailscale up --advertise-tags=tag:dev --hostname=dev-laptop
```

### iOS mobile app

The Tailscale iOS app does not support CLI tagging. Tag the device in the
admin console after it joins:

1. Open <https://login.tailscale.com/admin/machines>.
2. Find the iOS device and click **Edit**.
3. Under **Tags**, add `tag:mobile`.
4. Save.

## CI/CD Setup (GitHub Actions)

CI runners use ephemeral OAuth clients so they join the tailnet for the
duration of a workflow run and automatically leave when done.

### 1. Create an OAuth client

1. Open <https://login.tailscale.com/admin/settings/oauth>.
2. Click **Generate OAuth client**.
3. Set the description to `agentctl-ci`.
4. Under **Tags**, select `tag:ci`.
5. Enable **Ephemeral** so the node is removed after disconnection.
6. Copy the **Client ID** and **Client Secret**.

### 2. Add secrets to GitHub

Add the following repository secrets:

- `TS_OAUTH_CLIENT_ID`
- `TS_OAUTH_CLIENT_SECRET`

### 3. Use in a workflow

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Connect to Tailscale
        uses: tailscale/github-action@v2
        with:
          oauth-client-id: ${{ secrets.TS_OAUTH_CLIENT_ID }}
          oauth-secret: ${{ secrets.TS_OAUTH_CLIENT_SECRET }}
          tags: tag:ci

      - name: Deploy to control plane
        run: ssh deploy@agentctl-control "cd /opt/agentctl && git pull && pnpm install && pm2 reload all"
```

The `tag:ci` ACL rules limit this runner to SSH access (port 22) on
`tag:control` and `tag:worker` machines only.

## Troubleshooting

### Tag not applied after `tailscale up`

- Verify you are an admin in the tailnet. Only `autogroup:admin` members can
  assign tags.
- Run `tailscale status` and confirm the tag appears next to the machine name.
- If re-tagging, you may need to `sudo tailscale down && sudo tailscale up
  --advertise-tags=tag:worker` (full restart).

### ACL blocking expected traffic

1. Check the Tailscale admin console logs at
   <https://login.tailscale.com/admin/logs>.
2. Filter by the source machine to see denied connections.
3. Confirm the destination port matches what the ACL allows. For example,
   workers can reach `tag:control:8080` but not `tag:control:3000`.
4. Run `tailscale ping <hostname>` to verify basic connectivity.

### MagicDNS not resolving hostnames

- Ensure the machine has MagicDNS enabled: `tailscale status --json | jq
  '.Self.DNSConfig'`.
- Restart the Tailscale daemon: `sudo systemctl restart tailscaled` (Linux)
  or restart the Tailscale app (macOS/iOS).
- Verify the hostname is set: `tailscale status` should show the expected
  name.

### SSH connection refused

- Tailscale SSH must be enabled on the target: `sudo tailscale up --ssh`.
- The ACL SSH rules only allow `tag:ci` to connect as the `deploy` user. If
  you need another user, add it to the SSH section of the ACL policy.
- Verify the `deploy` user exists on the target machine: `id deploy`.

### iOS device cannot reach the control plane

- Confirm the device is tagged `tag:mobile` in the admin console.
- Verify the Tailscale VPN toggle is active on the iOS device.
- Check that the control plane is listening on `0.0.0.0:8080` (not
  `127.0.0.1:8080`), since Tailscale traffic arrives on the tailnet
  interface.

## Testing ACL Changes Before Applying

Tailscale provides two mechanisms to validate policy changes safely.

### 1. Embedded tests

The `tests` array in `acl-policy.json` contains assertions that Tailscale
evaluates before saving the policy. If any test fails, the save is rejected
and no changes are applied. Always add tests for new rules.

### 2. Preview mode via API

```bash
# Dry-run: validate without applying
curl -X POST "https://api.tailscale.com/api/v2/tailnet/${TS_TAILNET}/acl/validate" \
  -H "Authorization: Bearer ${TS_API_KEY}" \
  -H "Content-Type: application/hujson" \
  --data-binary @acl-policy.json
```

A `200 OK` with an empty `message` field means validation passed. Any errors
are returned in the response body with line numbers.

### 3. Local review checklist

Before submitting a policy change:

- [ ] Every new ACL rule has a corresponding `tests` entry.
- [ ] Worker-to-worker traffic remains denied.
- [ ] Mobile-to-worker traffic remains denied.
- [ ] No wildcard `dst: ["*:*"]` rules exist outside `tag:dev`.
- [ ] SSH rules specify explicit usernames (never `root`).
