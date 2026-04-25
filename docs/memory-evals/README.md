# Memory Eval Baselines

This directory holds committed, deterministic eval snapshots for the AgentCTL
memory retrieval stack. Each snapshot is a fixed target that later phases of the
MemPalace-inspired memory evolution plan must beat or match before new retrieval
paths can ship as defaults.

## Phase 0 facts-only baseline

**File:** [`phase-0-facts-only-baseline.json`](./phase-0-facts-only-baseline.json)

This snapshot captures retrieval quality for the facts-only path before the
drawer and vector retrieval changes in later phases can influence ranking. It
satisfies the Phase 0 acceptance criterion: "facts-only baseline eval run
exists in repo and is committed with score metrics" from
[`../plans/2026-04-15-mempalace-inspired-memory-evolution-plan.md`](../plans/2026-04-15-mempalace-inspired-memory-evolution-plan.md).

### How it is produced

- **Fixture:** [`../fixtures/memory-eval/agentctl-memory-eval.sample.json`](../fixtures/memory-eval/agentctl-memory-eval.sample.json)
  (sanitized public sample). Any regenerated snapshot records the fixture's
  SHA256 so reproducibility is provable.
  The public sample keeps one sanitized, focused row for each default
  failure-mode tag so local smoke runs exercise tag segmentation before private
  fixtures are staged.
- **Ranker:** the deterministic mock ranker (seed 42) wrapped to drop all
  drawer candidates. Only `factId` candidates survive, so drawer and vector
  paths are effectively disabled for this baseline.
- **Metrics captured per category and as an aggregate rollup:** R@5, R@10,
  MRR, NDCG@10, grounding coverage, drawer-only hit rate, p50 / p95 / p99
  latency.
- **Provenance fields:** fixture path + SHA256, seed, `createdAt` timestamp,
  and `gitCommit` at the time of the run.

### How to regenerate

```bash
pnpm memory:bench --baseline facts-only \
  --write docs/memory-evals/phase-0-facts-only-baseline.json
```

The command is mock-only — it does not touch a live PostgreSQL, an embedding
API, or any network dependency — so it can run in CI on a bare checkout.

## Split discipline

- Local/default use is `pnpm memory:eval --split dev`. This is the only split
  intended for everyday tuning.
- The default human-readable output prints the aggregate/category summary table,
  a `By Tag` table, and a capped `Failure Examples` section. When
  `MEMORY_EVAL_REQUIRE_FAILURE_MODE_COVERAGE=true`, the report also appends a
  required-tag coverage table so workflow summaries/artifacts show the private
  fixture gate state explicitly. Use `--json` if you need the raw run payload
  instead.
- `--split held-out` is reserved for workflow-owned eval jobs and requires
  `MEMORY_EVAL_ALLOW_HELD_OUT=true`.
- `--split full` is reserved for release-style eval jobs and requires
  `MEMORY_EVAL_ALLOW_FULL_SET=true`.
- `MEMORY_EVAL_REQUIRE_FAILURE_MODE_COVERAGE=true` makes `pnpm memory:eval`
  fail before execution unless the full fixture contains the default five
  failure-mode tags with at least five non-excluded rows each. Override the
  threshold with `MEMORY_EVAL_FAILURE_MODE_MIN_ROWS=<positive integer>` when a
  workflow-owned private fixture needs a different minimum.
- `MEMORY_EVAL_REQUIRE_FIXTURE_CHANGELOG=true` makes `pnpm memory:eval` require
  `--fixture-changelog <path>`. The changelog must be non-empty and include a
  date-stamped Markdown entry such as `## 2026-04-25` or `- 2026-04-25: ...`.
- Private fixture coverage is intentionally not committed in-repo. Future
  weekly/release jobs should stage the private fixture into a CI-only path
  such as `tmp/memory-eval/` and set the workflow-owned env gate(s) above
  before invoking `pnpm memory:eval`.

## Workflow automation

