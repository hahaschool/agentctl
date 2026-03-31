# Mesh P5: Unified CP + Worker per Machine — Design Spec

**Date:** 2026-03-31
**Status:** Draft
**Parent:** §33 Mesh Architecture
**Depends on:** P4 (peer discovery)

## Goals

1. Single process mode: CP + Worker in one Fastify instance
2. Local PostgreSQL bootstrap script for new machines
3. PM2 ecosystem config for mesh nodes
4. `scripts/setup-mesh-node.sh` — one-command bootstrap

## Non-Goals

- Changing the existing separate CP/Worker deployment option (backward-compatible)
- Docker-based deployment (PM2 direct for now)

---

## 1. Unified Process

Today CP and Worker are separate packages with separate entry points. For mesh, each machine runs both.

**Approach:** A new entry point `packages/mesh-node/src/index.ts` that:
1. Starts local PostgreSQL (if not running)
2. Imports and starts the control plane server
3. Imports and starts the worker server
4. Both share the same database connection
5. Worker registers against `localhost:8080` (its own CP)

**Alternative considered:** Merge into a single Fastify server. Rejected — too much refactoring. Running both as co-processes under one Node.js instance is simpler.

## 2. Local PostgreSQL Bootstrap

Script: `scripts/setup-mesh-node.sh`

```bash
#!/bin/bash
# 1. Install PostgreSQL if not present (brew install postgresql@16)
# 2. Create database: createdb agentctl_mesh
# 3. Run all migrations: psql < drizzle/0001..0022
# 4. Install Redis if not present (brew install redis)
# 5. Generate node-id
# 6. Write .env.mesh with local connection strings
# 7. Install PM2 ecosystem config
```

## 3. PM2 Config

`infra/pm2/ecosystem.mesh.config.cjs`:
- Runs CP + Worker + Redis as 3 PM2 processes
- CP listens on `:8080`, Worker on `:9000`
- Both connect to local PostgreSQL and Redis
- `CONTROL_PLANE_URL=http://localhost:8080`

## 4. File Changes

| File | Change |
|------|--------|
| `packages/mesh-node/` | New package: unified entry point |
| `scripts/setup-mesh-node.sh` | Bootstrap script |
| `infra/pm2/ecosystem.mesh.config.cjs` | PM2 config for mesh nodes |
| `docs/QUICKSTART-MESH.md` | Setup guide |
