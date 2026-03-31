# Mesh P6: Tailscale ACL Update — Design Spec (v2)

**Date:** 2026-03-31 (revised after Codex cross-review)
**Parent:** §33 Mesh Architecture
**Depends on:** P4 (peer discovery needs peer-to-peer access)

## Key Design Decisions (from cross-review)

1. **Dual tagging:** Mesh nodes get `tag:mesh-node` AND keep `tag:control` + `tag:worker`. This preserves existing `:9000` worker access from CP while adding peer-to-peer `:8080`.
2. **ACL tests required** per `infra/tailscale/README.md` guidance.

---

## 1. ACL Changes

Add to `infra/tailscale/acl-policy.json`:

```json
{
  "tagOwners": {
    "tag:mesh-node": ["autogroup:admin"]
  },
  "acls": [
    {
      "action": "accept",
      "src": ["tag:mesh-node"],
      "dst": ["tag:mesh-node:8080"],
      "comment": "Mesh nodes sync via CP API on :8080"
    }
  ]
}
```

Mesh nodes are tagged: `tag:mesh-node`, `tag:control`, `tag:worker`.

Existing rules unchanged:
- `tag:control` → `tag:worker:9000` (dispatch)
- `tag:worker` → `tag:control:8080` (heartbeat/callback)
- `tag:mobile` → `tag:control:8080` (mobile app)

## 2. ACL Tests

Add test cases per README policy:
- Mesh node A can reach mesh node B on `:8080`
- Mesh node A CANNOT reach mesh node B on `:9000` (unless also tagged control/worker)
- Non-mesh nodes cannot reach sync endpoints

## 3. File Changes

| File | Change |
|------|--------|
| `infra/tailscale/acl-policy.json` | Add mesh-node tag + peer ACL |
| `infra/tailscale/README.md` | Document mesh ACL setup + tagging |
| `infra/tailscale/acl-tests.json` | Test cases for mesh rules |
