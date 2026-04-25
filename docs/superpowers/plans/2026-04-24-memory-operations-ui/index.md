# Memory Operations UI — Implementation Plan Index

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each PR plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [v5 design doc](../../specs/2026-04-24-memory-operations-ui-design-v5.md)

**Problem:** 19,226 `memory_facts` rows with `embedding IS NULL`. No UI to configure embedding providers. No UI to trigger maintenance jobs.

**Solution:** 7 PRs delivering: provider CRUD (PR A–C), job orchestration (PR D–E), UI (PR F), consolidation/synthesis + e2e (PR G).

---

## PR Map

| PR | Branch | Type | Bump | Status | Plan |
|----|--------|------|------|--------|------|
| **A** | `agent/claude-1/feat/memory-ops-pr-a` | Foundation: migration + shared types + EmbeddingClient additive + credential_kind filter | patch | Landed in PR #783 | [pr-a.md](./pr-a.md) |
| **B** | `agent/claude-1/feat/memory-ops-pr-b` | Backend: factory + providers route + memory rewiring + MEMORY_OPS_STATUS_MAP | patch | Landed in PR #797 | [pr-b.md](./pr-b.md) |
| **C** | `agent/claude-1/feat/memory-ops-pr-c` | Frontend: Settings → Memory & Embeddings + ApiError.details | minor | Landed in PR #806; saved-provider persistence follow-up landed in PR #807 and hardening follow-up landed in PR #808 | [pr-c.md](./pr-c.md) |
| **D** | `codex/memory-ops-pr-d` | Backend: jobs CRUD + BullMQ + SSE + preview endpoint + capabilities | patch | Landed in PR #812; CI, Security Audit, Docker publish, container scans, focused local tests/build, and independent CodeQL alert check passed | [pr-d.md](./pr-d.md) |
| **E** | `codex/memory-ops-pr-e` | Workers: embedding-backfill + drawer-backfill + boot reconciliation | patch | Landed in PR #816; critical path unblocked for dev-1 backfill verification | [pr-e.md](./pr-e.md) |
| **F** | `agent/claude-1/feat/memory-ops-pr-f` | Frontend: /memory/operations page + 8 alerts + egress dialog | minor | Non-critical | [pr-f.md](./pr-f.md) |
| **G** | `agent/claude-1/feat/memory-ops-pr-g` | Workers: consolidation + synthesis + e2e + Gate 2 + CHANGELOG | patch | Non-critical | [pr-g.md](./pr-g.md) |

---

## Merge Order

PRs must merge in order A → B → C → D → E → F → G. PR A landed in PR #783, PR B landed in PR #797, PR C landed in PR #806 with PR #807/#808 as saved-provider test persistence and hardening follow-ups, PR D landed in PR #812, and PR E landed in PR #816. Continue with PR F from latest `main`. Each remaining PR has its own branch off `main`. Never branch from another PR's branch.

After PR #816, intentionally set `MEMORY_OPS_ENABLED=true` in dev-1 and trigger the 19,226-fact backfill from the API. Verify before PR F.

---

## Environment Variables (progressive unlock)

| Variable | After PR | Value |
|----------|----------|-------|
| `MEMORY_OPS_ENABLED` | D | `false` |
| `MEMORY_OPS_ENABLED_KINDS` | D | `""` (empty) |
| `MEMORY_OPS_SIGNING_SECRET` | B | set (32+ random chars) |
| `MEMORY_OPS_ENABLED_KINDS` | E | `embedding-backfill,drawer-backfill` |
| `MEMORY_OPS_ENABLED` | F (env.example) | `true` |
| `MEMORY_OPS_ENABLED_KINDS` | G | `embedding-backfill,drawer-backfill,consolidation,synthesis` |
| `MEMORY_OPS_MAX_FAIL_RATIO` | E | `0.05` |
| `MEMORY_OPS_DRAWER_SOURCE_ROOTS` | E | `/path/to/source` |

---

## Shared Test Utilities

All PR plans reference these test utilities. They exist or will be created in PR A:
- `packages/control-plane/src/test-helpers.ts` — `makeMachine()`, `createMockDbRegistry()`, `mockFetch*()`
- `packages/control-plane/src/integration/test-helpers.ts` — `makeAgent()`, `makeMachine()`, `makeJob()`
- Docker Postgres with pgvector for integration tests (already in CI)

---

## Gate 1 (required before PR A merges)

```bash
GEMINI_GATE1_FAKE_KEY="fake-key-gate1"
curl -s -o /dev/null -w "%{http_code}" \
  -X POST https://generativelanguage.googleapis.com/v1beta/openai/embeddings \
  -H "Authorization: Bearer ${GEMINI_GATE1_FAKE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-embedding-001","input":["test"]}'
# Must return 401, not 404 or ENOTFOUND
```

Gate 1 must be verified manually and the result added to the Gate 1 contract test in PR A.

## Gate 2 (required before Gemini `verified:true` flip in PR G)

With a real `GEMINI_API_KEY`:
1. Response vector length === 1536
2. Response model === `gemini-embedding-001`
3. `output_dimensionality: 1536` is honored

If the compat layer ignores `output_dimensionality`, switch catalog to `gemini-embedding-2-preview` and re-run.
