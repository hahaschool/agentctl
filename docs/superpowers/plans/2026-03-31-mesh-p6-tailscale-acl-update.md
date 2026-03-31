# Mesh P6: Tailscale ACL Update — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update Tailscale ACLs to allow peer-to-peer :8080 access between mesh nodes.

**Architecture:** Add `tag:mesh-node` tag owner + ACL rule. Mesh nodes are triple-tagged: `mesh-node` + `control` + `worker`. Add ACL test cases per README policy.

**Tech Stack:** Tailscale ACL JSON

**Spec:** `docs/superpowers/specs/2026-03-31-mesh-p6-tailscale-acl-update-design.md` (v3)
**Depends on:** P4 (discovery uses peer-to-peer access)

---

### Task 1: Update ACL Policy

**Files:**
- Modify: `infra/tailscale/acl-policy.json`

- [ ] **Step 1: Read current ACL policy**

Read `infra/tailscale/acl-policy.json` to understand existing structure.

- [ ] **Step 2: Add mesh-node tag and ACL rule**

In `tagOwners`:
```json
"tag:mesh-node": ["autogroup:admin"]
```

In `acls` array:
```json
{
  "action": "accept",
  "src": ["tag:mesh-node"],
  "dst": ["tag:mesh-node:8080"],
  "comment": "Mesh nodes sync via CP API on :8080"
}
```

- [ ] **Step 3: Commit**

```bash
git add infra/tailscale/acl-policy.json
git commit -m "feat(mesh-p6): add mesh-node tag + peer-to-peer :8080 ACL rule"
```

---

### Task 2: ACL Tests

**Files:**
- Modify: `infra/tailscale/acl-policy.json` (tests section is embedded inside the policy file per repo convention)

- [ ] **Step 1: Add test cases INSIDE acl-policy.json**

This repo keeps ACL tests embedded in the `"tests"` array within `acl-policy.json` (see line ~134 of the existing file). Do NOT create a separate `acl-tests.json` file.

Add to the existing `"tests"` array:

```json
{
  "src": "tag:mesh-node",
  "dst": "tag:mesh-node:8080",
  "allow": true,
  "comment": "Mesh peer sync on :8080"
},
{
  "src": "tag:mobile",
  "dst": "tag:mesh-node:8080",
  "allow": false,
  "comment": "Mobile cannot reach mesh sync directly"
}
```

- [ ] **Step 2: Commit**

---

### Task 3: Documentation

**Files:**
- Modify: `infra/tailscale/README.md`

- [ ] **Step 1: Document mesh tagging**

Add section:
```markdown
## Mesh Node Tagging

Mesh nodes are triple-tagged: `tag:mesh-node`, `tag:control`, `tag:worker`.
This allows:
- Peer-to-peer :8080 access for sync protocol
- Standard CP→Worker :9000 dispatch (via control→worker rule)
- Worker→CP :8080 heartbeat (via worker→control rule)

To tag a machine as a mesh node:
tailscale up --advertise-tags=tag:mesh-node,tag:control,tag:worker
```

- [ ] **Step 2: Commit**

---

### Task 4: Push + PR

```bash
git push -u origin agent/claude/feat/mesh-p6-acl
gh pr create --base main --title "feat(mesh): P6 — Tailscale ACL update (§33.6)"
```
