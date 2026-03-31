# Mesh P6: Tailscale ACL Update — Design Spec

**Date:** 2026-03-31
**Status:** Draft
**Parent:** §33 Mesh Architecture
**Depends on:** P4 (peer discovery needs peer-to-peer access)

## Goals

1. Add `tag:mesh-node` to Tailscale ACL policy
2. Allow mesh nodes to reach each other on `:8080` (CP API for sync)
3. Keep worker port `:9000` restricted to CP-only (backward compatible)
4. Document ACL deployment procedure

## Non-Goals

- Changing existing worker-CP topology
- mTLS between mesh nodes (Tailscale WireGuard is already encrypted)

---

## 1. ACL Changes

In `infra/tailscale/acl-policy.json`:

```json
{
  "tagOwners": {
    "tag:mesh-node": ["autogroup:admin"]
  },
  "acls": [
    {
      "action": "accept",
      "src": ["tag:mesh-node"],
      "dst": ["tag:mesh-node:8080"]
    }
  ]
}
```

Mesh nodes tagged `tag:mesh-node` can reach each other on `:8080` for sync API. The existing `tag:control` and `tag:worker` rules remain unchanged.

## 2. File Changes

| File | Change |
|------|--------|
| `infra/tailscale/acl-policy.json` | Add mesh-node tag + peer-to-peer ACL |
| `infra/tailscale/README.md` | Document mesh ACL setup |