GitHub Actions now reserves the non-dev splits for a dedicated workflow:
[`../../.github/workflows/memory-evals.yml`](../../.github/workflows/memory-evals.yml).

- **Weekly schedule (`schedule`)** runs `held-out` and skips cleanly until the
  required eval secrets are provisioned.
- **Release tags (`push` on `v*.*.*`)** run `full` when the eval environment is
  configured. Until private fixtures are provisioned, missing configuration
  skips cleanly by default and writes a job summary. Set repository variable
  `MEMORY_EVAL_RELEASE_REQUIRED=true` after provisioning to make release-tag
  eval configuration blocking.
- **Manual dispatch (`workflow_dispatch`)** lets maintainers choose
  `held-out` or `full` without re-enabling those splits locally. Manual runs
  still fail fast on missing configuration so maintainers can validate the gate
  before enabling release-tag enforcement.

The workflow stages the private fixture into `tmp/memory-eval/agentctl-private.json`
and writes a gitignored changelog file at
`tmp/memory-eval/fixtures/CHANGELOG.md`.
It enables both `MEMORY_EVAL_REQUIRE_FAILURE_MODE_COVERAGE=true` and
`MEMORY_EVAL_REQUIRE_FIXTURE_CHANGELOG=true` so sparse private fixtures and
undocumented fixture changes fail fast instead of silently weakening eval
coverage.
The captured report is appended to the job summary and uploaded as an artifact
even when the eval step fails, so missing-tag coverage details stay visible in
CI without re-running the job locally.

Required repository secrets:

- `MEMORY_EVAL_DATABASE_URL`
- `MEMORY_EVAL_PRIVATE_FIXTURE_JSON_B64`
- `MEMORY_EVAL_PRIVATE_FIXTURE_CHANGELOG_B64`
- One of `MEMORY_EVAL_EMBEDDING_API_URL`, `MEMORY_EVAL_LITELLM_PROXY_URL`, or
  `MEMORY_EVAL_LITELLM_URL`

Optional repository variable:

- `MEMORY_EVAL_RELEASE_REQUIRED` — set to `true` only after the private fixture
  and eval endpoint secrets are provisioned and release tags should be blocked
  by missing eval configuration.
- `MEMORY_EVAL_FAILURE_MODE_MIN_ROWS` — optional override for the private-fixture
  coverage gate when weekly/release eval jobs need a minimum other than the
  default five rows per required failure-mode tag.

### Provision or rotate private fixture secrets

Use the local preflight before writing the fixture/changelog secrets:

```bash
pnpm memory:eval:secrets \
  --fixture path/to/agentctl-private.json \
  --fixture-changelog path/to/CHANGELOG.md \
  --repo hahaschool/agentctl \
  --min-rows 5
```

The command validates the sanitized fixture schema, required failure-mode tag
coverage, dated changelog entry, and GitHub Actions secret size limit. Dry-run
output prints only paths, SHA256 fingerprints, row counts, coverage, and encoded
sizes; it does not print base64 secret bodies.

After reviewing the dry run, add `--apply` to rotate
`MEMORY_EVAL_PRIVATE_FIXTURE_JSON_B64` and
`MEMORY_EVAL_PRIVATE_FIXTURE_CHANGELOG_B64` with `gh secret set`. Secret values
are passed through stdin instead of command arguments. Add
`--release-required true` only after the database and embedding endpoint secrets
are also provisioned and release tags should fail on missing eval configuration.

### What counts as a change

- **Ranker or fixture schema changes** that move the committed metrics:
  regenerate, review the diff, and note the reason in the PR description.
- **Fixture content changes** (new sanitized rows): fixture SHA256 moves,
  regenerate the baseline in the same PR when the public sample changes, update
  any Phase 0 acceptance notes that reference the numbers, and add a dated
  private-fixture changelog entry when the CI-only private fixture changes.
- **Later phases (drawer, fusion, rerank):** do not edit this file to match
  new ranking behavior. Instead, land the drawer-aware baseline alongside a
  comparison report that shows the Phase 0 numbers are not regressed.
